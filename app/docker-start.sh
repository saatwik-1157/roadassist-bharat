#!/bin/sh
# Migrate, then serve — as one command a host can invoke without a shell.
#
# This exists because `dockerCommand: sh -c "node migrate.js && node server.js"`
# does not survive Render: it does not shell-split the value, so the whole
# string arrived as a single command name and the container died with
#
#   sh: node packages/db/dist/src/migrate.js && node apps/api/dist/src/server.js: not found
#   ==> Exited with status 127
#
# A file is one token, so there is nothing left to quote or split, and it
# behaves identically on Render, Fly, docker run and a local shell.
#
# migrate.ts is idempotent — it applies the journal, pins SRIDs, rebuilds the
# GiST indexes and re-asserts the append-only audit RULES — so running it on
# every boot costs about a second and means a first deploy needs no extra step.
#
# It deliberately does NOT seed. Seeding needs @faker-js/faker, a devDependency
# that is not in this image, and a production artefact has no business being
# able to fabricate four thousand users.
set -e

echo "→ migrating"
node packages/db/dist/src/migrate.js

echo "→ starting api"
# exec, so the server becomes PID 1's child directly and tini's SIGTERM reaches
# it: the shutdown path closes the live SSE streams, drains Fastify and ends the
# Postgres pool. Without exec the signal would stop at this script.
exec node apps/api/dist/src/server.js
