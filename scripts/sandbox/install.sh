#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

(cd "$ROOT" && npm run build --silent)

exec docker compose \
  -f "$SANDBOX/docker-compose.yaml" \
  run --rm sandbox bash