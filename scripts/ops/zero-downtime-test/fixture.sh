#!/bin/bash
# Runs inside the test container. Builds the droplet's layout as it is before
# T272: a git origin, /opt/kgc/app, the old fixed-port units, Apache vhosts
# proxying to 127.0.0.1:3200 and :3100, the CFP cron, and a first release put
# live by the OLD deploy script (old-deploy.sh, a copy of the live one).
set -euo pipefail
ln -sf /usr/local/bin/npx /usr/bin/npx; ln -sf /usr/local/bin/node /usr/bin/node
mkdir -p /srv/work && cd /srv/work
rm -rf repo && mkdir repo && cd repo && git init -q && git checkout -q -b main
git config --global user.email t@t && git config --global user.name t
printf '{"name":"kgc","private":true,"dependencies":{"server-only":"0.0.1"}}\n' > package.json
mkdir -p apps/web/app/tickets apps/web/app/slow apps/organizer/app/login apps/organizer/app/api/cron/cfp
for a in web organizer; do
  cat > apps/$a/package.json <<J
{"name":"$a","private":true,"dependencies":{"next":"15.5.27","react":"19.2.0","react-dom":"19.2.0"}}
J
  cat > apps/$a/next.config.mjs <<'J'
// KGC_FAIL=1 in the env file makes the process die at start, to test a bad release.
if (process.env.KGC_FAIL === '1') throw new Error('KGC_FAIL is set');
export default {};
J
done
REV='import { readFileSync } from "node:fs";
export const dynamic = "force-dynamic";
const rev = () => readFileSync(process.cwd() + "/../../REVISION", "utf8").trim() + " pid " + process.pid;'
printf '%s\nexport function GET() { return new Response("web " + rev()); }\n' "$REV" > apps/web/app/tickets/route.js
printf '%s\nexport function GET() { return new Response("home " + rev()); }\n' "$REV" > apps/web/app/route.js
printf '%s\nexport async function GET() { await new Promise((r) => setTimeout(r, 2000)); return new Response("slow " + rev()); }\n' "$REV" > apps/web/app/slow/route.js
printf '%s\nexport function GET() { return new Response("dash " + rev()); }\n' "$REV" > apps/organizer/app/login/route.js
printf '%s\nexport function POST(req) { return new Response("cron " + rev(), { status: req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET ? 200 : 401 }); }\n' "$REV" > apps/organizer/app/api/cron/cfp/route.js
npm install --silent --no-audit --no-fund >/dev/null
(cd apps/web && npm install --silent --no-audit --no-fund >/dev/null)
(cd apps/organizer && npm install --silent --no-audit --no-fund >/dev/null)
printf 'node_modules\n.next\n' > .gitignore
git add -A && git commit -qm R1
rm -rf /srv/origin.git && git clone -q --bare . /srv/origin.git
rm -rf /opt/kgc && mkdir -p /opt/kgc/shared && git clone -q /srv/origin.git /opt/kgc/app
cp -al node_modules /opt/kgc/app/node_modules 2>/dev/null || true
for a in web organizer; do cp -al apps/$a/node_modules /opt/kgc/app/apps/$a/node_modules; done
printf 'PORT=3200\n' > /opt/kgc/shared/web.env
printf 'PORT=3100\nCRON_SECRET=test-cron-secret-0123456789abcdef\n' > /opt/kgc/shared/organizer.env
printf 'CRON_SECRET=test-cron-secret-0123456789abcdef\n' > /etc/kgc-cfp-cron.env

# Apache, in the same shapes as the droplet's vhosts.
cat > /etc/apache2/sites-available/000-default-le-ssl.conf <<'A'
<VirtualHost *:80>
        ServerName www.test
        ProxyPreserveHost On
        ProxyPass /wp-content/uploads/ !
        ProxyPass        / http://127.0.0.1:3200/ ttl=4
        ProxyPassReverse / http://127.0.0.1:3200/
</VirtualHost>
A
cat > /etc/apache2/sites-available/kgc-blog.conf <<'A'
<VirtualHost *:80>
    ServerName blog.test
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3200/ ttl=4
    ProxyPassReverse / http://127.0.0.1:3200/
</VirtualHost>
A
cat > /etc/apache2/sites-available/kgc-staging.conf <<'A'
<VirtualHost *:80>
    ServerName staging.test
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3200/
    ProxyPassReverse / http://127.0.0.1:3200/
</VirtualHost>
A
cat > /etc/apache2/sites-available/kgc-dashboard-le-ssl.conf <<'A'
Listen 8081
<VirtualHost *:8081>
    ServerName dash.test
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3100/ ttl=4
    ProxyPassReverse / http://127.0.0.1:3100/
</VirtualHost>
A
rm -f /etc/apache2/sites-enabled/*
for s in 000-default-le-ssl kgc-blog kgc-staging kgc-dashboard-le-ssl; do ln -sf ../sites-available/$s.conf /etc/apache2/sites-enabled/$s.conf; done
printf 'Timeout 120\nProxyTimeout 300\n' > /etc/apache2/conf-available/kgc-performance.conf && a2enconf -q kgc-performance
apache2ctl -t && systemctl restart apache2

# The CFP cron as installed on the droplet before T272.
cat > /etc/systemd/system/kgc-cfp-cron.service <<'U'
[Unit]
Description=KGC call for papers scheduled emails
After=network-online.target kgc-dashboard.service

[Service]
Type=oneshot
EnvironmentFile=/etc/kgc-cfp-cron.env
ExecStart=/bin/sh -c 'curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3100/api/cron/cfp'
U
systemctl daemon-reload

# Placeholders for the units the old script backs up on its first run.
for u in kgc-staging kgc-dashboard; do
  printf '[Unit]\nDescription=placeholder\n[Service]\nExecStart=/bin/true\n' > /etc/systemd/system/$u.service
done
systemctl daemon-reload

# First release, by the OLD script, pointed at this container's URLs.
sed -e 's#https://www.knowledgegraph.tech/tickets#http://127.0.0.1/tickets#; s#https://staging.knowledgegraph.tech/tickets#http://127.0.0.1/tickets#; s#https://dashboard.knowledgegraph.tech/login#http://127.0.0.1:8081/login#; s#https://www.knowledgegraph.tech/#http://127.0.0.1/#' \
  /test/old-deploy.sh > /opt/kgc/deploy.sh && chmod +x /opt/kgc/deploy.sh
/opt/kgc/deploy.sh both
# The droplet's OOM drop-in on the old website unit.
mkdir -p /etc/systemd/system/kgc-staging.service.d
printf '[Service]\nOOMScoreAdjust=-500\n' > /etc/systemd/system/kgc-staging.service.d/oom-priority.conf
systemctl daemon-reload
echo FIXTURE-READY
