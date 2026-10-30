#!/usr/bin/env bash
# Create the Cloudflare resources the minerva-sync Worker needs and apply the
# schema. Safe to re-run: every step is idempotent.
#
#   ./setup.sh <account-id>
#
# The account id is optional — wrangler reads it from the environment or from
# `wrangler whoami`. It is only needed to create the R2 bucket's S3 endpoint
# credentials, which this script does not do (see the README).
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler is not installed. Install it with: npm install -g wrangler" >&2
  exit 1
fi

echo "==> Creating the D1 database (minerva-sync)"
if wrangler d1 list 2>/dev/null | grep -q "minerva-sync"; then
  echo "    already exists"
else
  wrangler d1 create minerva-sync
  echo "    -> copy the printed database_id into wrangler.toml"
fi

echo "==> Creating the R2 bucket (minerva-library)"
if wrangler r2 bucket list 2>/dev/null | grep -q "minerva-library"; then
  echo "    already exists"
else
  wrangler r2 bucket create minerva-library
fi

echo "==> Applying the schema to the remote database"
wrangler d1 migrations apply minerva-sync --remote

cat <<'EOF'

Next steps:
  1. Set the token signing secret:
       wrangler secret put JWT_SECRET
     (a long random value, 32+ characters)
  2. Deploy:
       wrangler deploy
  3. Point the app at the Worker (see README.md, section 5).
EOF
