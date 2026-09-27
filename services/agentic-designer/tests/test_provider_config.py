"""Provider selection from the environment."""

import pytest

from agentic_designer.app import _provider_from_env


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in ("AGENT_PROVIDER", "AGENT_MODEL", "GEMINI_API_KEY", "NVIDIA_API_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def test_unknown_provider_stops_startup(monkeypatch):
    # A typo must fail loudly, not quietly turn the feature off.
    monkeypatch.setenv("AGENT_PROVIDER", "nvdia")
    with pytest.raises(RuntimeError, match="nvdia"):
        _provider_from_env()


def test_missing_key_means_no_provider(monkeypatch):
    monkeypatch.setenv("AGENT_PROVIDER", "nvidia")
    assert _provider_from_env() is None


@pytest.mark.parametrize("provider, key_var", [("nvidia", "NVIDIA_API_KEY"), ("openrouter", "OPENROUTER_API_KEY")])
def test_openai_compatible_providers_use_their_own_key(monkeypatch, provider, key_var):
    monkeypatch.setenv("AGENT_PROVIDER", provider)
    monkeypatch.setenv(key_var, "test-key")
    p = _provider_from_env()
    assert p is not None and p.name == provider


def test_gemini_is_the_default(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    assert _provider_from_env().name == "gemini"


def test_http_402_reads_as_out_of_credit_and_is_not_retryable():
    import asyncio

    import httpx
    import openai

    from agentic_designer.llm import OpenAICompatibleProvider, ProviderError, Turn

    p = OpenAICompatibleProvider("openrouter", "OPENROUTER_API_KEY", "k", "https://openrouter.ai/api/v1", "m", 100)

    async def refuse(**kwargs):
        raise openai.APIStatusError("402", response=httpx.Response(402, request=httpx.Request("POST", "https://x")), body=None)

    p._client.chat.completions.create = refuse
    try:
        asyncio.run(p.generate_json("s", [Turn("user", "u")], {}))
    except ProviderError as exc:
        assert (exc.kind, exc.retryable) == ("rate_limited", False) and "out of credit" in exc.user_message
    else:
        raise AssertionError("expected ProviderError")
