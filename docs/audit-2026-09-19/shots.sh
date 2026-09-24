#!/bin/bash
# Screenshot local routes. Sets up playwright on first run.
#
#   docs/audit-2026-09-19/shots.sh <dash|web> <outDir> <width> <path>...
#
# Reads the dashboard passphrase out of apps/organizer/.env.local so it is
# never typed or printed. Run one at a time: parallel runs time out the sign-in.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${SHOTS_DIR:-/tmp/kgc-shots}"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

if [ ! -d "$WORK/node_modules/playwright" ]; then
  mkdir -p "$WORK" && cd "$WORK"
  [ -f package.json ] || npm init -y >/dev/null
  npm i playwright@1.57 --no-audit --no-fund >/dev/null
fi
cp "$REPO/docs/audit-2026-09-19/shot.mjs" "$WORK/shot.mjs"

case "$1" in
  dash) export SHOT_ORIGIN="${SHOT_ORIGIN:-http://localhost:3100}" ;;
  web)  export SHOT_ORIGIN="${SHOT_ORIGIN:-http://localhost:3200}" ;;
  app)  export SHOT_ORIGIN="${SHOT_ORIGIN:-http://localhost:8081}" ;;
esac
export SHOT_EMAIL="${SHOT_EMAIL:-$(grep '^CONSOLE_ALLOWLIST=' "$REPO/apps/organizer/.env.local" | cut -d= -f2- | cut -d, -f1)}"
export SHOT_PASSPHRASE="${SHOT_PASSPHRASE:-$(grep '^CONSOLE_PASSPHRASE=' "$REPO/apps/organizer/.env.local" | cut -d= -f2- | tr -d '"')}"

cd "$WORK" && node shot.mjs "$@"
