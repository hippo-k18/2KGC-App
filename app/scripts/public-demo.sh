#!/usr/bin/env bash
#
# Put the whole demo on the public internet: the Expo bundle *and* the Firebase
# emulators behind it, so someone in another country can scan the QR and use a
# populated app with no account and no wifi in common with this Mac.
#
# Three tunnels, because a cloudflared quick tunnel maps one local port:
#
#   8081  Metro          the JS bundle Expo Go downloads
#   9099  Auth emulator  sign-in
#   8080  Firestore      the seeded event data
#
# WHY NOT `expo start --tunnel`
# It goes through @expo/ngrok, which as of 2026-08 dies immediately with
# "TypeError: Cannot read properties of undefined (reading 'body')" — ngrok's
# free tier now needs an authtoken and the bundled client never asks for one.
# cloudflared quick tunnels need no account at all.
#
# WHY THIS REWRITES .env.local
# EXPO_PUBLIC_* values are inlined by Metro at bundle time, so the tunnel
# hostnames have to be on disk *before* the server starts — printing them for
# you to paste would be one step too late. Quick-tunnel hostnames are random per
# run, so the alternative is editing three lines by hand every time.
#
# WHY EXPO_PACKAGER_PROXY_URL IS LOAD-BEARING
# Metro builds the manifest's launchAsset URL from its own host and port, so
# without it the bundle is advertised at `https://<host>:8081/`. The tunnel only
# listens on 443, so a remote phone fetches the manifest and then hangs — which
# presents as Expo Go stuck on "Downloading", not as a config error.
#
# SECURITY: this publishes an unauthenticated-to-you URL that fronts a database.
# The rules still apply (an anonymous read is denied), but with
# EXPO_PUBLIC_OPEN_SIGNIN=1 anyone who has the link can sign in as the demo
# organizer. That is only acceptable because the emulator holds synthetic seed
# data. Never point this at a real attendee list. Ctrl-C tears every tunnel down.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env.local"
PIDS=()

command -v cloudflared >/dev/null || { echo "cloudflared missing: brew install cloudflared"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }

# Kills a pid and everything it spawned. `npx expo start` is a wrapper: killing
# the pid this script recorded leaves the real Metro process holding port 8081,
# and the next run then finds the port busy (see the preflight below).
kill_tree() {
  local p="$1" child
  for child in $(pgrep -P "$p" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$p" 2>/dev/null || true
}

# `${PIDS[@]:-}` is unsafe on an empty array under bash 3.2; this form is not.
cleanup() { for p in ${PIDS[@]+"${PIDS[@]}"}; do kill_tree "$p"; done; }
trap cleanup EXIT INT TERM

# Anything surviving a previous run has to go before we start, because both
# failure modes are silent. A leftover Metro makes `expo start` print "Port 8081
# is running this app in another window", ask to use 8082, get no answer in a
# non-interactive shell and then *skip the dev server entirely* — leaving the new
# tunnel pointed at the old Metro, which still advertises the previous run's
# hostname in launchAsset. A leftover cloudflared just wastes a tunnel.
# Only ports this script owns are touched; the emulators on 8080/9099 are not.
for stale in $(lsof -ti TCP:8081 -sTCP:LISTEN 2>/dev/null || true); do
  kill_tree "$stale"
done
pkill -f 'cloudflared tunnel --url http://localhost:(8081|8080|9099)' 2>/dev/null || true

# Opens a quick tunnel to $1 and echoes its https origin.
open_tunnel() {
  local port="$1" log
  log="$(mktemp -t kgc-tunnel)"
  cloudflared tunnel --url "http://localhost:${port}" --no-autoupdate >"$log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 60); do
    local url
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)"
    [ -n "$url" ] && { echo "$url"; return 0; }
    sleep 1
  done
  echo "cloudflared never printed a URL for port ${port}; see $log" >&2
  return 1
}

# Sets KEY=value in .env.local, replacing the line if the key is already there.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # A URL contains slashes, so use a separator that cannot appear in one.
    sed -i '' "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

echo "opening tunnels…"
AUTH_URL="$(open_tunnel 9099)"
FS_URL="$(open_tunnel 8080)"
METRO_URL="$(open_tunnel 8081)"

set_env EXPO_PUBLIC_USE_EMULATOR 1
set_env EXPO_PUBLIC_EMULATOR_AUTH_URL "$AUTH_URL"
set_env EXPO_PUBLIC_EMULATOR_FIRESTORE_URL "$FS_URL"
set_env EXPO_PUBLIC_OPEN_SIGNIN 1

METRO_HOST="${METRO_URL#https://}"
cat <<EOF

  Expo Go:    exp://${METRO_HOST}
  Auth:       ${AUTH_URL}
  Firestore:  ${FS_URL}

  Sign in with anything — any email, any password, or neither.

EOF

cd "$APP_DIR"
# -c because the tunnel hostnames just changed and Metro inlines them.
EXPO_PACKAGER_PROXY_URL="$METRO_URL" REACT_NATIVE_PACKAGER_HOSTNAME="$METRO_HOST" \
  npx expo start --port 8081 -c &
PIDS+=($!)
# Plain `wait`, not `wait "${PIDS[-1]}"`: macOS ships bash 3.2, which has no
# negative array subscripts. That form failed instantly, and because it was the
# last line the script exited and the EXIT trap tore all three tunnels down
# about a second after Metro finished starting.
wait
