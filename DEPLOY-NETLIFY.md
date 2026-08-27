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
JSON goes in an environment variable instead and `src/lib/firestore.ts` needs
one small change to read it — see "Known gap" at the bottom. **Treat that file
as a root credential for the whole project.**

### 2. The live Firestore project must be prepared

`kgc-conference-app-and-website` exists, but:

- **Rules and indexes have never been deployed.** `firestore.rules` is the
  entire security boundary and it is not in force. Run
  `npm run deploy:rules` before anything real touches the project.
- **It has no data.** Everything verified so far ran against the emulator. A
  deployed dashboard would open onto an empty event until the agenda is
  imported (`npm run import:whova`).

### 3. Stripe keys, for the website only

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
| `WEB_PUBLIC_ORIGIN` | The deployed origin, e.g. `https://kgc-2027.netlify.app` |

Do **not** set `FIRESTORE_EMULATOR_HOST`.

### `apps/organizer`

| Variable | Notes |
|---|---|
| `GCLOUD_PROJECT` | `kgc-conference-app-and-website` |
| `FIREBASE_SERVICE_ACCOUNT` | The whole service-account JSON, as one line |
| `CONSOLE_ALLOWLIST` | Comma-separated organizer identities. Emails, or a bare username like `demo` |
| `CONSOLE_PASSPHRASE` | **Required in production.** `openssl rand -base64 24` |
| `CONSOLE_SESSION_SECRET` | A fresh `openssl rand -hex 32` — never the dev value |

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

The real fix is DECISIONS.md #5 — Google SSO with enforced MFA against the
organizer allowlist. Until that lands, treat the dashboard URL as a secret.

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

## Known gap: credentials from an environment variable

`src/lib/firestore.ts` in both apps currently reads
`GOOGLE_APPLICATION_CREDENTIALS`, a *path*. Netlify has no such file. Both need
to accept `FIREBASE_SERVICE_ACCOUNT` — the JSON itself — and call
`cert(JSON.parse(...))`.

It is a few lines in one function per app, but it is a change to the module
that decides what credential the server runs as, and it has not been made or
tested against the live project yet. Do it deliberately, not as part of a
deploy.

## What has never been tested

- Neither app has ever been built by Netlify. The `file:../../` workspace
  dependencies are the most likely thing to break there.
- Neither app has ever run against the live Firestore project. Everything
  verified so far used the emulator, which **does not enforce composite
  indexes** — so a query that works locally can fail in production with
  `failed-precondition`. `AGENTS.md` records that shipping twice.
- The Stripe webhook has never received a live event.
