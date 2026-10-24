#!/bin/bash
#
# Look for secrets in the files the droplet hands to browsers.
#
# Runs on the droplet. publish-web.sh pipes it over SSH after every deploy,
# so nothing needs installing there. To run it by hand:
#
#   ssh root@142.93.180.72 'bash -s' < scripts/ops/leak-scan.sh
#
# Two checks, over each app's .next/static and public folders, which are
# served to anyone without signing in:
#
#   1. Key shapes: Stripe secret and restricted keys, webhook secrets,
#      private keys, service account JSON.
#   2. Exact values: every secret in the app's settings file. This catches
#      secrets with no recognisable shape, like WEB_ORDER_SECRET or the
#      console passphrase, which a pattern can never find.
#
# Prints only the NAME of anything it finds, never the value. Exit 3 on a leak.

set -uo pipefail

LIVE="${LEAK_SCAN_LIVE:-/opt/kgc/live}"   # overridable only to test this script
SHARED="${LEAK_SCAN_SHARED:-/opt/kgc/shared}"
PATTERN='(sk|rk)_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"[[:space:]]*:|re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}'
leaks=0
scanned=0

for app in web organizer; do
  root="$LIVE/$app/apps/$app"
  env="$SHARED/$app.env"
  dirs=()
  for d in "$root/.next/static" "$root/public"; do [ -d "$d" ] && dirs+=("$d"); done
  if [ ${#dirs[@]} = 0 ]; then
    echo "leak-scan: no public files found for $app under $root" >&2
    exit 1
  fi
  scanned=$((scanned + $(find "${dirs[@]}" -type f | wc -l)))

  while IFS= read -r file; do
    echo "LEAK ($app): a secret key pattern is in ${file#"$root"/}"
    leaks=1
  done < <(grep -rlE "$PATTERN" "${dirs[@]}")

  [ -f "$env" ] || continue
  while IFS= read -r line; do
    name="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    case "$name" in
      *SECRET*|*_KEY|*PASSPHRASE*|*PASSWORD*|*TOKEN*|*SERVICE_ACCOUNT*) ;;
      *) continue ;;
    esac
    # Short values would match by chance.
    [ ${#value} -ge 8 ] || continue
    if grep -rqF -- "$value" "${dirs[@]}"; then
      echo "LEAK ($app): the value of $name is in a public file"
      leaks=1
    fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$env")
done

if [ "$leaks" = 1 ]; then
  echo "leak-scan: FAILED. Rotate every key named above before doing anything else." >&2
  exit 3
fi
echo "leak-scan: no secrets in $scanned public files"
