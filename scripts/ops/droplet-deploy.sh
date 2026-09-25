#!/bin/bash
#
# Deploy the dashboard, the staging site, or both, with about a second of
# downtime. Installed on the droplet as /opt/kgc/deploy.sh; this file in the
# repo is the source of truth, copy it over after editing:
#
#   scp scripts/ops/droplet-deploy.sh root@142.93.180.72:/opt/kgc/deploy.sh
#
#   /opt/kgc/deploy.sh                    both
#   /opt/kgc/deploy.sh staging            just the public site
#   /opt/kgc/deploy.sh dashboard          just the dashboard
#   /opt/kgc/deploy.sh rollback staging   back to the previous release (~1s)
#   /opt/kgc/deploy.sh status             what is live, and what is kept
#
# ── How it avoids downtime ──────────────────────────────────────────────────
#
# The old script rebuilt inside the folder the live site ran from: `npm ci`
# deleted the node_modules the server was using and `next build` overwrote
# its .next, so staging served errors for the whole build, and sessions took
# to stopping the service first. That was about 3.5 minutes of 503s.
#
# Now every deploy gets its own folder, /opt/kgc/releases/<commit>, and the
# live site keeps running from its own folder untouched until the very end:
#
#   1. Export the commit from GitHub into a new release folder.
#   2. Dependencies: if an app's package-lock.json is unchanged from the live
#      release, its node_modules is hard-linked across (seconds, almost no
#      disk). If it changed, `npm ci` runs in the new folder only.
#   3. `next build` there, at low priority so WordPress stays responsive.
#   4. Start the new build on a spare port and check it answers. A release
#      that fails here never goes near the live site.
#   5. Point /opt/kgc/live/<app> at the new release (one atomic rename) and
#      restart the service. This restart is the only downtime.
#   6. Check the public URL. If it does not come back, switch back to the
#      previous release automatically.
#
# Do not stop the service before deploying. Nothing here needs it stopped,
# and a stopped service is down for the whole build instead of one second.
#
# Settings files live in /opt/kgc/shared (web.env, organizer.env) and are
# linked into every release; the old .env.production paths in /opt/kgc/app
# are links to them too, so there is one copy to edit. After editing one,
# restart the service. /opt/kgc/app is only the git source now; the live
# code is wherever /opt/kgc/live/web and /opt/kgc/live/organizer point.

set -euo pipefail

KGC=/opt/kgc
SRC=$KGC/app
RELEASES=$KGC/releases
LIVE=$KGC/live
SHARED=$KGC/shared
KEEP=3   # releases kept for rollback, besides the live ones

mkdir -p "$RELEASES" "$LIVE"

# One deploy at a time. Two builds at once exhaust a 2GB droplet.
exec 9>"$KGC/.deploy.lock"
if ! flock -n 9; then
  echo "Another deploy is running. Wait for it to finish." >&2
  exit 1
fi

# ── Per-app facts ───────────────────────────────────────────────────────────
app_dir()    { case $1 in web) echo apps/web ;;  organizer) echo apps/organizer ;; esac; }
app_unit()   { case $1 in web) echo kgc-staging ;; organizer) echo kgc-dashboard ;; esac; }
app_port()   { case $1 in web) echo 3200 ;;        organizer) echo 3100 ;; esac; }
check_port() { case $1 in web) echo 3201 ;;        organizer) echo 3101 ;; esac; }
check_path() { case $1 in web) echo /tickets ;;    organizer) echo /login ;; esac; }
public_url() { case $1 in web) echo https://staging.knowledgegraph.tech/tickets ;;
                          organizer) echo https://dashboard.knowledgegraph.tech/login ;; esac; }
env_file()   { echo "$SHARED/$1.env"; }

say() { printf '==> %s\n' "$*"; }

# The folder the service runs from right now: the live release, or the old
# /opt/kgc/app layout the first time this script runs.
current_root() {
  if [ -L "$LIVE/$1" ]; then readlink -f "$LIVE/$1"; else echo "$SRC"; fi
}

# Answers below 400 within the time given?
wait_ok() { # url seconds
  local i
  for i in $(seq 1 "$2"); do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" || true)
    [ "${code:-0}" -ge 200 ] && [ "$code" -lt 400 ] && return 0
    sleep 1
  done
  return 1
}

