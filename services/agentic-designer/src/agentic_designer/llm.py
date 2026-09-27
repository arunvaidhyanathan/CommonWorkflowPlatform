"""Provider-agnostic LLM layer.

One capability is needed: given a system instruction, a conversation and a
JSON Schema, return JSON text that the provider constrained to that schema.
The caller (generate.py) parses and validates it; providers never do.
Gemini implements this with structured output (``response_json_schema``);
OpenAI-compatible endpoints (NVIDIA NIM, OpenRouter) with
``response_format={"type": "json_schema"}``; an Anthropic adapter would use
a forced tool call.
"""

from dataclasses import dataclass
from typing import Any, Literal, Protocol


@dataclass(frozen=True)
class Turn:
    role: Literal["user", "model"]
    text: str


class ProviderError(RuntimeError):
    """A provider call failed. ``user_message`` is safe to show in the
    browser; the original exception (logged server-side) is not."""

    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


class LLMProvider(Protocol):
    name: str

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> str: ...


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, max_output_tokens: int):
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._max_output_tokens = max_output_tokens

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> str:
        from google.genai import errors, types

        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[types.Content(role=t.role, parts=[types.Part(text=t.text)]) for t in turns],
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_json_schema=schema,
                    temperature=0.2,
                    max_output_tokens=self._max_output_tokens,
                    # No Python callables are passed, so the SDK's automatic
                    # function calling has nothing to do; keep it off.
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        except errors.APIError as exc:
            if exc.code == 429:
                raise ProviderError(
                    "The AI provider refused the request: rate limit or quota reached (for Gemini, "
                    "check the project's spend cap in AI Studio)."
                ) from exc
            raise ProviderError(f"The AI provider returned an error (HTTP {exc.code}).") from exc
        if not response.text:
            raise ProviderError(f"The AI provider returned no content (finish reason: {_finish_reason(response)}).")
        return response.text


def _finish_reason(response) -> str:
    candidates = getattr(response, "candidates", None) or []
    return str(getattr(candidates[0], "finish_reason", "unknown")) if candidates else "no candidates"


class OpenAICompatibleProvider:
    """Any OpenAI-compatible chat endpoint: NVIDIA NIM
    (https://integrate.api.nvidia.com/v1), OpenRouter
    (https://openrouter.ai/api/v1), and so on."""

    def __init__(self, name: str, api_key: str, base_url: str, model: str, max_output_tokens: int):
        from openai import AsyncOpenAI

        self.name = name
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=1, timeout=120)
        self._model = model
        self._max_output_tokens = max_output_tokens

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> str:
        import openai

        messages = [{"role": "system", "content": system}] + [
            {"role": "assistant" if t.role == "model" else "user", "content": t.text} for t in turns
        ]
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "workflow_graph", "schema": schema, "strict": False},
                },
                temperature=0.2,
                max_tokens=self._max_output_tokens,
            )
        except openai.RateLimitError as exc:
            raise ProviderError(f"The AI provider ({self.name}) refused the request: rate limit or quota reached.") from exc
        except openai.APIStatusError as exc:
            raise ProviderError(f"The AI provider ({self.name}) returned an error (HTTP {exc.status_code}).") from exc
        except openai.APIConnectionError as exc:
            raise ProviderError(f"The AI provider ({self.name}) could not be reached.") from exc

        choice = response.choices[0] if response.choices else None
        text = choice.message.content if choice else None
        if not text:
            reason = choice.finish_reason if choice else "no choices"
            raise ProviderError(f"The AI provider ({self.name}) returned no content (finish reason: {reason}).")
        return _strip_fences(text)


def _strip_fences(text: str) -> str:
    """Some hosted models wrap JSON in a markdown fence despite the schema."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else ""
        stripped = stripped.rsplit("```", 1)[0]
    return stripped.strip()
