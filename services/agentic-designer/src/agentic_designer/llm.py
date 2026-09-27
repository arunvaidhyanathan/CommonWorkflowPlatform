"""Provider-agnostic LLM layer.

One capability is needed: given a system instruction, a conversation and a
JSON Schema, return JSON text that the provider constrained to that schema,
plus the token usage the provider reported (for spend metering, usage.py).
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


@dataclass(frozen=True)
class Completion:
    text: str
    # Billed tokens as the provider reports them; output includes any
    # reasoning/thinking tokens, which providers bill as output.
    input_tokens: int
    output_tokens: int


ErrorKind = Literal["rate_limited", "error", "empty"]


class ProviderError(RuntimeError):
    """A provider call failed. ``user_message`` is safe to show in the
    browser; the original exception (logged server-side) is not."""

    def __init__(self, user_message: str, kind: ErrorKind = "error", retryable: bool = True):
        super().__init__(user_message)
        self.user_message = user_message
        self.kind = kind
        # False when waiting won't help (e.g. an account out of credit).
        self.retryable = retryable


class LLMProvider(Protocol):
    name: str
    model: str
    # Name of the environment variable holding the key, never the key itself.
    key_alias: str

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> Completion: ...


class GeminiProvider:
    name = "gemini"
    key_alias = "GEMINI_API_KEY"

    def __init__(self, api_key: str, model: str, max_output_tokens: int):
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self.model = model
        self._max_output_tokens = max_output_tokens

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> Completion:
        from google.genai import errors, types

        try:
            response = await self._client.aio.models.generate_content(
                model=self.model,
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
                    "check the project's spend cap in AI Studio).",
                    kind="rate_limited",
                ) from exc
            raise ProviderError(f"The AI provider returned an error (HTTP {exc.code}).") from exc
        if not response.text:
            raise ProviderError(
                f"The AI provider returned no content (finish reason: {_finish_reason(response)}).", kind="empty"
            )
        usage = response.usage_metadata
        return Completion(
            text=response.text,
            input_tokens=(usage.prompt_token_count or 0) if usage else 0,
            output_tokens=((usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)) if usage else 0,
        )


def _finish_reason(response) -> str:
    candidates = getattr(response, "candidates", None) or []
    return str(getattr(candidates[0], "finish_reason", "unknown")) if candidates else "no candidates"


class OpenAICompatibleProvider:
    """Any OpenAI-compatible chat endpoint: NVIDIA NIM
    (https://integrate.api.nvidia.com/v1), OpenRouter
    (https://openrouter.ai/api/v1), and so on."""

    def __init__(self, name: str, key_alias: str, api_key: str, base_url: str, model: str, max_output_tokens: int):
        from openai import AsyncOpenAI

        self.name = name
        self.key_alias = key_alias
        # Some hosted models take minutes on a large prompt (GLM 5.3 took up to
        # 222s on an edit); the stream keeps the browser connection alive meanwhile.
        # No SDK-level retries: the generate/edit loops own retrying, and an SDK
        # retry after a 300s timeout doubled one live edit to ten minutes.
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=300)
        self.model = model
        self._max_output_tokens = max_output_tokens

    async def generate_json(self, system: str, turns: list[Turn], schema: dict[str, Any]) -> Completion:
        import openai

        messages = [{"role": "system", "content": system}] + [
            {"role": "assistant" if t.role == "model" else "user", "content": t.text} for t in turns
        ]
        try:
            response = await self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "workflow_graph", "schema": schema, "strict": False},
                },
                temperature=0.2,
                max_tokens=self._max_output_tokens,
            )
        except openai.RateLimitError as exc:
            raise ProviderError(
                f"The AI provider ({self.name}) refused the request: rate limit or quota reached.", kind="rate_limited"
            ) from exc
        except openai.APIStatusError as exc:
            if exc.status_code == 402:
                # Out of credit: the key is refused like a spent quota (so the
                # spend tracker alerts), and retrying won't help.
                raise ProviderError(
                    f"The AI provider ({self.name}) refused the request: the account is out of credit.",
                    kind="rate_limited", retryable=False,
                ) from exc
            raise ProviderError(f"The AI provider ({self.name}) returned an error (HTTP {exc.status_code}).") from exc
        except openai.APIConnectionError as exc:
            raise ProviderError(f"The AI provider ({self.name}) could not be reached.") from exc

        choice = response.choices[0] if response.choices else None
        text = choice.message.content if choice else None
        if not text:
            reason = choice.finish_reason if choice else "no choices"
            raise ProviderError(
                f"The AI provider ({self.name}) returned no content (finish reason: {reason}).", kind="empty"
            )
        usage = response.usage
        return Completion(
            text=_strip_fences(text),
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )


def _strip_fences(text: str) -> str:
    """Some hosted models wrap JSON in a markdown fence despite the schema."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else ""
        stripped = stripped.rsplit("```", 1)[0]
    return stripped.strip()
