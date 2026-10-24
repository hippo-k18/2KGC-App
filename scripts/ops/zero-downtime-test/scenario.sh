#!/bin/bash
# Runs inside the test container after fixture.sh. Every step runs under the
# 100 ms poller (poll.mjs) against Apache, as the trial on the droplet would.
set -uo pipefail
export KGC_PUBLIC_WEB=http://127.0.0.1/tickets KGC_PUBLIC_DASH=http://127.0.0.1:8081/login KGC_PUBLIC_ARCHIVE=http://127.0.0.1/
URLS="http://127.0.0.1/tickets http://127.0.0.1:8081/login http://127.0.0.1/slow"
commit() { (cd /srv/work/repo && echo "$1" > apps/web/CHANGE && git add -A && git commit -qm "$1" && git push -q /srv/origin.git main); }
step() { # title command...
  local title=$1; shift
  echo; echo "################ $title"
  node /test/poll.mjs $URLS > /tmp/poll.out 2>&1 & local p=$!
  sleep 2
  "$@" > /tmp/step.out 2>&1; local rc=$?
  sleep 4
  kill -TERM $p; wait $p 2>/dev/null
  grep -E '^(==>|!!)' /tmp/step.out | sed 's/^/  | /'
  echo "  exit $rc"
  sed 's/^/  /' /tmp/poll.out
  echo "  listening: $(ss -Hltn | grep -oE '127.0.0.1:3[12]0[0-9]' | sort | tr '\n' ' ')"
}
show() { echo "  units: $(systemctl list-units --no-legend --plain 'kgc-*' | awk '{print $1"="$4}' | tr '\n' ' ')"
         echo "  enabled: $(systemctl list-unit-files --no-legend 'kgc-*' | awk '$2=="enabled"{print $1}' | tr '\n' ' ') $(ls /etc/systemd/system/multi-user.target.wants | grep kgc | tr '\n' ' ')"; }

commit R2
step "A. OLD script deploys both (baseline)" /opt/kgc/deploy.sh both

cp /test/new-deploy.sh /opt/kgc/deploy.sh && chmod +x /opt/kgc/deploy.sh
step "B. new script: setup" /opt/kgc/deploy.sh setup
echo "  backends: $(grep Define /etc/apache2/conf-available/kgc-backends.conf | tr '\n' ' ')"
echo "  vhost lines: $(grep -h 'ProxyPass ' /etc/apache2/sites-available/*.conf | sed 's/  */ /g' | sort -u | tr '\n' ';')"
echo "  cron: $(grep ExecStart /etc/systemd/system/kgc-cfp-cron.service)"
show

commit R3
step "C. new script deploys both (first swap, retires old units)" /opt/kgc/deploy.sh both
show; /opt/kgc/deploy.sh status | sed 's/^/  /'

step "D. rollback staging" /opt/kgc/deploy.sh rollback staging
step "E. restart dashboard (settings reread)" /opt/kgc/deploy.sh restart dashboard
show; /opt/kgc/deploy.sh status | sed 's/^/  /'

echo; echo "################ F. CFP cron reaches the live dashboard colour ($(cat /opt/kgc/live/organizer.port))"
systemctl start kgc-cfp-cron; echo "  cron result: $(systemctl show kgc-cfp-cron -p Result --value); $(journalctl -u kgc-cfp-cron -n 3 --no-pager -o cat | grep -E 'cron ' | tail -1)"

echo 'KGC_FAIL=1' >> /opt/kgc/shared/web.env
step "G. a release that cannot start (restart staging with KGC_FAIL=1)" /opt/kgc/deploy.sh restart staging
sed -i '/KGC_FAIL/d' /opt/kgc/shared/web.env
show

commit R4
step "H. deploy both again (colours flip back)" /opt/kgc/deploy.sh both
show; /opt/kgc/deploy.sh status | sed 's/^/  /'

echo; echo "################ I. survives a restart of everything (boot order)"
systemctl stop 'kgc-web@*' 'kgc-dash@*'; systemctl start multi-user.target; sleep 1
for u in $(ls /etc/systemd/system/multi-user.target.wants | grep kgc); do systemctl start "$u"; done
for i in $(seq 1 60); do curl -sf -o /dev/null 127.0.0.1/tickets && curl -sf -o /dev/null 127.0.0.1:8081/login && break; sleep 0.5; done
echo "  after start of enabled units: web $(curl -s 127.0.0.1/tickets) / dash $(curl -s 127.0.0.1:8081/login)"
echo SCENARIO-DONE
