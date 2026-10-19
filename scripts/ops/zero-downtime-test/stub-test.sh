#!/bin/bash
#
# Runs droplet-deploy.sh against stand-ins for systemd, Apache, curl and ss, in
# a temp folder, with no container, no network and no root. It needs only bash,
# git and python3, so it runs on a Mac as well as on Linux:
#
#   bash scripts/ops/zero-downtime-test/stub-test.sh
#
# The stand-ins keep a small model of the droplet: which ports have a process
# answering, and which port Apache points at for each app. They also check the
# one rule that makes a deploy zero-downtime, on every call:
#
#   - Apache is never reloaded onto a port that has nothing answering;
#   - the process Apache points at is never stopped.
#
# A broken rule is logged as VIOLATION and fails the run. What this cannot
# show: real timing (Apache's reload, Next.js start-up, connection draining),
# memory, or the Linux tools themselves. The Docker run in README.md covers
# those.

set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=${SCRIPT:-$HERE/../droplet-deploy.sh}
T=$(mktemp -d "${TMPDIR:-/tmp}/kgc-stub.XXXXXX")
trap 'rm -rf "$T"' EXIT
BIN=$T/bin ST=$T/state
mkdir -p "$BIN" "$ST"
: > "$ST/running"; : > "$ST/log"; : > "$ST/curl-urls"
export ST

export KGC_ROOT=$T/opt/kgc KGC_APACHE_DIR=$T/etc/apache2 KGC_UNIT_DIR=$T/etc/systemd/system
export KGC_BACKUP_DIR=$T/root/backups
export KGC_PUBLIC_WEB=http://public-web/tickets KGC_PUBLIC_DASH=http://public-dash/login
export KGC_PUBLIC_ARCHIVE=http://public-archive/
export APACHE=$KGC_APACHE_DIR

