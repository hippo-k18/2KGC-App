#!/bin/bash
#
# Deploy the dashboard, the public website, or both, with no downtime. The
# website is www.knowledgegraph.tech; it is still called `staging` in the
# commands below. Installed on the droplet as /opt/kgc/deploy.sh; this file in
# the repo is the source of truth, copy it over after editing:
#
#   scp scripts/ops/droplet-deploy.sh root@142.93.180.72:/opt/kgc/deploy.sh
#
#   /opt/kgc/deploy.sh                     both (one app at a time)
#   /opt/kgc/deploy.sh staging             just the public site
#   /opt/kgc/deploy.sh dashboard           just the dashboard
#   /opt/kgc/deploy.sh rollback staging    back to the previous release
#   /opt/kgc/deploy.sh restart staging     same release, fresh process (after editing web.env)
#   /opt/kgc/deploy.sh status              what is live, and what is kept
#   /opt/kgc/deploy.sh setup               one-time switch to the layout below (T272)
#
# ── How it avoids downtime (T272, 2026-10-18) ───────────────────────────────
#
# Each app has two ports, two "colours": web 3200 and 3201, dashboard 3100
# and 3101. One colour serves; the other is idle. A deploy:
#
#   1. Exports the commit into its own folder, /opt/kgc/releases/<commit>,
#      links or installs node_modules and runs `next build` there. The live
#      site is not touched.
#   2. Starts the new release on the idle colour (`kgc-web@3201`, say) and
#      waits for it to answer. A release that fails here never goes live.
#   3. Points Apache at the new port: it rewrites one line in
#      /etc/apache2/conf-available/kgc-backends.conf, checks the config, and
#      reloads gracefully. A graceful reload keeps Apache listening the whole
#      time and lets requests already in flight finish on the old colour.
#   4. Checks the public URL. If it fails, Apache goes straight back to the
#      old colour, which is still running.
#   5. Waits for Apache's connections to the old colour to drain (30 s at
#      most), then stops it.
#
# The old script restarted the one service on its fixed port, and Apache
# answered 503 until `next start` was listening again: about a second, more
# under load. Now no request ever meets a closed port.
#
# Rollback and restart are the same swap without a build: the previous (or
# current) release starts on the idle colour and Apache moves to it.
#
# Memory: for the length of a swap the app runs twice, which is what the old
# script's port check already did (a second `next start` on 3201/3101). Apps
# are swapped one at a time, never both at once.
#
# ── Things that must not be done by hand any more ───────────────────────────
#
# - `systemctl restart kgc-web@…` is a real outage for that colour, and
#   restarting the idle one starts a second copy. Use `deploy.sh restart`.
# - The old units `kgc-staging` and `kgc-dashboard` are retired by the first
#   swap after `setup` (their files are kept in /opt/kgc/shared). Starting one
#   again would take a port the idle colour needs.
# - Anything on the droplet that wants the dashboard or website directly reads
#   the live port from /opt/kgc/live/<app>.port (the CFP cron does).
#
# Settings files live in /opt/kgc/shared (web.env, organizer.env) and are
# linked into every release. /opt/kgc/app is only the git source; the live
# code is wherever /opt/kgc/live/web and /opt/kgc/live/organizer point.

set -euo pipefail

KGC=${KGC_ROOT:-/opt/kgc}
SRC=$KGC/app
RELEASES=$KGC/releases
LIVE=$KGC/live
SHARED=$KGC/shared
KEEP=3   # releases kept for rollback, besides the live ones
APACHE=${KGC_APACHE_DIR:-/etc/apache2}
BACKENDS=$APACHE/conf-available/kgc-backends.conf
UNITS=${KGC_UNIT_DIR:-/etc/systemd/system}
DRAIN_MAX=30  # seconds to wait for Apache's old connections before stopping the old colour

mkdir -p "$RELEASES" "$LIVE"

# One deploy at a time. Two builds, or two swaps, at once exhaust a 2GB droplet.
exec 9>"$KGC/.deploy.lock"
if ! flock -n 9; then
  echo "Another deploy is running. Wait for it to finish." >&2
  exit 1
fi

