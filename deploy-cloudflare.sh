#!/usr/bin/env bash
# Minerva root wrapper for Cloudflare All-in-One deployment
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/scripts/deploy-cloudflare.sh" "$@"
