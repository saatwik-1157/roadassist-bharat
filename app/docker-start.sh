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
# It deliberately does NOT run the full seed. Seeding needs @faker-js/faker, a
# devDependency that is not in this image, and a production artefact has no
# business being able to fabricate four thousand users.
#
# The one exception is SEED_DEMO_FLEET=true, which the demo deployment sets:
# 24 simulated mechanics on the Gurugram / NH-48 corridor, written by a
# faker-free, deterministic, idempotent script (seed-demo-fleet.ts). Without
# them the hosted demo had nobody to dispatch to. It runs from inside the
# container because the alternative is someone's tooling holding the database
# password, and it refuses NODE_ENV=production on its own account.
set -e

echo "→ migrating"
node packages/db/dist/src/migrate.js

# A failed fleet seed is logged and then ignored, deliberately: a demo with no
# mechanics can still sign people in, take SOS calls and show the map, while a
# container that dies at boot shows nothing at all. `|| echo` is also what keeps
# `set -e` from ending the script here. $? in the echo is the seed's exit code.
if [ "${SEED_DEMO_FLEET:-}" = "true" ]; then
  echo "→ seeding demo fleet"
  node packages/db/dist/src/seed-demo-fleet.js     || echo "⚠ demo fleet seed failed (exit $?) - starting the api without it"
fi

echo "→ starting api"
# exec, so the server becomes PID 1's child directly and tini's SIGTERM reaches
# it: the shutdown path closes the live SSE streams, drains Fastify and ends the
# Postgres pool. Without exec the signal would stop at this script.
exec node apps/api/dist/src/server.js
