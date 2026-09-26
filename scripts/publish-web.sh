#!/usr/bin/env bash
#
# Deploy the public website and run the pre-publish gate against it.
#
#   bash scripts/publish-web.sh            check, deploy, test the live site
#   bash scripts/publish-web.sh --test     test the live site as it is, no deploy
#   bash scripts/publish-web.sh --fast     skip the unit tests (the browser gate still runs)
#
#   PREPUBLISH_SALES=open bash scripts/publish-web.sh   once Stripe is live
#
# The site is https://www.knowledgegraph.tech since 2026-09-26 (staging.
# redirects there), served by the `kgc-staging` service on the DigitalOcean
# droplet; the unit kept its old name. `/opt/kgc/deploy.sh staging` there builds whatever
# is on GitHub for the droplet's branch, so this script refuses to deploy
# unless your local HEAD is pushed and is what the droplet will build.
#
# See PREPUBLISH-TESTS.md for what the gate checks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
TESTS="$ROOT/tests/prepublish"
STAGING_URL="https://www.knowledgegraph.tech"
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
  step "No secrets in the repo"
  # Tracked files only; .env.local and friends are gitignored and stay local.
  if git -C "$ROOT" grep -nIE '(sk|rk)_live_[A-Za-z0-9]{8}|(sk|rk)_test_[A-Za-z0-9]{20}|whsec_[A-Za-z0-9]{20}|-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . ':!*.md' ':!tests/prepublish/**'; then
    fail "a secret key is committed (above). Remove it, rotate it in Stripe, and rewrite the commit before pushing."
  fi
  # Next.js copies any NEXT_PUBLIC_ variable into the browser bundle as-is.
  if git -C "$ROOT" grep -nIE 'NEXT_PUBLIC_[A-Z_]*(SECRET|PASSPHRASE|PASSWORD|PRIVATE|STRIPE_SK|WEBHOOK|RESEND)' -- apps packages; then
    fail "a secret is named NEXT_PUBLIC_ (above), which ships it to every visitor."
  fi

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
  # The leak scan rides the same connection, fed on stdin, so it checks the
  # release that just went live without a third SSH connection.
  set +e
  ssh -o BatchMode=yes "$DROPLET" '/opt/kgc/deploy.sh staging </dev/null && bash -s && cat /opt/kgc/live/web/REVISION' \
    < "$ROOT/scripts/ops/leak-scan.sh" | tee /dev/stderr | tail -1 > "$TESTS/reports/.deployed"
  STATUS=${PIPESTATUS[0]}
  set -e
  [ "$STATUS" = 3 ] && fail "SECRETS ARE BEING SERVED on staging (named above). Roll back with '/opt/kgc/deploy.sh rollback staging' on the droplet and rotate those keys."
  [ "$STATUS" = 0 ] || fail "the deploy failed; the live site was left on its previous release"
  DEPLOYED="$(cat "$TESTS/reports/.deployed")"
  [ "${LOCAL:0:10}" = "$DEPLOYED" ] || fail "staging is on $DEPLOYED, expected ${LOCAL:0:10}"
else
  step "Leak scan of the live release"
  set +e
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$DROPLET" 'bash -s' < "$ROOT/scripts/ops/leak-scan.sh"
  STATUS=$?
  set -e
  [ "$STATUS" = 3 ] && fail "SECRETS ARE BEING SERVED on staging (named above). Rotate those keys."
  [ "$STATUS" = 0 ] || echo "⚠️  could not run the leak scan over SSH; the browser checks below still look for key patterns"
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