# ── Stand-ins ───────────────────────────────────────────────────────────────
# Which port Apache sends an app to: the Define once setup has run, the fixed
# port in the vhost before that.
cat > "$BIN/_apache_port" <<'EOF'
#!/bin/bash
# app: web|organizer
name=KGC_WEB_PORT; fixed=3200
[ "$1" = organizer ] && { name=KGC_DASH_PORT; fixed=3100; }
f=$APACHE/conf-enabled/kgc-backends.conf
if [ -e "$f" ] && grep -q "\${$name}" "$APACHE"/sites-available/*.conf; then
  awk -v n="$name" '$1=="Define" && $2==n {print $3}' "$f"
else echo "$fixed"; fi
EOF

cat > "$BIN/_live" <<'EOF'
#!/bin/bash
# Reloaded Apache's view, which is what visitors get. Kept separately from the
# file on disk: writing the file changes nothing until the reload.
cat "$ST/apache-$1" 2>/dev/null || "$(dirname "$0")/_apache_port" "$1"
EOF

cat > "$BIN/systemctl" <<'EOF'
#!/bin/bash
B=$(dirname "$0")
echo "systemctl $*" >> "$ST/log"
port_of() { case $1 in kgc-staging|kgc-staging.service) echo 3200 ;;
  kgc-dashboard|kgc-dashboard.service) echo 3100 ;;
  kgc-web@*|kgc-dash@*) echo "${1#*@}" | sed 's/\.service$//' ;; esac; }
app_of() { case $1 in kgc-staging*|kgc-web@*) echo web ;; *) echo organizer ;; esac; }
verb=$1; shift
case $verb in
  start)
    p=$(port_of "$1")
    grep -qx "$p" "$ST/running" || echo "$p" >> "$ST/running"
    [ "${STUB_FAIL_PORT:-}" = "$p" ] && echo "$p" >> "$ST/broken"
    ;;
  stop)
    p=$(port_of "$1"); a=$(app_of "$1")
    if grep -qx "$p" "$ST/running" && [ "$("$B/_live" "$a")" = "$p" ]; then
      echo "VIOLATION: stopped $1 while Apache serves $a from :$p" >> "$ST/log"
    fi
    grep -qx "$p" "$ST/foreign" 2>/dev/null && exit 0   # not ours to stop
    grep -vx "$p" "$ST/running" > "$ST/r.tmp"; mv "$ST/r.tmp" "$ST/running"
    [ -f "$ST/broken" ] && { grep -vx "$p" "$ST/broken" > "$ST/b.tmp"; mv "$ST/b.tmp" "$ST/broken"; }
    ;;
  reload)
    [ "$1" = apache2 ] || exit 0
    for a in web organizer; do
      p=$("$B/_apache_port" "$a")
      if ! grep -qx "$p" "$ST/running" || grep -qx "$p" "$ST/broken" 2>/dev/null; then
        echo "VIOLATION: Apache reloaded onto :$p for $a with nothing answering" >> "$ST/log"
      fi
      echo "$p" > "$ST/apache-$a"
    done
    echo "apache now web=$(cat "$ST/apache-web") organizer=$(cat "$ST/apache-organizer")" >> "$ST/log"
    ;;
esac
exit 0
EOF

cat > "$BIN/apache2ctl" <<'EOF'
#!/bin/bash
[ "${STUB_APACHE_BAD:-}" = 1 ] && { echo "AH00526: Syntax error (stub)"; exit 1; }
echo "Syntax OK"
EOF

cat > "$BIN/curl" <<'EOF'
#!/bin/bash
B=$(dirname "$0")
url=; for a in "$@"; do case $a in http*) url=$a ;; esac; done
echo "$url" >> "$ST/curl-urls"
answers() { grep -qx "$1" "$ST/running" && ! grep -qx "$1" "$ST/broken" 2>/dev/null; }
code=000
case $url in
  http://127.0.0.1:*) p=${url#http://127.0.0.1:}; p=${p%%/*}; answers "$p" && code=200 ;;
  http://public-web/*)  [ "${STUB_PUBLIC_FAIL:-}" = web ] && code=502 || { answers "$("$B/_live" web)" && code=200 || code=503; } ;;
  http://public-dash/*) [ "${STUB_PUBLIC_FAIL:-}" = organizer ] && code=502 || { answers "$("$B/_live" organizer)" && code=200 || code=503; } ;;
  http://public-archive/*) code=200 ;;
esac
printf '%s' "$code"
[ "$code" = 000 ] && exit 7 || exit 0
EOF

cat > "$BIN/ss" <<'EOF'
#!/bin/bash
p=$(printf '%s' "$*" | sed -E 's/.*:([0-9]+).*/\1/')
case "$*" in
  *sport*) grep -qx "$p" "$ST/running" && echo "LISTEN 0 511 127.0.0.1:$p 0.0.0.0:*" ;;
  *dport*)  # connections to the old colour drain after STUB_DRAIN_POLLS checks
    n=$(cat "$ST/drain-$p" 2>/dev/null || echo 0); echo $((n + 1)) > "$ST/drain-$p"
    [ "$n" -lt "${STUB_DRAIN_POLLS:-2}" ] && echo "ESTAB 0 0 127.0.0.1:40000 127.0.0.1:$p" ;;
esac
exit 0
EOF

cat > "$BIN/flock" <<'EOF'
#!/bin/bash
[ "${STUB_LOCKED:-}" = 1 ] && exit 1 || exit 0
EOF

# /proc/stat does not exist on a Mac: report an idle CPU.
cat > "$BIN/awk" <<'EOF'
#!/bin/bash
for a in "$@"; do
  if [ "$a" = /proc/stat ]; then
    n=$(cat "$ST/cpu" 2>/dev/null || echo 0); echo $((n + 1)) > "$ST/cpu"
    echo "$((n * 90)) $((n * 100))"; exit 0
  fi
done
exec /usr/bin/awk "$@"
EOF

cat > "$BIN/sleep" <<'EOF'
#!/bin/bash
exit 0
EOF

cat > "$BIN/nice" <<'EOF'
#!/bin/bash
[ "$1" = -n ] && shift 2
exec "$@"
EOF

cat > "$BIN/npx" <<'EOF'
#!/bin/bash
[ "$*" = "next build" ] && { mkdir -p .next && date +%s > .next/BUILD_ID; echo "build $(pwd)" >> "$ST/log"; }
exit 0
EOF

cat > "$BIN/npm" <<'EOF'
#!/bin/bash
[ "$1" = ci ] && { mkdir -p node_modules; echo "npm ci $(pwd)" >> "$ST/log"; }
exit 0
EOF

