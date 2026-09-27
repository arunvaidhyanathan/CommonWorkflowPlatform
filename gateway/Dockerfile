# CWP edge gateway: nginx serving the built SPA and routing /api/* to the
# backend services. Build context is the repo root (see docker-compose.yml)
# so this can build Designer/ too.

FROM node:22-alpine AS spa
WORKDIR /app
COPY Designer/package.json Designer/package-lock.json ./
RUN npm ci
COPY Designer/ ./
# Vite reads Designer/.env.local (Supabase URL + anon key) if present; this
# env var overrides only the API base, so the served SPA calls its own origin.
ENV VITE_API_BASE_URL=/api
RUN npm run build

FROM nginx:1.28-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY gateway/snippets/ /etc/nginx/snippets/
COPY gateway/templates/ /etc/nginx/templates/
COPY --from=spa /app/dist /usr/share/nginx/html
ENV WORKFLOW_RUNTIME_UPSTREAM=workflow-runtime:8081 \
    AGENTIC_DESIGNER_UPSTREAM=agentic-designer:8090 \
    CORS_ALLOWED_ORIGINS=^http://localhost:5173$
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
