# syntax=docker/dockerfile:1.7
#
# Dockerfile multi-stage com hardening de supply chain.
# Auditoria 2026-05-18 (TrendScope) — corrige críticos:
#   - C1: `.env` NÃO é mais copiado pra imagem (vinha via `COPY ... .env ./`).
#   - C14: removido `npm config set strict-ssl false` + registry mirror
#         não-oficial (`npm.mirrors.msh.team`) + proxy corporativo interno
#         (`172.23.0.4:2003`). Agora usa registry oficial npmjs.org com
#         TLS strict habilitado.
#   - C15: builder + runtime separados, USER não-root, HEALTHCHECK explícito.
#
# Envs (APP_ID, APP_SECRET, DATABASE_URL, SERPER_API_KEY) devem vir em RUNTIME
# via `docker run -e VAR=...` ou `env_file: .env` no docker-compose — NUNCA
# embarcadas na imagem.

# ───────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps: instala node_modules do registry oficial (npmjs.org)
# ───────────────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./

# Sem `--strict-ssl false`, sem mirror não-oficial, sem proxy interno.
# Mantemos só fund/audit off (preferência, não vulnerabilidade).
RUN npm config set fund false \
    && npm config set audit false

# Cache de npm + ci determinístico baseado em package-lock.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit


# ───────────────────────────────────────────────────────────────────────────────
# Stage 2 — build: gera dist/ usando os node_modules do stage anterior
# ───────────────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# .env não é copiado (excluído pelo .dockerignore). Build não precisa de segredos.
COPY . .
RUN npm run build


# ───────────────────────────────────────────────────────────────────────────────
# Stage 3 — production: imagem mínima, sem toolchain, usuário não-root
# ───────────────────────────────────────────────────────────────────────────────
FROM node:25-alpine AS production
WORKDIR /app

# wget para healthcheck (Alpine já tem busybox-wget, mas reforçamos)
RUN apk add --no-cache wget

# Usuário não-root (auditoria 2026-05-18 C15)
RUN addgroup -S app && adduser -S -G app -h /app app

# Copia APENAS o necessário, com ownership correto.
# .env NÃO vai mais — auditoria 2026-05-18 C1.
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

USER app

EXPOSE 3000

# Healthcheck bate em /api/health (existe em api/health.ts).
# Trocar por /api/health/ready quando split live/ready for implementado (item 38).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

# Envs em runtime — NÃO embarcadas. Use:
#   docker run --env-file .env trendscope         (lê .env do host)
#   docker run -e APP_ID=... -e APP_SECRET=...    (passa explícito)
CMD ["npm", "start"]