# GNU options the script uses that BSD tools lack. Pass straight through on Linux.
if ! sed --version >/dev/null 2>&1; then
cat > "$BIN/sed" <<'EOF'
#!/bin/bash
args=(); for a in "$@"; do if [ "$a" = -i ]; then args+=(-i ''); else args+=("$a"); fi; done
exec /usr/bin/sed "${args[@]}"
EOF
cat > "$BIN/mv" <<'EOF'
#!/bin/bash
if [ "$1" = -T ]; then exec python3 -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$2" "$3"; fi
exec /bin/mv "$@"
EOF
cat > "$BIN/cp" <<'EOF'
#!/bin/bash
[ "$1" = -al ] && { shift; exec /bin/cp -R "$@"; }
exec /bin/cp "$@"
EOF
fi
chmod +x "$BIN"/*
export PATH=$BIN:$PATH

# ── The droplet before T272 ─────────────────────────────────────────────────
mkdir -p "$KGC_ROOT/shared" "$KGC_UNIT_DIR" "$APACHE"/{sites-available,sites-enabled,conf-available,conf-enabled} "$T/origin"
echo "A=1" > "$KGC_ROOT/shared/web.env"; echo "B=1" > "$KGC_ROOT/shared/organizer.env"
cat > "$APACHE/sites-available/www.conf" <<'EOF'
<VirtualHost *:443>
  ServerName www.knowledgegraph.tech
  ProxyPass / http://127.0.0.1:3200/
  ProxyPassReverse / http://127.0.0.1:3200/
</VirtualHost>
EOF
cat > "$APACHE/sites-available/dashboard.conf" <<'EOF'
<VirtualHost *:443>
  ServerName dashboard.knowledgegraph.tech
  ProxyPass / http://127.0.0.1:3100/
  ProxyPassReverse / http://127.0.0.1:3100/
</VirtualHost>
EOF
cat > "$APACHE/sites-available/archive.conf" <<'EOF'
<VirtualHost *:443>
  ServerName archive.knowledgegraph.tech
  DocumentRoot /var/www/archive
</VirtualHost>
EOF
printf '[Service]\nExecStart=/usr/bin/npx next start --port 3200\n' > "$KGC_UNIT_DIR/kgc-staging.service"
printf '[Service]\nExecStart=/usr/bin/npx next start --port 3100\n' > "$KGC_UNIT_DIR/kgc-dashboard.service"
mkdir -p "$KGC_UNIT_DIR/kgc-staging.service.d"; echo "[Service]" > "$KGC_UNIT_DIR/kgc-staging.service.d/override.conf"
sed "s#^ExecStart=.*#ExecStart=/bin/sh -c 'curl -fsS --max-time 600 -X POST -H \"Authorization: Bearer \$CRON_SECRET\" http://127.0.0.1:3100/api/cron/cfp'#" \
  "$HERE/../kgc-cfp-cron.service" > "$KGC_UNIT_DIR/kgc-cfp-cron.service"
printf '3200\n3100\n' > "$ST/running"

g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@" >/dev/null 2>&1; }
( cd "$T/origin" && g init && mkdir -p apps/web apps/organizer \
  && for d in . apps/web apps/organizer; do echo '{"v":1}' > $d/package-lock.json; done \
  && echo 1 > VERSION && g add -A && g commit -m one )
g clone "$T/origin" "$KGC_ROOT/app"
for d in . apps/web apps/organizer; do mkdir -p "$KGC_ROOT/app/$d/node_modules"; done

# ── Checks ──────────────────────────────────────────────────────────────────
PASS=0 FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $*"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $*"; }
check() { local d=$1; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }
live() { "$BIN/_live" "$1"; }
running() { sort -n "$ST/running" | tr '\n' ' ' | sed 's/ $//'; }
no_violation() {
  if grep -q VIOLATION "$ST/log"; then bad "no zero-downtime violation"; grep VIOLATION "$ST/log" | sed 's/^/       /'
  else ok "no zero-downtime violation"; fi
}
run() { # name expected-exit args...
  local name=$1 want=$2; shift 2
  echo "── $name"
  echo "### $name" >> "$ST/log"
  bash "$SCRIPT" "$@" > "$T/out" 2>&1; local got=$?
  if [ "$got" = "$want" ]; then ok "exit $got"; else bad "exit $got, wanted $want"; sed 's/^/       /' "$T/out"; fi
}
push_commit() { ( cd "$T/origin" && echo "$1" > VERSION && g commit -am "$1" ); }
sha() { git -C "$T/origin" rev-parse --short=10 HEAD; }
rel_of() { basename "$(readlink -f "$KGC_ROOT/live/$1")"; }

run "a deploy before setup is refused" 1 staging
check "says to run setup" grep -q "run '/opt/kgc/deploy.sh setup' once first" "$T/out"
check "Apache untouched" test ! -e "$APACHE/conf-enabled/kgc-backends.conf"

run "setup" 0 setup
check "backup taken" test -s "$(ls -d "$KGC_BACKUP_DIR"/t272-zero-downtime-*/etc-apache2.tgz | head -1)"
check "old units backed up" test -f "$(ls -d "$KGC_BACKUP_DIR"/t272-zero-downtime-* | head -1)/kgc-staging.service"
check "www vhost uses \${KGC_WEB_PORT}" grep -q 'http://127.0.0.1:${KGC_WEB_PORT}/' "$APACHE/sites-available/www.conf"
check "dashboard vhost uses \${KGC_DASH_PORT}" grep -q 'http://127.0.0.1:${KGC_DASH_PORT}/' "$APACHE/sites-available/dashboard.conf"
check "no fixed port left in vhosts" bash -c "! grep -qE '127.0.0.1:3[12]00' '$APACHE'/sites-available/*.conf"
check "archive vhost untouched" grep -q 'DocumentRoot /var/www/archive' "$APACHE/sites-available/archive.conf"
check "Defines are the ports live now" grep -qx 'Define KGC_WEB_PORT 3200' "$APACHE/conf-available/kgc-backends.conf"
check "conf enabled" test -L "$APACHE/conf-enabled/kgc-backends.conf"
check "graceful reload, not restart" bash -c "grep -q 'systemctl reload apache2' '$ST/log' && ! grep -q 'restart apache2' '$ST/log'"
check "cron reads the port file" grep -q '127.0.0.1:$$(cat /opt/kgc/live/organizer.port' "$KGC_UNIT_DIR/kgc-cfp-cron.service"
check "cron keeps --max-time 600" grep -q -- '--max-time 600' "$KGC_UNIT_DIR/kgc-cfp-cron.service"
check "template units written" test -f "$KGC_UNIT_DIR/kgc-web@.service" -a -f "$KGC_UNIT_DIR/kgc-dash@.service"
check "old processes still serving (3100 3200)" test "$(running)" = "3100 3200"
check "visitors still on 3200 / 3100" test "$(live web)/$(live organizer)" = "3200/3100"
no_violation

