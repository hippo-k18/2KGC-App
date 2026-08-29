# Deploying the two sites to Netlify

## ⚠️ Move `.env.local` aside before a manual deploy

Both sites are **manual-deploy only** — no repo connected, no build hook — so a
deploy means building locally and uploading:

```bash
cd apps/organizer
mv .env.local .env.local.hidden     # ← the step that is easy to skip
rm -rf .next && npm run build
npx netlify deploy --dir=.next      # a draft first; test it
npx netlify deploy --prod --dir=.next
mv .env.local.hidden .env.local
```

**Skipping the move produces a build that 502s on every authenticated page.**
Next.js reads `.env.local` during `next build`, and the local file sets
`FIRESTORE_EMULATOR_HOST=localhost:8080`. The deployed function then tries to
reach an emulator that is not there, the Admin SDK retries, and Netlify kills
the request at 30 seconds. Nothing in the build output says anything is wrong —
it compiles cleanly and deploys successfully.

This happened on 2026-08-27 and took production down until the previous deploy
was restored. The tell is a 502 after exactly 30s on `/content/basics` while
`/login` still returns 200, because the login page reads no data.

**Test a draft before promoting.** `netlify deploy` without `--prod` gives a
URL that runs the real function with the real environment; if the draft is
healthy, promote that exact artefact from the Netlify UI or with
`netlify api restoreSiteDeploy` rather than building a second time.

---

Two Next.js apps, deployed as two separate Netlify sites from this one
repository:

| Site | Directory | What it is | Public? |
|---|---|---|---|
| Website | `apps/web` | Programme, speakers, ticket purchase via Stripe | Yes |
| Dashboard | `apps/organizer` | Organizer EMS. Admin SDK, bypasses all security rules | **No — see below** |

Both are configured: each has a `netlify.toml` and `@netlify/plugin-nextjs`,
which is what turns server components, server actions and the Stripe webhook
into Netlify Functions. Without that plugin you get a static export and every
server action returns 404.

`base` is set to the app directory, but **Netlify must check out the whole
repository**, because both `package.json` files depend on `@kgc/shared` and
`@kgc/scripts` through `file:../../…`. Pointing a site at only the subfolder
breaks `npm install`.

---

## What has to exist before either site can work

None of this is code, and none of it is on this laptop.

### 1. A Firebase service account

Both apps talk to Firestore with the Admin SDK, which needs a private key.
Firebase console → Project settings → Service accounts → *Generate new private
key*. That gives you a JSON file.

Netlify has no filesystem to point `GOOGLE_APPLICATION_CREDENTIALS` at, so the
JSON goes in `FIREBASE_SERVICE_ACCOUNT` instead, which both apps already read.
**Treat that file as a root credential for the whole project.** Both sites hold
a copy today.

### 2. The live Firestore project — prepared, 2026-08-27

`kgc-conference-app-and-website` is ready:

- The `(default)` database exists — Native, Standard, `nam5`. It did not before;
  `AGENTS.md` claimed otherwise for months.
- **Rules and all 16 indexes are deployed.** Not with `npm run deploy:rules` —
  that shells out to the `firebase` CLI, which cannot get past its own
  serviceusage precheck with the roles on this project. Use
  `node scripts/ops/deploy-rules.mjs` and `node scripts/ops/deploy-indexes.mjs`,
  which call the same APIs directly.
- **It holds the seeded demo event** — 483 documents, plus whatever orders the
  demo has since written. Replace with `npm run import:whova` when the real
  agenda arrives.

### 3. Stripe keys, for the website only — not used by the demo

`DEMO_MODE=1` approves the payment without Stripe. This section applies the day
a real account is added.

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The webhook secret comes from
the Stripe dashboard once you register the endpoint at
`https://<site>/api/stripe/webhook` — so it is created *after* the first
deploy, and the site needs redeploying with it.

---

## Environment variables

### `apps/web`

| Variable | Notes |
|---|---|
| `GCLOUD_PROJECT` | `kgc-conference-app-and-website` |
| `FIREBASE_SERVICE_ACCOUNT` | The whole service-account JSON, as one line |
| `STRIPE_SECRET_KEY` | Live or test key |
| `STRIPE_WEBHOOK_SECRET` | From Stripe, after registering the endpoint |
| `WEB_ORDER_SECRET` | `openssl rand -hex 32`. Signs the order-confirmation capability token |
| `WEB_PUBLIC_ORIGIN` | The deployed origin, e.g. `https://kgc-2027-website.netlify.app` |
| `DEMO_MODE` | `1` approves the payment on the button, shows the card box and prints the buyer details. Never set alongside a real `STRIPE_SECRET_KEY` |