# ── Per-app facts ───────────────────────────────────────────────────────────
app_dir()     { case $1 in web) echo apps/web ;;      organizer) echo apps/organizer ;; esac; }
app_tmpl()    { case $1 in web) echo kgc-web ;;       organizer) echo kgc-dash ;; esac; }
legacy_unit() { case $1 in web) echo kgc-staging ;;   organizer) echo kgc-dashboard ;; esac; }
ports()       { case $1 in web) echo "3200 3201" ;;   organizer) echo "3100 3101" ;; esac; }
define_name() { case $1 in web) echo KGC_WEB_PORT ;;  organizer) echo KGC_DASH_PORT ;; esac; }
check_path()  { case $1 in web) echo /tickets ;;      organizer) echo /login ;; esac; }
public_url()  { case $1 in web) echo "${KGC_PUBLIC_WEB:-https://www.knowledgegraph.tech/tickets}" ;;
                           organizer) echo "${KGC_PUBLIC_DASH:-https://dashboard.knowledgegraph.tech/login}" ;; esac; }
env_file()    { echo "$SHARED/$1.env"; }

say() { printf '==> %s\n' "$*"; }
die() { echo "!! $*" >&2; exit 1; }

# The port serving now. Before `setup` (and before the first swap after it)
# that is the old unit's fixed port.
active_port() { # app
  if [ -f "$LIVE/$1.port" ]; then cat "$LIVE/$1.port"; else ports "$1" | cut -d' ' -f1; fi
}
idle_port() { # app
  local a; a=$(active_port "$1")
  for p in $(ports "$1"); do [ "$p" != "$a" ] && { echo "$p"; return; }; done
}

# The release the live colour runs, or the old /opt/kgc/app layout.
current_root() {
  if [ -L "$LIVE/$1" ]; then readlink -f "$LIVE/$1"; else echo "$SRC"; fi
}

# Answers below 400 within the time given? Polled twice a second.
wait_ok() { # url seconds
  local i code
  for i in $(seq 1 $(( $2 * 2 ))); do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" || true)
    [ "${code:-0}" -ge 200 ] && [ "$code" -lt 400 ] && return 0
    sleep 0.5
  done
  return 1
}

listening() { ss -Hltn "( sport = :$1 )" | grep -q .; }

# Is Apache using the ${KGC_*_PORT} names yet? `setup` makes it so.
setup_done() { [ -f "$BACKENDS" ] && [ -L "$APACHE/conf-enabled/kgc-backends.conf" ]; }

# ── The units ───────────────────────────────────────────────────────────────
# One template per app; the instance is the port. Written only if it differs.
write_units() {
  local app tmpl want desc oom
  for app in web organizer; do
    tmpl=$(app_tmpl "$app")
    if [ "$app" = web ]; then desc="KGC public website (www.knowledgegraph.tech)"; oom="OOMScoreAdjust=-500"
    else desc="KGC organizer dashboard"; oom="# Deliberately the default OOM score: the kernel kills this before the website."; fi
    want=$(cat <<EOF
[Unit]
Description=$desc, colour on port %i
After=network.target

[Service]
Type=simple
# The release this colour runs. /opt/kgc/deploy.sh points it and starts the
# colour; never restart a colour by hand, use 'deploy.sh restart'.
WorkingDirectory=$LIVE/$app-%i/$(app_dir "$app")
EnvironmentFile=$(env_file "$app")
# Loopback only. Apache is the only thing that should reach it.
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=512
# Exit at once on stop. Left to itself Next.js shuts down gracefully, waiting
# for Apache's kept-alive proxy connections, which took 35 s on the first
# deploy of the releases layout. By the time a colour is stopped Apache has
# moved off it and its connections have drained.
Environment=NEXT_MANUAL_SIG_HANDLE=true
TimeoutStopSec=5
ExecStart=/usr/bin/npx next start --port %i --hostname 127.0.0.1
Restart=always
RestartSec=5
# The droplet is small.
MemoryMax=700M
$oom
User=root

[Install]
WantedBy=multi-user.target
EOF
)
    if [ "$(cat "$UNITS/$tmpl@.service" 2>/dev/null)" != "$want" ]; then
      printf '%s\n' "$want" > "$UNITS/$tmpl@.service"
      systemctl daemon-reload
    fi
  done
}

