# gateway: CWP's internal entry point (nginx). Routes /api/* to the services
# and everything else to web-app. Build context is this folder; the image is
# independent of every other CWP service.
#
# nginx-unprivileged: listens on 8080 and runs as any UID (OpenShift restricted
# SCC). The template is rendered from the environment at container start.
FROM nginxinc/nginx-unprivileged:1.28-alpine
# The base image's own server on :8080 would shadow the gateway's.
USER root
RUN rm /etc/nginx/conf.d/default.conf
USER 101
COPY snippets/ /etc/nginx/snippets/
COPY templates/ /etc/nginx/templates/
# Defaults suit docker compose; override every one of these on OpenShift.
ENV NGINX_RESOLVER=127.0.0.11 \
    WEB_APP_UPSTREAM=web-app:8080 \
    IDENTITY_SERVICE_UPSTREAM=identity-service:8082 \
    DESIGN_SERVICE_UPSTREAM=design-service:8083 \
    FLOWABLE_WRAPPER_UPSTREAM=flowable-wrapper:8081 \
    AGENTIC_DESIGNER_UPSTREAM=agentic-designer:8090 \
    SPEND_TRACKER_UPSTREAM=spend-tracker:8095 \
    TRUSTED_PROXY_CIDR=10.0.0.0/8 \
    API_RATE_LIMIT=50r/s \
    AGENT_RATE_LIMIT=2r/s \
    CORS_ALLOWED_ORIGINS=^http://localhost:5173$
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
