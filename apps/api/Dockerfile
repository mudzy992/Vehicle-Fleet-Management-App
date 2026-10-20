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

# .npmrc je OBAVEZAN: bez njega pnpm u image-u koristi drugačije defaulte
# (peer dependencije / node-linker) → build se može ponašati drugačije nego lokalno.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json .npmrc ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Prisma klijent + TypeScript build cijelog lanca.
# `prisma generate` (Prisma 7, Rust-free generator `prisma-client`) emituje TS u
# `apps/api/src/generated/prisma` — taj direktorij NIJE u Git-u, pa generate mora
# proći PRIJE `tsc`. Build PADA ako je šema neispravna (što je i željeno).
# ⚠️ Zahtijeva izlaz ka internetu (CLI provjerava/preuzima `schema-engine` s
#    binaries.prisma.sh); bez toga generate pada.
RUN if pnpm --filter @vfm/api exec prisma --version >/dev/null 2>&1; then \
      echo "PRISMA: CLI pronađen — generišem klijenta."; \
      pnpm --filter @vfm/api exec prisma generate; \
    else \
      echo "PRISMA: CLI nije instaliran — preskačem generate (Faza 0, vidi apps/api/prisma/README.md)."; \
    fi \
 && pnpm turbo run build --filter=@vfm/api...

# -----------------------------------------------------------------------------
# 1b) 🔴 Prisma `schema-engine` binarni fajl — MORA biti u image-u
# -----------------------------------------------------------------------------
# `pnpm-workspace.yaml` ima `ignoredBuiltDependencies: [prisma, @prisma/client,
# @prisma/engines]`, pa se postinstall skripta paketa `@prisma/engines` NE
# izvršava pri `pnpm install` (namjerno: bez nje install prolazi i u okruženjima
# bez izlaza ka binaries.prisma.sh).
#
# Posljedica bez ovog koraka: `prisma generate` radi (Prisma 7 generator je
# Rust-free, WASM je u npm paketu), ALI `prisma migrate deploy` — koji koristi
# NATIVNI schema-engine — pada u runtime kontejneru, jer tad pokušava preuzeti
# binarni fajl (uid 1001, bez garancije mreže). Zato ga preuzimamo OVDJE, u
# builder-u, i pečemo u image.
#
# Binary target se NE hardkoduje: Prisma ga detektuje iz builder slike
# (`node:22-alpine` → `linux-musl-openssl-3.0.x`, na ARM hostu
# `linux-musl-arm64-openssl-3.0.x`), a builder i runtime su ista slika, pa
# detektovani engine u runtime-u odgovara. Ispod se ispisuje šta je nađeno.
# `@prisma/engines` nije direktna zavisnost (dolazi kroz `prisma`), pa ga pod
# pnpm isolated linkerom traži apps/api/scripts/resolve-prisma-engines.cjs.
# Neuspjeh NIJE fatalan za build (api/web rade bez migracija) — ali se glasno
# upozorava, jer `migrate` tada pada pri pokretanju.
RUN ENGINES_DIR=$(node apps/api/scripts/resolve-prisma-engines.cjs /app/apps/api || true); \
    if [ -z "$ENGINES_DIR" ]; then \
      echo "⚠️  PRISMA: @prisma/engines nije pronađen — engine se ne može zapeći u image."; \
      exit 0; \
    fi; \
    echo "PRISMA engines dir: $ENGINES_DIR"; \
    echo "$ENGINES_DIR" > /tmp/prisma-engines-dir; \
    node "$ENGINES_DIR/scripts/postinstall.js"; \
    ls -la "$ENGINES_DIR"; \
    if find "$ENGINES_DIR" -maxdepth 1 -name 'schema-engine-*' -type f | grep -q .; then \
      echo "PRISMA: schema-engine je preuzet — migrate deploy neće trebati mrežu."; \
    else \
      echo "⚠️  PRISMA: schema-engine NIJE preuzet (build nema izlaz ka binaries.prisma.sh?)."; \
      echo "   Migracije će pokušati preuzimanje u runtime kontejneru; ako ni tamo"; \
      echo "   nema mreže, servis 'migrate' pada s exit 1 i ispisuje dijagnostiku."; \
    fi

# Samostalni produkcijski paket (node_modules bez dev dependencija).
#
# `prisma.config.ts` MORA u /prod/api: runtime servis `migrate` pokreće
# `prisma migrate deploy` iz cwd=/app (WORKDIR), a Prisma 7 čita connection URL
# za migracije ISKLJUČIVO iz tog fajla (flagovi --schema/--url više ne važe).
#
# Generisani klijent se NE generiše ponovo ovdje: `prisma generate` (korak gore)
# emituje TypeScript u `apps/api/src/generated/prisma`, pa ga `tsc` sastavi u
# `dist/` prije deploy-a. Query compiler WASM koji runtime treba
# (`query_compiler_fast_bg.postgresql.*`) nalazi se u paketu `@prisma/client`,
# koji je produkcijska dependencija → `pnpm deploy --prod` ga prenosi.
RUN pnpm --filter @vfm/api deploy --prod --legacy /prod/api \
 && cp -r /app/apps/api/prisma /prod/api/prisma \
 && cp /app/apps/api/prisma.config.ts /prod/api/prisma.config.ts \
 && DEST=/prod/api/node_modules/@prisma/engines \
 && mkdir -p "$DEST" \
 && if ! find /prod/api/node_modules -name 'schema-engine-*' -type f | grep -q .; then \
      ENGINES_DIR=$(cat /tmp/prisma-engines-dir 2>/dev/null || true); \
      if [ -n "$ENGINES_DIR" ]; then \
        echo "PRISMA: 'pnpm deploy' nije prenio engine — kopiram ručno iz $ENGINES_DIR"; \
        cp -a "$ENGINES_DIR"/schema-engine-* "$DEST"/ 2>/dev/null || true; \
        cp -a "$ENGINES_DIR"/package.json "$DEST"/ 2>/dev/null || true; \
      fi; \
    fi \
 && FOUND=$(find /prod/api/node_modules -name 'schema-engine-*' -type f | head -3) \
 && if [ -n "$FOUND" ]; then \
      echo "PRISMA engine u produkcijskom paketu:"; echo "$FOUND"; ls -la $FOUND; \
    else \
      echo "⚠️  PRISMA: /prod/api NEMA schema-engine — 'migrate' će ga pokušati"; \
      echo "   preuzeti pri pokretanju (treba mrežu u runtime kontejneru)."; \
    fi

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
