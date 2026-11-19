# web-app: the Designer SPA (React + Vite) served by nginx. Build context is
# this folder; the image is independent of every other CWP service.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin API behind the gateway.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# nginx-unprivileged: listens on 8080 and runs as any UID (OpenShift restricted SCC).
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
