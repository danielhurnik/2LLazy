# 2LLazy — production image.
#
# Two things run in production and they are not the same shape:
#
#   * the web app     — long-lived server, answers requests out of Postgres
#   * the job ingester — a batch job that scrapes boards for minutes at a time
#
# They get separate final stages, because they need different things. The web
# app is built with `output: "standalone"` (next.config.ts), so it ships a
# traced bundle and no node_modules. The ingester runs TypeScript source
# through tsx, so it needs the source tree, a production node_modules, and the
# Prisma CLI for migrations. Putting both in one image would drag the full
# dependency tree into the web image for no benefit.
#
#   docker build -t 2llazy-app .                    # web app  (default stage)
#   docker build -t 2llazy-worker --target worker . # ingester + migrations
#
# docker-compose.yml builds both.

ARG NODE_IMAGE=node:20-alpine

# ── base ─────────────────────────────────────────────────────────────────────
# Alpine is enough: every dependency that touches C — bcryptjs, pdf-parse, pg —
# is pure JavaScript, so nothing here needs glibc. openssl is for Prisma's
# schema engine (migrations); libc6-compat is the musl shim a few prebuilt
# binaries still expect.
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# playwright is a dependency but the app never drives a browser in a container:
# ingestion reaches JavaScript-heavy boards through their sitemaps. Skip the
# ~400 MB browser download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ── deps ─────────────────────────────────────────────────────────────────────
# Full install, devDependencies included: the build needs next, typescript and
# the Prisma CLI. None of it reaches a final stage.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `prisma generate` reads the URL through prisma.config.ts and wants it to
# parse, but it never opens a connection — it only writes the client. A
# throwaway value is correct here; the real one arrives at runtime.
ARG DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV DATABASE_URL=${DATABASE_URL}
RUN npx prisma generate

# NEXT_PUBLIC_* is inlined into the browser bundle at build time, so it has to
# be a build argument — setting it at runtime does nothing. Only needed if you
# use Google Calendar sync.
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}

# A build-time value only, so pages that render statically do not throw on a
# missing secret. The running app gets a real one from the environment.
ARG AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
ENV AUTH_SECRET=${AUTH_SECRET}

ENV NODE_ENV=production
RUN npm run build

# ── runtime-deps ─────────────────────────────────────────────────────────────
# Production dependencies for the worker stage. tsx (runs the TypeScript
# scripts) and dotenv (imported by prisma.config.ts) are declared as real
# dependencies, so `npm ci --omit=dev` brings them. The Prisma CLI is a
# devDependency but the worker needs it for `migrate deploy`, so it is added at
# the version the lockfile already pins.
FROM base AS runtime-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && PRISMA_VERSION="$(node -p "require('./package.json').devDependencies.prisma")" \
 && npm install --omit=dev --no-save --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 && npm cache clean --force

# ── worker ───────────────────────────────────────────────────────────────────
# Migrations and the ingester. Never serves traffic; scheduled or run by hand.
FROM base AS worker
ENV NODE_ENV=production

COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
# The generated Prisma client, built in the builder stage.
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

# tsx resolves the `@/*` import alias through tsconfig.json, and
# scripts/apply-search-indexes.ts reads prisma/sql/search-indexes.sql relative
# to the working directory. Both have to be here.
COPY --chown=node:node package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src

USER node
# Overridden by every caller; printing the flags is the useful default.
CMD ["npx", "tsx", "scripts/ingest.ts", "--help"]

# ── runner (default) ─────────────────────────────────────────────────────────
# The web app. Everything it needs is in .next/standalone; there is no
# node_modules to ship and no devDependency anywhere in this stage.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
# Without this the standalone server binds to localhost inside the container
# and a published port reaches nothing.
ENV HOSTNAME=0.0.0.0

# next build does not copy public/ or .next/static into the standalone output.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Output tracing usually picks the generated client up on its own; copying it
# explicitly means a WASM query compiler that slipped the trace is still there.
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

# .next/cache holds revalidated pages (several routes set `revalidate`), and
# /api/uploads writes here. Both are written by the app user at runtime.
RUN mkdir -p .next/cache uploads && chown -R node:node .next uploads

USER node
EXPOSE 3000

# /api/health is exempt from the session check and reports whether the app can
# reach its database, so an unhealthy container means something is actually
# wrong rather than the auth configuration being off.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