# The systemd unit, pointed at the live link and the shared settings file.
# Written only if it differs, so this is a no-op after the first deploy.
write_unit() { # app
  local app=$1 unit; unit=$(app_unit "$app")
  local desc; [ "$app" = web ] && desc="KGC public website, staging" || desc="KGC organizer dashboard"
  local want; want=$(cat <<EOF
[Unit]
Description=$desc
After=network.target

[Service]
Type=simple
# A link to the live release. Deploys repoint it and restart; see /opt/kgc/deploy.sh.
WorkingDirectory=$LIVE/$app/$(app_dir "$app")
EnvironmentFile=$(env_file "$app")
# Loopback only. Apache is the only thing that should reach it.
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=512
# Exit at once on stop. Left to itself Next.js shuts down gracefully: it stops
# accepting connections, then waits for open ones to close, and Apache keeps
# its proxy connections open, so the first deploy on this layout sat 35
# seconds refusing visitors before the new release could start. A stop now
# drops at most the one or two requests in flight.
Environment=NEXT_MANUAL_SIG_HANDLE=true
TimeoutStopSec=5
ExecStart=/usr/bin/npx next start --port $(app_port "$app") --hostname 127.0.0.1
Restart=always
RestartSec=5
# WordPress shares this box.
MemoryMax=700M
User=root

[Install]
WantedBy=multi-user.target
EOF
)
  if [ "$(cat "/etc/systemd/system/$unit.service" 2>/dev/null)" != "$want" ]; then
    # Back up the pre-releases unit once; later rewrites must not replace it.
    [ -f "$SHARED/$unit.service.before-releases" ] \
      || cp "/etc/systemd/system/$unit.service" "$SHARED/$unit.service.before-releases"
    printf '%s\n' "$want" > "/etc/systemd/system/$unit.service"
    systemctl daemon-reload
  fi
}

# Move each app's settings out of the old tree into /opt/kgc/shared, once,
# and leave a link behind so there is only ever one copy to edit.
adopt_env() { # app
  local app=$1 old=$SRC/$(app_dir "$1")/.env.production
  if [ ! -f "$(env_file "$app")" ]; then
    cp "$old" "$(env_file "$app")"
    chmod 600 "$(env_file "$app")"
  fi
  ln -sfn "$(env_file "$app")" "$old"
}

# Hard-link a node_modules across when the lockfile matches, else npm ci.
#
# "Matches" means the lockfile the *installed* packages came from, which each
# install records in node_modules/.kgc-lock. Comparing against the source
# folder's package-lock.json would be wrong: /opt/kgc/app has already been
# reset to the new commit by the time this runs. The old layout has no
# record, so its lockfile is trusted once; a mismatch there fails the build
# or the port check, never the live site.
deps() { # from_root to_root subdir(. for the repo root)
  local from=$1/$3 to=$2/$3
  [ -d "$to/node_modules" ] && return 0
  local installed=$from/node_modules/.kgc-lock
  [ -f "$installed" ] || installed=$from/package-lock.json
  if [ -d "$from/node_modules" ] && cmp -s "$installed" "$to/package-lock.json"; then
    say "  $3: lockfile unchanged, linking node_modules"
    cp -al "$from/node_modules" "$to/node_modules"
  else
    say "  $3: lockfile changed, npm ci"
    (cd "$to" && nice -n 10 npm ci --no-audit --no-fund)
  fi
  # rm first: the marker may be a hard link shared with the release it came from.
  rm -f "$to/node_modules/.kgc-lock"
  cp "$to/package-lock.json" "$to/node_modules/.kgc-lock"
}

# ── Commands ────────────────────────────────────────────────────────────────
status() {
  for app in web organizer; do
    printf '%-10s live: %s\n' "$app" "$(basename "$(current_root "$app")")"
    if [ -L "$LIVE/$app.previous" ]; then
      printf '%-10s prev: %s\n' "" "$(basename "$(readlink -f "$LIVE/$app.previous")")"
    fi
  done
  echo "kept:"; ls -1t "$RELEASES" | sed 's/^/  /'
}

switch_to() { # app release_dir  -> repoint, restart, verify, or undo
  local app=$1 rel=$2 unit; unit=$(app_unit "$app")
  local before; before=$(current_root "$app")

  write_unit "$app"
  ln -sfn "$rel" "$LIVE/$app.next" && mv -T "$LIVE/$app.next" "$LIVE/$app"
  say "restarting $unit"
  systemctl restart "$unit"

  if wait_ok "$(public_url "$app")" 45; then
    if [ "$before" != "$rel" ]; then ln -sfn "$before" "$LIVE/$app.previous"; fi
    say "$app is live on $(basename "$rel")"
    return 0
  fi

  echo "!! $(public_url "$app") did not come back. Switching back to $(basename "$before")." >&2
  if [ "$before" = "$SRC" ]; then
    # First deploy on the new layout: put the old unit back.
    rm -f "$LIVE/$app"
    cp "$SHARED/$unit.service.before-releases" "/etc/systemd/system/$unit.service"
    systemctl daemon-reload
  else
    ln -sfn "$before" "$LIVE/$app.next" && mv -T "$LIVE/$app.next" "$LIVE/$app"
  fi
  systemctl restart "$unit"
  return 1
}

