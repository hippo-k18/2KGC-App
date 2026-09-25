#!/usr/bin/env bash
#
# Deploy the public website to staging and run the pre-publish gate against it.
#
#   bash scripts/publish-web.sh            check, deploy staging, test staging
#   bash scripts/publish-web.sh --test     test staging as it is, no deploy
#   bash scripts/publish-web.sh --fast     skip the unit tests (the browser gate still runs)
#
#   PREPUBLISH_SALES=open bash scripts/publish-web.sh   once Stripe is live
#
# Staging is https://staging.knowledgegraph.tech, the `kgc-staging` service on
# the DigitalOcean droplet. `/opt/kgc/deploy.sh staging` there builds whatever
# is on GitHub for the droplet's branch, so this script refuses to deploy
# unless your local HEAD is pushed and is what the droplet will build.
#
# See PREPUBLISH-TESTS.md for what the gate checks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
TESTS="$ROOT/tests/prepublish"
STAGING_URL="https://staging.knowledgegraph.tech"
DROPLET="root@142.93.180.72"
export PREPUBLISH_SALES="${PREPUBLISH_SALES:-closed}"

DEPLOY=1
FAST=0
for arg in "$@"; do
  case "$arg" in
    --test) DEPLOY=0 ;;
    --fast) FAST=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$TESTS/node_modules" ] || (cd "$TESTS" && npm install --silent && npx playwright install chromium)

if [ "$DEPLOY" = 1 ]; then
  # ── 0. Preflight ──────────────────────────────────────────────────────────
  step "Preflight"

  # Two SSH connections in the whole script, on purpose: the droplet refuses
  # port 22 for a while after a burst of connections, which looks exactly
  # like a network that blocks SSH. If this fails, run
  # '/opt/kgc/deploy.sh staging' from the DigitalOcean console, then
  # 'bash scripts/publish-web.sh --test'.
  REMOTE_BRANCH="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$DROPLET" 'git -C /opt/kgc/app rev-parse --abbrev-ref HEAD')" \
    || fail "cannot reach the droplet over SSH. Deploy from the DigitalOcean console, then: bash scripts/publish-web.sh --test"
  git -C "$ROOT" fetch --quiet origin "$REMOTE_BRANCH"
  LOCAL="$(git -C "$ROOT" rev-parse HEAD)"
  PUSHED="$(git -C "$ROOT" rev-parse "origin/$REMOTE_BRANCH")"
  [ "$LOCAL" = "$PUSHED" ] \
    || fail "staging builds origin/$REMOTE_BRANCH ($(git -C "$ROOT" rev-parse --short "$PUSHED")) but you are on $(git -C "$ROOT" rev-parse --short HEAD). Push, or check out that branch."
  if [ -n "$(git -C "$ROOT" status --porcelain -- apps/web packages scripts)" ]; then
    echo "⚠️  uncommitted changes in apps/web, packages or scripts will not be deployed"
  fi
  # No check for a deploy already running: deploy.sh holds a lock and refuses.

  # ── 1. Static checks ──────────────────────────────────────────────────────
  step "Typecheck"
  (cd "$WEB" && npm run typecheck)

  if [ "$FAST" = 0 ]; then
    step "Unit tests"
    (cd "$ROOT" && npm test)
  fi

  # ── 2. Deploy ─────────────────────────────────────────────────────────────
  step "Deploy staging ($(git -C "$ROOT" rev-parse --short HEAD) on $REMOTE_BRANCH)"
  # Builds beside the live site, checks the new build on a spare port, then
  # switches over with about a second of downtime. See scripts/ops/droplet-deploy.sh.
  ssh -o BatchMode=yes "$DROPLET" '/opt/kgc/deploy.sh staging && cat /opt/kgc/live/web/REVISION' | tee /dev/stderr | tail -1 > "$TESTS/reports/.deployed" \
    || fail "the deploy failed; the live site was left on its previous release"
  DEPLOYED="$(cat "$TESTS/reports/.deployed")"
  [ "${LOCAL:0:10}" = "$DEPLOYED" ] || fail "staging is on $DEPLOYED, expected ${LOCAL:0:10}"
fi

# ── 3. The gate ─────────────────────────────────────────────────────────────
step "Waiting for staging to answer"
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/tickets")" = 200 ] && break
  sleep 2
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$STAGING_URL/tickets")" = 200 ] || fail "$STAGING_URL/tickets is not answering 200"

step "Pre-publish tests against staging"
cd "$TESTS"
if ! PREPUBLISH_URL="$STAGING_URL" npx playwright test --project=desktop --project=mobile; then
  fail "staging failed the gate. Report: (cd tests/prepublish && npm run report)"
fi

step "Staging passed every check"
