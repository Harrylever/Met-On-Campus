#!/usr/bin/env bash
# Fails when packages/db/src/schema.ts has changes that no committed migration covers.
#
# Railway runs the committed migration files before each API deploy (preDeploy: bun run db:migrate). It cannot
# create them: if someone edits the schema and forgets `bun run db:generate`, nothing migrates and production
# breaks at runtime. This asks drizzle-kit what migration it WOULD generate; if it generates one, the schema and
# the migrations disagree. It needs no database connection. Safe to run on a dirty working tree.
set -euo pipefail
cd "$(dirname "$0")/.."

snapshot() { find packages/db/drizzle -type f -print0 | sort -z | xargs -0 shasum | shasum; }

before=$(snapshot)
bun run db:generate
after=$(snapshot)

if [ "$before" != "$after" ]; then
  echo
  echo "::error title=Schema change without a migration::packages/db/src/schema.ts differs from the committed migrations."
  echo "drizzle-kit just generated the missing migration (listed below). Review it, commit it with your schema change, and push again."
  echo
  git status --short packages/db/drizzle || true
  exit 1
fi

echo "Schema and migrations agree."