cp "$APACHE/sites-available/www.conf" "$T/www.before"; cp "$KGC_UNIT_DIR/kgc-cfp-cron.service" "$T/cron.before"
run "setup again changes nothing" 0 setup
check "vhost unchanged" cmp -s "$T/www.before" "$APACHE/sites-available/www.conf"
check "cron unchanged" cmp -s "$T/cron.before" "$KGC_UNIT_DIR/kgc-cfp-cron.service"

push_commit two; S2=$(sha)
run "deploy both (first swap)" 0 both
check "web on 3201" test "$(live web)" = 3201
check "dashboard on 3101" test "$(live organizer)" = 3101
check "only the new colours run" test "$(running)" = "3101 3201"
check "port files" test "$(cat "$KGC_ROOT/live/web.port")/$(cat "$KGC_ROOT/live/organizer.port")" = "3201/3101"
check "live release is $S2" test "$(rel_of web)/$(rel_of organizer)" = "$S2/$S2"
check "both apps built" test -f "$KGC_ROOT/releases/$S2/apps/web/.next/BUILD_ID" -a -f "$KGC_ROOT/releases/$S2/apps/organizer/.next/BUILD_ID"
check "node_modules linked, not reinstalled" bash -c "! grep -q 'npm ci' '$ST/log'"
check "old units retired" test -f "$KGC_ROOT/shared/retired-units/kgc-staging.service" -a ! -e "$KGC_UNIT_DIR/kgc-staging.service"
check "old drop-in retired too" test -f "$KGC_ROOT/shared/retired-units/kgc-staging.service.d/override.conf"
check "new colours enabled for boot" bash -c "grep -q 'enable --quiet kgc-web@3201' '$ST/log' && grep -q 'enable --quiet kgc-dash@3101' '$ST/log'"
check "both built before either swap" bash -c "awk '/### deploy both/{f=1} f' '$ST/log' | grep -nE '^build|start kgc-' | head -2 | grep -c build | grep -qx 2"
check "dashboard swapped before web" bash -c "awk '/### deploy both/{f=1} f' '$ST/log' | grep -E 'start kgc-' | head -1 | grep -q kgc-dash@"
check "old colour stopped only after drain" bash -c "test \$(cat '$ST/drain-3200') -gt 2"
check "image cache linked into the web release" test -L "$KGC_ROOT/releases/$S2/apps/web/.next/cache/images"
check "env linked into the release" test -L "$KGC_ROOT/releases/$S2/apps/web/.env.production"
no_violation