Do **not** set `FIRESTORE_EMULATOR_HOST`.

### `apps/organizer`

| Variable | Notes |
|---|---|
| `GCLOUD_PROJECT` | `kgc-conference-app-and-website` |
| `FIREBASE_SERVICE_ACCOUNT` | The whole service-account JSON, as one line |
| `CONSOLE_ALLOWLIST` | Comma-separated organizer identities. Emails, or a bare username like `demo` |
| `CONSOLE_PASSPHRASE` | **Required in production.** `openssl rand -base64 24` |
| `CONSOLE_SESSION_SECRET` | A fresh `openssl rand -hex 32` — never the dev value |
| `DEMO_MODE` | `1` prints the sign-in credentials on the login screen. Remove it the moment the data behind the dashboard is real |

A short passphrase such as `123` is allowed **only** when the dashboard is
pointed at a Firestore emulator. Against the live project, anything under
twelve characters refuses to sign anyone in — the rule is not "the secret must
be strong", it is "a weak secret may only guard invented data".

---

## ⚠️ Before the dashboard goes on the public internet

The dashboard's sign-in is an email allowlist plus one shared passphrase. There
is no SSO, no MFA, and no per-person revocation — and the Admin SDK behind it
ignores `firestore.rules` entirely. Anyone who gets past that form can read the
whole ticket list and write anything.

Three things make that acceptable as an interim, and all three are cheap:

1. **Set `CONSOLE_PASSPHRASE` to something long and random.** The app refuses
   every sign-in in production when it is missing, on purpose — a missing
   secret fails closed rather than opening the door.
2. **Turn on Netlify's site password protection** as well, so the dashboard is
   not reachable at all without a second secret. Site settings → Access
   control → Password protection.
3. **Deploy `firestore.rules` first.** They do not constrain the Admin SDK, but
   they are what protects the project from everything that is not this
   dashboard, and they are currently not in force at all.

There is no SSO step coming to replace this — email and passphrase is the chosen
design (see `apps/organizer/src/lib/auth.ts`). That makes the three items above
the whole of the boundary, so treat the dashboard URL as a secret, keep
`CONSOLE_ALLOWLIST` short, and rotate `CONSOLE_PASSPHRASE` after the event.

---

## Deploying

Netlify's CLI needs an interactive login, so this part is yours:

```bash
npm i -g netlify-cli
netlify login

# Website
cd apps/web
netlify init          # create a new site, or link an existing one
netlify env:set GCLOUD_PROJECT kgc-conference-app-and-website
netlify env:set FIREBASE_SERVICE_ACCOUNT "$(cat /path/to/serviceAccount.json | tr -d '\n')"
netlify env:set WEB_ORDER_SECRET "$(openssl rand -hex 32)"
# …STRIPE_SECRET_KEY, WEB_PUBLIC_ORIGIN, then STRIPE_WEBHOOK_SECRET after the first deploy
netlify deploy --build --prod

# Dashboard
cd ../organizer
netlify init
netlify env:set GCLOUD_PROJECT kgc-conference-app-and-website
netlify env:set FIREBASE_SERVICE_ACCOUNT "$(cat /path/to/serviceAccount.json | tr -d '\n')"
netlify env:set CONSOLE_ALLOWLIST "you@example.com"
netlify env:set CONSOLE_PASSPHRASE "$(openssl rand -base64 24)"
netlify env:set CONSOLE_SESSION_SECRET "$(openssl rand -hex 32)"
netlify deploy --build --prod
```

In the Netlify UI, set each site's **base directory** to `apps/web` /
`apps/organizer` and leave the repository at the monorepo root.

---

## Credentials from an environment variable — done

Both apps' `src/lib/firestore.ts` now accept **either** form: a path in
`GOOGLE_APPLICATION_CREDENTIALS`, which is the convention on a laptop, or the
service-account JSON itself in `FIREBASE_SERVICE_ACCOUNT`, which is the only
form a serverless host can carry. The path wins when both are set. This was
listed here as an unmade change for some time; it has been made, and both sites
are deployed and reading the live project through it.

## Status, 2026-08-27

- Both apps now run against the **live** Firestore project, and a purchase has
  been driven end to end through the website: order `paid`, `quantitySold`
  incremented, claim code issued. See `DEMO.md`.
- All 16 composite indexes are deployed, which is what makes that true — the
  emulator does not enforce them, so this was the outstanding risk.
- **The Stripe webhook has still never received a live event**, and will not:
  the demo runs with `DEMO_MODE=1` and no Stripe account. That path is
  unexercised and should be treated as untested when a real account is added.
- Builds are still run locally and uploaded. Neither site is built by Netlify
  from the repository, so the `file:../../` workspace dependencies remain
  unproven there.
