#!/usr/bin/env bash
# The HubSpot contact sync end to end (T333, T335): the real dashboard screen,
# on a production build, against the strict fake HubSpot. An owner connects
# with a made-up token, maps fields, creates the KGC properties and turns the
# sync on; a paid order, refunds of a person holding two tickets and Sync all
# now reach the fake; rate limits, an outage, a refused token, an unreadable
# token, a hanging HubSpot and a rejected contact show on the screen; non-owners
# are refused on the page and on every action.
#
# Private ports only: Firestore 8333 (never the shared 8080), the dashboard on
# :3333 and the fake HubSpot on :12133. Nothing here reaches live Firebase or
# HubSpot, and no real token is ever used.
#
#   bash tests/prepublish/hubspot-e2e/run.sh                          # next build + next start
#   HUBSPOT_E2E_SKIP_BUILD=1 bash tests/prepublish/hubspot-e2e/run.sh # reuse the last build
#   HUBSPOT_E2E_DEV=1 bash tests/prepublish/hubspot-e2e/run.sh        # next dev, for writing specs
#   HUBSPOT_E2E_ARGS='1-sync.spec.ts -g hang' bash ...                 # pass anything to playwright
#
# The build goes to apps/organizer/.next-t333-e2e, so it never touches a dev
# server's .next; tsconfig.json and next-env.d.ts, which next rewrites, are put
# back afterwards. Screenshots go to orchestrator/reports/T335-shots (or
# HUBSPOT_E2E_SHOTS).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

# A cmux helper in NODE_OPTIONS can crash node; this run needs none.
unset NODE_OPTIONS

for port in 8333 9433 4433 4533 3333 12133; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop whatever holds it and run again." >&2
    exit 1
  fi
done

export GCLOUD_PROJECT=demo-hubspot-e2e
export E2E_PORT=3333
export E2E_URL="http://localhost:$E2E_PORT"
export FIRESTORE_REST="http://127.0.0.1:8333"
export FAKE_HUBSPOT_PORT=12133
export FAKE_HUBSPOT_URL="http://127.0.0.1:$FAKE_HUBSPOT_PORT"

cat > "$HERE/.firebase.json" <<JSON
{ "firestore": { "rules": "$ROOT/firestore.rules" },
  "emulators": { "firestore": { "port": 8333, "host": "127.0.0.1", "websocketPort": 9433 },
                 "hub": { "port": 4433 }, "logging": { "port": 4533 },
                 "ui": { "enabled": false }, "singleProjectMode": true } }
JSON

export TMPDIR="$HERE/.tmp"
mkdir -p "$TMPDIR"
cd "$ROOT"
exec npx firebase emulators:exec --only firestore --config "$HERE/.firebase.json" --project "$GCLOUD_PROJECT" \
  "bash '$HERE/inner.sh'"
