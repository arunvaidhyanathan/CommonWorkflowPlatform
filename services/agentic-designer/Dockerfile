# Agentic Designer (Python / FastAPI).
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
# Runs as any UID in group 0 (OpenShift restricted SCC); /app is read-only at runtime.
USER 1001
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8090
CMD ["/app/.venv/bin/uvicorn", "agentic_designer.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090", "--timeout-graceful-shutdown", "20"]
