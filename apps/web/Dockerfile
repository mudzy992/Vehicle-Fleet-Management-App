# syntax=docker/dockerfile:1.7
# =============================================================================
#  VFM Web (Vite + React SPA) → nginx:alpine
#  Build kontekst je ROOT monorepo-a:
#      docker build -f apps/web/Dockerfile -t vfm-web .
#
#  nginx:  /            → statika (SPA fallback na /index.html)
#          /api/        → proxy na WEB_API_INTERNAL_URL (bez CORS-a, bez izloženog API port-a)
#          /healthz     → 200 (Coolify healthcheck)
# =============================================================================

ARG NODE_VERSION=22
ARG PNPM_VERSION=10

# -----------------------------------------------------------------------------
# 1) Builder
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Vite build-time varijable (moraju biti prisutne pri buildu, ne pri runtimeu)
ARG VITE_APP_TITLE="Vozni park"
ARG VITE_APP_ENV=production
ARG VITE_PUBLIC_API_URL=""
ARG VITE_APP_VERSION=1.0.0
ARG VITE_SENTRY_DSN=""
ENV VITE_APP_TITLE=$VITE_APP_TITLE \
    VITE_APP_ENV=$VITE_APP_ENV \
    VITE_PUBLIC_API_URL=$VITE_PUBLIC_API_URL \
    VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN

RUN pnpm turbo run build --filter=@vfm/web...

# -----------------------------------------------------------------------------
# 2) Runtime — nginx
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
ENV NGINX_ENVSUBST_FILTER=WEB_API_INTERNAL_URL \
    WEB_API_INTERNAL_URL=http://api:3000

# Template se procesira pri startu (envsubst) → /etc/nginx/conf.d/default.conf
COPY apps/web/nginx/nginx.conf.template /etc/nginx/templates/default.conf.template

RUN rm -f /etc/nginx/conf.d/default.conf \
 && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
 && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

COPY --from=builder --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/healthz || exit 1

# nginx entrypoint (envsubst) + daemon off
CMD ["nginx", "-g", "daemon off;"]