# ── Apache ──────────────────────────────────────────────────────────────────
# Write the two port definitions, check the whole config, reload gracefully.
# Restores the previous file and returns 1 if the check fails.
point_apache() { # app port
  local web dash
  web=$(active_port web); dash=$(active_port organizer)
  [ "$1" = web ] && web=$2 || dash=$2
  local tmp=$BACKENDS.new
  cat > "$tmp" <<EOF
# Written by /opt/kgc/deploy.sh: the ports of the live colours (T272).
# The vhosts proxy to \${KGC_WEB_PORT} and \${KGC_DASH_PORT}. Do not edit by
# hand while a deploy runs; 'deploy.sh status' shows what is live.
Define KGC_WEB_PORT $web
Define KGC_DASH_PORT $dash
EOF
  cp -p "$BACKENDS" "$BACKENDS.prev"
  mv -f "$tmp" "$BACKENDS"
  if ! apache2ctl -t >/dev/null 2>&1; then
    mv -f "$BACKENDS.prev" "$BACKENDS"
    echo "!! Apache refused the new config; it was put back and not reloaded." >&2
    apache2ctl -t >&2 || true
    return 1
  fi
  # Graceful: Apache keeps its sockets open and lets in-flight requests finish.
  systemctl reload apache2
}

# Wait (10 s at most) until the CPU is at least half idle over half a second.
#
# A graceful reload is ~15 ms on an idle box, but Apache starts its new
# children from a once-a-second housekeeping loop, and on this one CPU, with a
# build's leftover workers or a process still starting, the tests saw requests
# queue for a full second (queued, not refused). So the reload waits for quiet.
wait_cpu_quiet() {
  local i a b idle total
  for i in $(seq 1 20); do
    a=$(awk '/^cpu /{print $5+$6, $2+$3+$4+$5+$6+$7+$8}' /proc/stat)
    sleep 0.5
    b=$(awk '/^cpu /{print $5+$6, $2+$3+$4+$5+$6+$7+$8}' /proc/stat)
    idle=$(( ${b% *} - ${a% *} )); total=$(( ${b#* } - ${a#* } ))
    [ "$total" -gt 0 ] && [ $(( idle * 100 / total )) -ge 50 ] && return 0
  done
  echo "   (CPU still busy after 10 s; reloading anyway)"
}

# Wait until no connection from Apache to `port` is open, then a moment more.
drain() { # port
  local i
  for i in $(seq 1 $(( DRAIN_MAX * 2 ))); do
    ss -Htn state established "( dport = :$1 )" | grep -q . || { sleep 1; return 0; }
    sleep 0.5
  done
  echo "   (connections to :$1 still open after ${DRAIN_MAX}s; stopping anyway)"
}

# Stop whatever serves `port` for `app`: its colour, or the old fixed unit.
stop_colour() { # app port
  local app=$1 port=$2 tmpl legacy
  tmpl=$(app_tmpl "$app"); legacy=$(legacy_unit "$app")
  if [ "$port" = "$(ports "$app" | cut -d' ' -f1)" ] && [ -f "$UNITS/$legacy.service" ]; then
    # The first swap after `setup`: retire the old unit for good, keeping its
    # files, so a stray `systemctl restart kgc-staging` cannot take the port.
    say "retiring $legacy (kept in $SHARED/retired-units)"
    systemctl stop "$legacy" 2>/dev/null || true
    systemctl disable "$legacy" 2>/dev/null || true
    mkdir -p "$SHARED/retired-units"
    mv -f "$UNITS/$legacy.service" "$SHARED/retired-units/"
    [ -d "$UNITS/$legacy.service.d" ] && rm -rf "$SHARED/retired-units/$legacy.service.d" \
      && mv -f "$UNITS/$legacy.service.d" "$SHARED/retired-units/"
    systemctl daemon-reload
  fi
  systemctl stop "$tmpl@$port" 2>/dev/null || true
  systemctl disable "$tmpl@$port" 2>/dev/null || true
}

# ── The swap ────────────────────────────────────────────────────────────────
# Start `rel` on the idle colour, move Apache to it, retire the old colour.
# The live site is untouched unless every check passes, and goes straight back
# to the old colour (still running) if the public check fails.
swap_to() { # app release_dir
  local app=$1 rel=$2 tmpl; tmpl=$(app_tmpl "$app")
  setup_done || die "run '/opt/kgc/deploy.sh setup' once first (T272)."
  write_units
  local before old new
  before=$(current_root "$app"); old=$(active_port "$app"); new=$(idle_port "$app")

  # A stale idle colour (a deploy killed half way) is stopped first.
  if listening "$new"; then
    systemctl stop "$tmpl@$new" 2>/dev/null || true
    sleep 1
    listening "$new" && die "port $new is busy with something deploy.sh did not start. The live site was not touched."
  fi

  ln -sfn "$rel" "$LIVE/$app-$new"
  say "starting $(basename "$rel") as $tmpl@$new"
  systemctl start "$tmpl@$new"
  if ! wait_ok "http://127.0.0.1:$new$(check_path "$app")" 90; then
    stop_colour "$app" "$new"
    die "the new $app process did not answer on port $new. The live site was not touched."
  fi
  # Warm the pages a first visitor hits, so they are not the ones who wait.
  curl -s -o /dev/null -m 20 "http://127.0.0.1:$new/" || true
  curl -s -o /dev/null -m 20 "http://127.0.0.1:$new$(check_path "$app")" || true

  wait_cpu_quiet
  say "pointing Apache at :$new"
  if ! point_apache "$app" "$new"; then
    stop_colour "$app" "$new"
    die "Apache config check failed. The live site was not touched."
  fi
  echo "$new" > "$LIVE/$app.port.new" && mv -f "$LIVE/$app.port.new" "$LIVE/$app.port"

  if ! wait_ok "$(public_url "$app")" 30; then
    echo "!! $(public_url "$app") did not answer. Pointing Apache back at :$old." >&2
    point_apache "$app" "$old" || true
    echo "$old" > "$LIVE/$app.port"
    stop_colour "$app" "$new"
    return 1
  fi

  ln -sfn "$rel" "$LIVE/$app.next" && mv -T "$LIVE/$app.next" "$LIVE/$app"
  if [ "$before" != "$rel" ]; then ln -sfn "$before" "$LIVE/$app.previous"; fi
  systemctl enable --quiet "$tmpl@$new"

  say "draining :$old"
  drain "$old"
  stop_colour "$app" "$old"
  rm -f "$LIVE/$app-$old"
  say "$app is live on $(basename "$rel") (port $new)"
}

# ── Commands ────────────────────────────────────────────────────────────────
status() {
  for app in web organizer; do
    printf '%-10s live: %s on port %s\n' "$app" "$(basename "$(current_root "$app")")" "$(active_port "$app")"
    if [ -L "$LIVE/$app.previous" ]; then
      printf '%-10s prev: %s\n' "" "$(basename "$(readlink -f "$LIVE/$app.previous")")"
    fi
  done
  setup_done || echo "(setup not run yet: Apache still has fixed ports)"
  echo "kept:"; ls -1t "$RELEASES" | sed 's/^/  /'
}

rollback() { # app
  local app=$1
  [ -L "$LIVE/$app.previous" ] || die "No previous release recorded for $app."
  local prev; prev=$(readlink -f "$LIVE/$app.previous")
  say "rolling $app back to $(basename "$prev")"
  swap_to "$app" "$prev"
}

restart() { # app
  local app=$1
  [ -L "$LIVE/$app" ] || die "No live release recorded for $app."
  local cur prev
  cur=$(readlink -f "$LIVE/$app")
  prev=$( [ -L "$LIVE/$app.previous" ] && readlink -f "$LIVE/$app.previous" || true)
  say "restarting $app on $(basename "$cur") (settings reread)"
  swap_to "$app" "$cur"
  # A restart is not a release: keep the rollback target as it was.
  [ -n "$prev" ] && ln -sfn "$prev" "$LIVE/$app.previous" || true
}

# One-time: move Apache from fixed ports to ${KGC_WEB_PORT}/${KGC_DASH_PORT},
# install the colour units, and point the CFP cron at the live-port file.
# Nothing changes for visitors: the ports defined are the ones live now, the
# reload is graceful, and the old units keep running until the first swap.
setup() {
  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  local backup=/root/backups/t272-zero-downtime-$stamp
  mkdir -p "$backup"
  say "backing up to $backup"
  tar -czf "$backup/etc-apache2.tgz" -C / "${APACHE#/}"
  cp -a "$UNITS"/kgc-* "$backup/" 2>/dev/null || true
  [ -f "$KGC/deploy.sh" ] && cp -a "$KGC/deploy.sh" "$backup/deploy.sh"

  [ -f "$BACKENDS" ] || cat > "$BACKENDS" <<EOF
# Written by /opt/kgc/deploy.sh: the ports of the live colours (T272).
Define KGC_WEB_PORT $(active_port web)
Define KGC_DASH_PORT $(active_port organizer)
EOF
  [ -f "$BACKENDS.prev" ] || cp -p "$BACKENDS" "$BACKENDS.prev"
  ln -sfn ../conf-available/kgc-backends.conf "$APACHE/conf-enabled/kgc-backends.conf"

  local f changed=0
  for f in "$APACHE"/sites-available/*.conf; do
    if grep -qE '127\.0\.0\.1:(3200|3100)/' "$f"; then
      sed -i -E 's#127\.0\.0\.1:3200/#127.0.0.1:${KGC_WEB_PORT}/#g; s#127\.0\.0\.1:3100/#127.0.0.1:${KGC_DASH_PORT}/#g' "$f"
      say "  $(basename "$f") now uses the port names"
      changed=1
    fi
  done

  if ! apache2ctl -t >/dev/null 2>&1; then
    echo "!! Apache config check failed after setup. Restoring $backup/etc-apache2.tgz." >&2
    apache2ctl -t >&2 || true
    rm -rf "$APACHE" && tar -xzf "$backup/etc-apache2.tgz" -C /
    exit 1
  fi
  [ "$changed" = 1 ] && systemctl reload apache2

  # The CFP cron called the dashboard on 3100; it now reads the live port.
  local cron=$UNITS/kgc-cfp-cron.service
  if [ -f "$cron" ] && grep -q '127.0.0.1:3100/' "$cron"; then
    sed -i 's#127\.0\.0\.1:3100/#127.0.0.1:$$(cat /opt/kgc/live/organizer.port 2>/dev/null || echo 3100)/#' "$cron"
    say "  kgc-cfp-cron.service now reads /opt/kgc/live/organizer.port"
  fi

  write_units
  systemctl daemon-reload
  say "setup done. Visitors saw nothing; the next deploy, restart or rollback is the first colour swap."
}

deploy() { # apps...
  local apps=("$@")
  setup_done || die "run '/opt/kgc/deploy.sh setup' once first (T272)."

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

  # Build everything first, then swap one app at a time: a build and a swap
  # never share the memory.
  for app in "${apps[@]}"; do
    local dir=$rel/$(app_dir "$app")
    ln -sfn "$(env_file "$app")" "$dir/.env.production"

    if [ ! -f "$dir/.next/BUILD_ID" ]; then
      say "building $app"
      (cd "$dir" && NODE_OPTIONS="--max-old-space-size=1400" nice -n 10 npx next build)
    fi

    # The image optimizer cache outlives releases (T121): a cold AVIF encode of
    # the hero takes ~5 s on this 1-CPU box. Cache keys include the image hash,
    # so a changed image is a new entry, never a stale one.
    if [ "$app" = web ]; then
      mkdir -p "$SHARED/next-image-cache" "$dir/.next/cache"
      if [ ! -L "$dir/.next/cache/images" ]; then
        rm -rf "$dir/.next/cache/images"
        ln -s "$SHARED/next-image-cache" "$dir/.next/cache/images"
      fi
    fi
  done

  for app in "${apps[@]}"; do swap_to "$app" "$rel"; done

  # Keep the live releases, the previous ones, and the newest $KEEP others.
  local keep=()
  for l in "$LIVE"/*; do [ -L "$l" ] && keep+=("$(readlink -f "$l")"); done
  ls -1t "$RELEASES" | while read -r r; do
    local path=$RELEASES/$r
    printf '%s\n' "${keep[@]}" | grep -qx "$path" && continue
    if [ "$KEEP" -gt 0 ]; then KEEP=$((KEEP - 1)); continue; fi
    say "removing old release $r"; rm -rf "$path"
  done

  echo "==> old site archive: $(curl -s -o /dev/null -w '%{http_code}' "${KGC_PUBLIC_ARCHIVE:-https://archive.knowledgegraph.tech/}")"
}

# Hard-link a node_modules across when the lockfile matches, else npm ci.
#
# "Matches" means the lockfile the *installed* packages came from, which each
# install records in node_modules/.kgc-lock. Comparing against the source
# folder's package-lock.json would be wrong: /opt/kgc/app has already been
# reset to the new commit by the time this runs.
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

case "${1:-both}" in
  both)      deploy organizer web ;;
  dashboard) deploy organizer ;;
  staging)   deploy web ;;
  rollback|restart)
    case "${2:-}" in
      staging) "$1" web ;; dashboard) "$1" organizer ;;
      *) echo "usage: deploy.sh $1 staging|dashboard" >&2; exit 2 ;;
    esac ;;
  status)    status ;;
  setup)     setup ;;
  *) echo "usage: deploy.sh [both|staging|dashboard|rollback staging|dashboard|restart staging|dashboard|status|setup]" >&2; exit 2 ;;
esac