rollback() { # app
  local app=$1
  [ -L "$LIVE/$app.previous" ] || { echo "No previous release recorded for $app." >&2; exit 1; }
  local prev; prev=$(readlink -f "$LIVE/$app.previous")
  say "rolling $app back to $(basename "$prev")"
  switch_to "$app" "$prev"
}

deploy() { # apps...
  local apps=("$@")

  say "fetching"
  local branch; branch=$(git -C "$SRC" rev-parse --abbrev-ref HEAD)
  git -C "$SRC" fetch --depth 30 origin "$branch"
  git -C "$SRC" reset --hard "origin/$branch" >/dev/null
  local sha; sha=$(git -C "$SRC" rev-parse --short=10 HEAD)
  git -C "$SRC" log --oneline -1

  local rel=$RELEASES/$sha
  if [ -f "$rel/REVISION" ]; then
    say "release $sha exists, reusing what is already built in it"
  else
    rm -rf "$rel"; mkdir -p "$rel"
    say "exporting $sha to $rel"
    git -C "$SRC" archive HEAD | tar -x -C "$rel"
    echo "$sha" > "$rel/REVISION"
  fi

  # Dependencies come from whatever is live, so an unchanged lockfile is a
  # hard link rather than a reinstall. Each is skipped if already present.
  say "dependencies"
  deps "$(current_root "${apps[0]}")" "$rel" .
  for app in "${apps[@]}"; do deps "$(current_root "$app")" "$rel" "$(app_dir "$app")"; done

  for app in "${apps[@]}"; do
    adopt_env "$app"
    local dir=$rel/$(app_dir "$app")
    ln -sfn "$(env_file "$app")" "$dir/.env.production"

    if [ ! -f "$dir/.next/BUILD_ID" ]; then
      say "building $app"
      (cd "$dir" && NODE_OPTIONS="--max-old-space-size=1400" nice -n 10 npx next build)
    fi

    say "checking $app on port $(check_port "$app")"
    local check=kgc-check-$app
    systemctl stop "$check" 2>/dev/null || true
    systemd-run --quiet --unit="$check" \
      --property=EnvironmentFile="$(env_file "$app")" \
      --property=WorkingDirectory="$dir" \
      --setenv=NODE_ENV=production --setenv=HOSTNAME=127.0.0.1 \
      --setenv=NODE_OPTIONS=--max-old-space-size=512 \
      /usr/bin/npx next start --port "$(check_port "$app")" --hostname 127.0.0.1
    if ! wait_ok "http://127.0.0.1:$(check_port "$app")$(check_path "$app")" 60; then
      systemctl stop "$check" 2>/dev/null || true
      echo "!! the new $app build did not answer on its check port. The live site was not touched." >&2
      exit 1
    fi
    systemctl stop "$check"
  done

  for app in "${apps[@]}"; do switch_to "$app" "$rel"; done

  # Keep the live releases, the previous ones, and the newest $KEEP others.
  local keep=()
  for l in "$LIVE"/*; do [ -L "$l" ] && keep+=("$(readlink -f "$l")"); done
  ls -1t "$RELEASES" | while read -r r; do
    local path=$RELEASES/$r
    printf '%s\n' "${keep[@]}" | grep -qx "$path" && continue
    if [ "$KEEP" -gt 0 ]; then KEEP=$((KEEP - 1)); continue; fi
    say "removing old release $r"; rm -rf "$path"
  done

  echo "==> wordpress: $(curl -s -o /dev/null -w '%{http_code}' https://www.knowledgegraph.tech/)"
}

case "${1:-both}" in
  both)      deploy organizer web ;;
  dashboard) deploy organizer ;;
  staging)   deploy web ;;
  rollback)
    case "${2:-}" in
      staging) rollback web ;; dashboard) rollback organizer ;;
      *) echo "usage: deploy.sh rollback staging|dashboard" >&2; exit 2 ;;
    esac ;;
  status)    status ;;
  *) echo "usage: deploy.sh [both|staging|dashboard|rollback staging|dashboard|status]" >&2; exit 2 ;;
esac
