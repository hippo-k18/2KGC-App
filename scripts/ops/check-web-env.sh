#!/usr/bin/env bash
# Run on the droplet by publish-web.sh. Exits non-zero when a setting a paid
# checkout depends on is missing. Prints names, never values.
set -u
ENV_FILE="${1:-/opt/kgc/shared/web.env}"
value() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
v="$(value WEB_ORDER_SECRET)"
if [ "${#v}" -lt 16 ]; then
  echo "WEB_ORDER_SECRET missing or shorter than 16 characters in $ENV_FILE" >&2
  exit 1
fi
