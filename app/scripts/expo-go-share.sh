#!/usr/bin/env bash
# Serve the app to anyone with Expo Go, from this Mac, against the LIVE project.
#
#   app/scripts/expo-go-share.sh
#   PORT=8222 QR_DIR=/some/dir app/scripts/expo-go-share.sh
#
# Starts Metro for Expo Go, puts it on a public https URL with a Cloudflare quick
# tunnel, prints the exp:// link, and writes expo-go-qr.png and expo-go.html
# (the QR plus three steps) to QR_DIR. Anyone who installs Expo Go from the App
# Store or Google Play can scan it and get the app; the Mac has to stay on and
# this script has to keep running. Ctrl-C stops everything it started.
#
# ⚠️ The link changes on every run. A quick tunnel gets a new random
# *.trycloudflare.com hostname each time, so after a restart the old QR code
# points nowhere and the new one has to be handed out. A fixed hostname needs a
# named tunnel, which needs `cloudflared tunnel login` to a Cloudflare account
# that holds a domain; this Mac has none (no ~/.cloudflared/cert.pem).
#
# Expo Go only opens projects on its own SDK (57 as of 2026-10-12). When the
# store app moves to 58, this link stops working until the project follows.
#
# What it points at: the live Firebase project (config copied out of the main
# checkout's app/.env.local, never committed) and https://www.knowledgegraph.tech
# for the sign-in endpoints. EXPO_PUBLIC_USE_EMULATOR is forced to 0.
#
# What the public can reach: only the manifest, the bundle and the assets, via
# expo-go-proxy.mjs. Metro's other endpoints act on this Mac (create files, open
# an editor, attach a debugger), so they are not tunnelled. Metro runs with
# --no-dev --minify: a release-style bundle, no dev overlay, no hot reload.
# --localhost binds Metro to this Mac alone, so the LAN cannot reach it either.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
PORT="${PORT:-8222}"                 # Metro, on localhost
PROXY_PORT="${PROXY_PORT:-$((PORT + 1))}"
CLOUDFLARED="${CLOUDFLARED:-$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)}"
SITE_ORIGIN="${SITE_ORIGIN:-https://www.knowledgegraph.tech}"

# The first entry of `git worktree list` is the main checkout, which is where
# app/.env.local lives. A worktree has none of its own.
MAIN_CHECKOUT="$(git -C "$REPO_DIR" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
ENV_FILE="${ENV_FILE:-$MAIN_CHECKOUT/app/.env.local}"
QR_DIR="${QR_DIR:-$(cd "$MAIN_CHECKOUT/.." && pwd)/orchestrator/reports/T222-shots}"
LOG_DIR="$APP_DIR/expo-go-out"
mkdir -p "$LOG_DIR"

# cmux can leave NODE_OPTIONS pointing at a deleted preload file, and then every
# node and npx call dies before it starts.
unset NODE_OPTIONS

[[ -x "$CLOUDFLARED" ]] || { echo "cloudflared not found: brew install cloudflared"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "no Firebase config at $ENV_FILE (set ENV_FILE=...)"; exit 1; }
for port in "$PORT" "$PROXY_PORT"; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN > /dev/null; then
    echo "port $port is in use; stop whatever holds it or run with PORT=<other>"; exit 1
  fi
done

# Only the six EXPO_PUBLIC_FIREBASE_* values are taken from the file, so nothing
# else in it (an emulator host, a local site origin) can leak into this bundle.
while IFS='=' read -r key value; do
  if [[ "$key" =~ ^EXPO_PUBLIC_FIREBASE_[A-Z_]+$ ]]; then export "$key=${value//\"/}"; fi
done < "$ENV_FILE"
[[ -n "${EXPO_PUBLIC_FIREBASE_PROJECT_ID:-}" ]] || { echo "$ENV_FILE has no EXPO_PUBLIC_FIREBASE_PROJECT_ID"; exit 1; }
export EXPO_PUBLIC_USE_EMULATOR=0
export EXPO_PUBLIC_SITE_ORIGIN="$SITE_ORIGIN"

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  # npx hands Metro to a child process; make sure nothing keeps the ports.
  for port in "$PORT" "$PROXY_PORT"; do lsof -ti "tcp:$port" -sTCP:LISTEN | xargs kill 2>/dev/null || true; done
  echo "stopped"
}
trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

# Keep the Mac (display, disk, system) awake for as long as this script runs.
caffeinate -dimsu -w $$ &
PIDS+=($!)

node "$APP_DIR/scripts/expo-go-proxy.mjs" "$PROXY_PORT" "$PORT" > "$LOG_DIR/proxy.log" 2>&1 &
PIDS+=($!)

echo "==> opening a Cloudflare quick tunnel"
"$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$PROXY_PORT" > "$LOG_DIR/cloudflared.log" 2>&1 &
PIDS+=($!)
HOST=""
for _ in $(seq 1 60); do
  HOST=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" | head -1 | sed 's|https://||' || true)
  [[ -n "$HOST" ]] && break
  sleep 1
done
[[ -n "$HOST" ]] || { echo "no tunnel URL; see $LOG_DIR/cloudflared.log"; tail -5 "$LOG_DIR/cloudflared.log"; exit 1; }

# Metro writes this URL into the manifest, so the phone fetches the bundle and
# assets through the tunnel rather than from a LAN address it cannot reach.
export EXPO_PACKAGER_PROXY_URL="https://$HOST"
# exps:// is Expo Go's https form of exp://. The tunnel is https-only in practice.
EXP_URL="exps://$HOST"

"$REPO_DIR/node_modules/.bin/tsx" "$APP_DIR/scripts/expo-go-qr.ts" "$EXP_URL" "$QR_DIR"

echo "==> starting Metro for Expo Go on localhost:$PORT (live Firebase: $EXPO_PUBLIC_FIREBASE_PROJECT_ID)"
# -c because EXPO_PUBLIC_* values are compiled into the bundle, and a cached
# transform from an emulator run would otherwise be served as-is.
( cd "$APP_DIR" && CI=1 npx expo start --go --localhost --port "$PORT" --no-dev --minify -c ) > "$LOG_DIR/metro.log" 2>&1 &
METRO_PID=$!
PIDS+=("$METRO_PID")
for _ in $(seq 1 120); do
  curl -sf "http://localhost:$PORT/status" > /dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://localhost:$PORT/status" > /dev/null || { echo "Metro did not start; see $LOG_DIR/metro.log"; tail -20 "$LOG_DIR/metro.log"; exit 1; }

# Build both bundles now, so the first person to scan is not the one who waits
# a minute for Metro to compile.
for platform in ios android; do
  echo "==> warming the $platform bundle"
  bundle=$(curl -sf -H "expo-platform: $platform" -H 'accept: application/expo+json,application/json' \
    "http://localhost:$PORT/" | python3 -c 'import json,sys; print(json.load(sys.stdin)["launchAsset"]["url"])' || true)
  if [[ -n "$bundle" ]]; then
    curl -sf -o /dev/null "http://localhost:$PORT/${bundle#https://$HOST/}" || echo "    $platform bundle failed; see $LOG_DIR/metro.log"
  fi
done

cat <<EOF

  The app is live for anyone with Expo Go:

    $EXP_URL

  QR code:   $QR_DIR/expo-go-qr.png
  Handout:   $QR_DIR/expo-go.html
  Logs:      $LOG_DIR/

  Leave this running. Ctrl-C stops Metro, the tunnel and caffeinate.
  The link changes on the next run.

EOF
wait "$METRO_PID"