run "status" 0 status
check "status names port and release" grep -q "web        live: $S2 on port 3201" "$T/out"

run "rollback staging" 0 rollback staging
check "web back on 3200" test "$(live web)" = 3200
check "web runs the old checkout again" test "$(readlink -f "$KGC_ROOT/live/web")" = "$(readlink -f "$KGC_ROOT/app")"
check "dashboard untouched on 3101" test "$(live organizer)" = 3101
check "running 3101 3200" test "$(running)" = "3101 3200"
no_violation

run "restart dashboard" 0 restart dashboard
check "dashboard moved to 3100, same release" test "$(live organizer)/$(rel_of organizer)" = "3100/$S2"
check "rollback target kept" test "$(readlink -f "$KGC_ROOT/live/organizer.previous")" = "$(readlink -f "$KGC_ROOT/app")"
no_violation

push_commit three; S3=$(sha)
cp "$APACHE/conf-available/kgc-backends.conf" "$T/backends.before"
STUB_FAIL_PORT=3201 run "a release that never answers" 1 staging
check "says the live site was not touched" grep -q "did not answer on port 3201. The live site was not touched" "$T/out"
check "Apache file unchanged" cmp -s "$T/backends.before" "$APACHE/conf-available/kgc-backends.conf"
check "web still on 3200, old release" test "$(live web)/$(cat "$KGC_ROOT/live/web.port")" = "3200/3200"
check "broken colour stopped" test "$(running)" = "3100 3200"
no_violation

STUB_PUBLIC_FAIL=web run "public check fails after the switch" 1 staging
check "Apache back on 3200" test "$(live web)" = 3200
check "port file back to 3200" test "$(cat "$KGC_ROOT/live/web.port")" = 3200
check "new colour stopped" test "$(running)" = "3100 3200"
check "live link not moved to $S3" test "$(readlink -f "$KGC_ROOT/live/web")" = "$(readlink -f "$KGC_ROOT/app")"
no_violation

STUB_APACHE_BAD=1 run "Apache refuses the new config" 1 staging
check "backends file restored" cmp -s "$T/backends.before" "$APACHE/conf-available/kgc-backends.conf"
check "web still on 3200" test "$(live web)" = 3200
check "new colour stopped" test "$(running)" = "3100 3200"
no_violation

echo 3201 >> "$ST/running"; echo 3201 > "$ST/foreign"
run "idle port held by something else" 1 staging
check "refuses, live untouched" grep -q "port 3201 is busy with something deploy.sh did not start" "$T/out"
check "web still on 3200" test "$(live web)" = 3200
rm -f "$ST/foreign"; grep -vx 3201 "$ST/running" > "$ST/r"; mv "$ST/r" "$ST/running"

STUB_LOCKED=1 run "a second deploy while one runs" 1 staging
check "says another deploy is running" grep -q "Another deploy is running" "$T/out"

run "deploy staging again" 0 staging
check "web on 3201 with $S3" test "$(live web)/$(rel_of web)" = "3201/$S3"
check "previous is the checkout it replaced" test "$(readlink -f "$KGC_ROOT/live/web.previous")" = "$(readlink -f "$KGC_ROOT/app")"
no_violation

echo "── CFP cron command"
cmd=$(sed -n "s/^ExecStart=\/bin\/sh -c '\(.*\)'$/\1/p" "$HERE/../kgc-cfp-cron.service" | sed 's/\$\$/$/g' | sed "s#/opt/kgc/live/organizer.port#$KGC_ROOT/live/organizer.port#")
: > "$ST/curl-urls"
CRON_SECRET=x sh -c "$cmd" >/dev/null
check "repo unit calls the live dashboard colour (3100)" grep -qx "http://127.0.0.1:3100/api/cron/cfp" "$ST/curl-urls"
mv "$KGC_ROOT/live/organizer.port" "$T/p"; : > "$ST/curl-urls"
CRON_SECRET=x sh -c "$cmd" >/dev/null
check "no port file: falls back to 3100" grep -qx "http://127.0.0.1:3100/api/cron/cfp" "$ST/curl-urls"
mv "$T/p" "$KGC_ROOT/live/organizer.port"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
