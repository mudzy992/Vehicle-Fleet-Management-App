# syntax=docker/dockerfile:1.7
# =============================================================================
#  VFM API — multi-stage Dockerfile (pnpm deploy: samostalan, produkcijski image)
#
#  Build kontekst je ROOT monorepo-a:
#      docker build -f apps/api/Dockerfile -t vfm-api .
#
#  Target `runtime` se koristi za sva tri servisa (api / worker / migrate) —
#  razlikuju se samo po `command` u docker-compose.yml.
# =============================================================================

ARG NODE_VERSION=22
ARG PNPM_VERSION=10

# -----------------------------------------------------------------------------
# 1) Builder: sve dependencije + build (turbo cache iz CI-a/BuildKit-a)
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

# Prisma klijent + TypeScript build cijelog lanca dependencija (@vfm/api...)
RUN pnpm --filter @vfm/api exec prisma generate \
 && pnpm turbo run build --filter=@vfm/api...

# Samostalni produkcijski paket (node_modules bez dev dependencija)
RUN pnpm --filter @vfm/api deploy --prod --legacy /prod/api \
 && cp -r /app/apps/api/prisma /prod/api/prisma

# -----------------------------------------------------------------------------
# 2) Runtime: minimalni image, non-root, tini kao PID 1
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    APP_ENV=production \
    APP_PREFIX=vfm \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    TZ=Europe/Sarajevo

# wget  → healthcheck; tini → signali; tzdata → Europe/Sarajevo;
# openssl → Prisma engine; libwebp/vips → obrada fotografija (opciono)
RUN apk add --no-cache wget tini tzdata openssl \
 && cp /usr/share/zoneinfo/Europe/Sarajevo /etc/localtime \
 && echo "Europe/Sarajevo" > /etc/timezone \
 && addgroup -g 1001 -S vfm && adduser -S vfm -u 1001 -G vfm \
 && mkdir -p /data/vfm/attachments /data/vfm/tmp /run/secrets/vfm \
 && chown -R vfm:vfm /data/vfm

WORKDIR /app

COPY --from=builder --chown=vfm:vfm /prod/api ./

USER vfm
EXPOSE 3000

# Direktorij za priloge — u compose-u se mapira na HOST putanju (bind mount)
VOLUME ["/data/vfm/attachments"]

ENTRYPOINT ["/sbin/tini", "--"]

# Default: API server.
#   worker  → node dist/tools/worker.js
#   migrate → node dist/tools/migrate.js
CMD ["node", "dist/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:3000/health/live" || exit 1
