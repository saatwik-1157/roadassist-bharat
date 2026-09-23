# syntax=docker/dockerfile:1
# ══════════════════════════════════════════════════════════════════════════════
# RoadAssist — production image
#
# One image serves the whole platform: the Fastify API and, from the same
# process, the static citizen app, mechanic console and authority dashboard.
# That is not a shortcut — the web surfaces are plain files with no build step
# and no separate runtime, so a second container would add a deployment unit,
# a network hop and a CORS boundary in exchange for nothing.
#
# Build context is the REPOSITORY ROOT, not app/, because the demo media in
# site/ is served at /media and lives outside the npm workspace:
#
#   docker build -f app/Dockerfile -t roadassist:local .
# ══════════════════════════════════════════════════════════════════════════════

# ── 1. dependencies ──────────────────────────────────────────────────────────
# `node:22-alpine` is a FLOATING tag — it moves as 22.x patches land, so two
# builds of the same commit can differ. That is a deliberate trade for a
# student project that wants security patches without a dependency bot; pin it
# to a digest (node:22-alpine@sha256:…) before anyone depends on a build being
# byte-reproducible. Alpine keeps the runtime small; the build stage needs
# nothing native, so no toolchain is installed anywhere.
FROM node:22-alpine AS deps
WORKDIR /repo/app
# Only the manifests, so this layer is cached until a dependency actually
# changes — the difference between a 5-second rebuild and a 90-second one.
COPY app/package.json app/package-lock.json ./
COPY app/packages/db/package.json ./packages/db/
COPY app/apps/api/package.json ./apps/api/
RUN npm ci --no-audit --no-fund

# ── 2. build ─────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo/app
COPY app/tsconfig.json ./
COPY app/packages ./packages
COPY app/apps/api ./apps/api
# Compiles packages/db then apps/api via project references.
RUN npm run build

# ── 3. production dependencies only ──────────────────────────────────────────
# devDependencies carry the compiler, the linter and drizzle-kit — none of which
# should exist in a running container, and each of which is attack surface.
FROM node:22-alpine AS prod-deps
WORKDIR /repo/app
COPY app/package.json app/package-lock.json ./
COPY app/packages/db/package.json ./packages/db/
COPY app/apps/api/package.json ./apps/api/
RUN npm ci --omit=dev --no-audit --no-fund

# ── 4. runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Fastify binds 0.0.0.0 by default here; the port is overridable but declared.
ENV PORT=4000
# Hazard-report photos MUST land on the mounted volume, not in the image layer.
# The default (process.cwd()/uploads) resolves inside the read-only application
# directory, where the unprivileged runtime user cannot create it — the upload
# endpoint failed with EACCES until this was set. Uploads are also the one piece
# of state besides the database, so they belong on a volume regardless.
ENV UPLOAD_DIR=/repo/app/var/uploads
WORKDIR /repo/app

# `wget` is already in busybox — used by the HEALTHCHECK below, so nothing extra
# is installed. tini reaps zombies and forwards signals when this is PID 1.
RUN apk add --no-cache tini

# The `node` user ships with the image (uid 1000). Running as root inside a
# container is the default and it should not be: a container escape starts from
# whatever the process had.
COPY --chown=node:node --from=prod-deps /repo/app/node_modules ./node_modules
COPY --chown=node:node --from=build /repo/app/packages/db/dist ./packages/db/dist
COPY --chown=node:node --from=build /repo/app/apps/api/dist ./apps/api/dist
COPY --chown=node:node app/packages/db/package.json ./packages/db/
COPY --chown=node:node app/packages/db/drizzle ./packages/db/drizzle
COPY --chown=node:node app/apps/api/package.json ./apps/api/
COPY --chown=node:node app/package.json ./
# Migrate-then-serve as a single token, because not every host shell-splits
# the command it is given (Render does not).
COPY --chown=node:node app/docker-start.sh ./docker-start.sh
RUN chmod +x ./docker-start.sh
# Served straight from disk by @fastify/static — no bundler, no build artefacts.
COPY --chown=node:node app/apps/web ./apps/web
# Demo media, served at /media. Outside the workspace, hence the root context.
COPY --chown=node:node site ./../site

# Hazard-report photos land here (ADR-0006 keeps only a reference in the
# database). Declared as a volume so a container restart does not lose them.
RUN mkdir -p /repo/app/var/uploads && chown -R node:node /repo/app/var
VOLUME ["/repo/app/var"]

USER node
EXPOSE 4000

# The application answers 503 when its database is unreachable, so this check
# reflects readiness rather than merely "the process is alive".
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

# tini as PID 1: forwards SIGTERM to node, which already closes the live SSE
# streams, drains Fastify and ends the Postgres pool before exiting.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/src/server.js"]
