# Agentic Designer (Python / FastAPI).
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
EXPOSE 8090
CMD ["/app/.venv/bin/uvicorn", "agentic_designer.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090"]
