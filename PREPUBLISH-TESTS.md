# Pre-publish tests for the website

Every change to `apps/web` goes to staging at
<https://staging.knowledgegraph.tech> and through this gate: 420 browser
checks (241 on a desktop viewport, 179 on a phone). Staging is the
`kgc-staging` service on the DigitalOcean droplet. Netlify is no longer used.

```bash
npm run publish:web                        # check, deploy staging, test staging
bash scripts/publish-web.sh --test         # test staging as it is, no deploy
bash scripts/publish-web.sh --fast         # skip unit tests, keep the browser gate
PREPUBLISH_SALES=open npm run publish:web  # once Stripe is live (see below)
```

To run the checks on their own against any origin:

```bash
cd tests/prepublish
npm install && npx playwright install chromium    # once
npx playwright test                               # staging is the default
PREPUBLISH_URL=http://localhost:3200 npx playwright test
npx playwright test --grep @tickets               # ticketing only
npx playwright test --grep @security              # penetration checks only
npm run report                                    # open the HTML report
```

## What the publish script does, in order

| Step | What happens | Stops when |
|---|---|---|
| 0. Preflight | Droplet reachable over SSH, your HEAD is pushed and is what the droplet's branch will build | Either is not true |
| 1. Static | No Stripe, webhook or private key in any tracked file, no secret named `NEXT_PUBLIC_*`, then `apps/web` typecheck and the root unit tests (1,177 as of 2026-09-24) | A committed key, a public-prefixed secret, a type error or a failing unit test |
| 2. Deploy | `/opt/kgc/deploy.sh staging` on the droplet (below), then the leak scan, then confirms staging runs your commit | The build or its port check fails (the live site is left alone), or the leak scan finds a secret (it is already live: roll back and rotate) |
| 3. Gate | Waits for `/tickets` to answer, runs `tests/prepublish` against staging | Any check fails |

`deploy.sh` builds from GitHub, so uncommitted or unpushed work is never
deployed. If SSH is refused, run `/opt/kgc/deploy.sh staging` from the
DigitalOcean console and then `publish-web.sh --test`.

### How `deploy.sh` keeps downtime to about a second

Its source is `scripts/ops/droplet-deploy.sh`; copy it to `/opt/kgc/deploy.sh`
after editing.

1. The commit is exported to its own folder, `/opt/kgc/releases/<commit>`.
   The live site keeps running from its own folder the whole time.
2. Packages: if an app's `package-lock.json` is unchanged, its `node_modules`
   is hard-linked from the live release in seconds. If it changed, `npm ci`
   runs in the new folder only.
3. `next build` in the new folder, at low priority.
4. The new build is started on a spare port (3201 for the site, 3101 for the
   dashboard) and must answer before anything else happens.
5. `/opt/kgc/live/web` is switched to the new folder in one step and the
   service restarted. That restart is the downtime.
6. If the public URL does not come back within 45 seconds, it switches back
   to the previous release on its own.

```bash
/opt/kgc/deploy.sh staging            # or dashboard, or both
/opt/kgc/deploy.sh rollback staging   # previous release, about a second
/opt/kgc/deploy.sh status             # what is live and what is kept
```

Settings live in `/opt/kgc/shared/web.env` and `organizer.env`. Do not stop
the service before deploying: nothing needs it stopped, and a stopped service
is down for the whole build. Only one deploy can run at a time.

⚠️ A failed gate leaves the failing build running. Roll it back with
`deploy.sh rollback staging`.

## Sales state: `PREPUBLISH_SALES`

The site has two legitimate states and the gate insists on the one you name.

- **`closed`** (default today): no `STRIPE_SECRET_KEY`. The pay button must be
  disabled, the "Ticket sales are not open yet"
  notice must show with an Email us link, the invoice page must show its
  closed notice, and the Stripe webhook must answer 503.
- **`open`**: the pay button must be enabled, no
  closed notice, the webhook must answer 400 to an unsigned post, and the
  server-side checks below run.

A mismatch fails the run. That is deliberate: a Stripe key that went missing
from a deploy and one that was newly added are both things to know before the
site goes out. **When Stripe goes live, change the default in
`scripts/publish-web.sh` to `open`.**

## What is checked

Tags in brackets are what `--grep` selects on.

### Ticketing: can somebody buy a ticket? [`@tickets`]

**The tickets page (`/tickets`)**

- The page opens on the tickets with no hero: the first price is visible
  without scrolling, and the dates and venue line sits under the heading.
- At least one tier is on sale. Every tier has a name, a positive and
  plausible price, and a unique id.
- The most expensive tier is the lead panel.
- A tier with no Choose button says why (sold out, closed, not available).
- Every Choose link goes to `/tickets/checkout?tier=<id>` and lands on a
  checkout with that tier already chosen.
- All the FAQ answers open. The invoice link works. The contact email is a
  valid mailto.
- `?cancelled=1` shows "cancelled and nothing was charged".

**The checkout (`/tickets/checkout`)**

- Every tier opens with its own name, price, a hidden `tier` input carrying
  its id, and the same figure in the order rail, the summary line and (when
  open) the pay button.
- "Change" and "All tickets" both go back to `/tickets`.
- No tier, or an unknown tier id, shows a working picker with exactly one
  option checked, and picking each tier moves the rail and total with it.
- Quantity offers exactly 1 to 10. Choosing 3 draws three attendee cards
  labelled "Attendee 1 · you", "Attendee 2", "Attendee 3", the total triples,
  and the rail says "Plus 2 more attendees". Extra seats default to the
  buyer's tier. Typed names and emails survive going down to 2 and back up
  to 3. Ten seats is ten times the price. Back to 1 removes the cards.
- A mixed cart (two seats on one tier, one on another) adds up each seat at
  its own price.
- Every input has a label. Name and email are required, email is
  `type="email"`, name has `autocomplete="name"`.
- The form contains no field for a price, amount, card number, CVC or expiry.
- The code of conduct and privacy notice links resolve. "Pay by invoice
  instead" reaches `/tickets/invoice`.
- A cancelled Stripe payment returns to the checkout with the tier kept and
  "Checkout was cancelled. Nothing was charged."
- The form can be filled and the pay button reached with the keyboard alone.
- On a phone with three attendees nothing scrolls sideways and the pay button
  is at least 40px tall.
- The localhost-only "Skip payment and register (demo)" button never appears
  on a deployed site.

**With sales open, the server itself** (each stops before Stripe is asked for
anything, with the browser's own validation switched off so the server's is
what gets tested):

- A blank name is refused.
- A malformed email is refused, and what was typed is kept.
- Two attendees on one address are refused, including when the case differs.
- An extra attendee with no name is refused, naming "Attendee 2".
- A tier id that does not exist, posted directly, is refused.
- A valid single-seat order reaches `checkout.stripe.com` showing "KGC 2027:
  <tier>", the same amount the site showed, and the buyer's email. Nothing is
  charged and the unvisited session expires.
- With `PREPUBLISH_PAY=1` only: pays with the `4242` test card and expects the
  order page with the buyer's name and tier. It refuses to type a card unless
  Stripe shows **Test mode**, so it cannot run against a live key.

**Pay by invoice (`/tickets/invoice`)**

- Closed: the page says so, offers email, and draws no form.
- Open: every field is labelled, payment terms are Net 14/30/45/60 with 30
  preselected, the PO field caps at 30 characters. Attendees add and remove,
  the subtotal follows, a seat's own ticket reprices only that seat, and the
  form stops at ten. The server refuses a missing company, a bad billing email
  and a duplicate attendee. A valid invoice is never submitted, because that
  raises a real Stripe invoice and emails it.

**Sponsor and exhibitor packages (`/tickets/sponsor`, `/tickets/exhibitor`)**

- Either the packages render, each with a name, a positive price and details
  that open, or the page says they have not been published.
- Choosing a package selects it in the form below. "Choose a package" jumps
  to the form.

**Locks on the purchase path**

- The Stripe webhook refuses an unsigned post and a forged signature, and is
  never cached.
- `/checkout/return` with no session goes back to the checkout, and with a
  made-up session never leads to an order page or a server error.
- The localhost-only sign-in code reader answers 404. The sign-in code endpoint
  rejects an empty request without sending anything.
- A forged token is refused with 404 on the order page, speaker portal,
  reviewer pages, exhibitor page and its leads CSV, consent, profile and
  abstract pages. The leads export never returns a CSV.
- A forged unsubscribe link fails cleanly. A bad campaign link does not error.
- HSTS and `nosniff` are present.
- No Stripe secret or webhook key, private key, service account, Resend key or
  emulator host appears in the JavaScript sent with any purchase page, or in
  any script linked from any page. No script names a server-only variable
  (`STRIPE_SECRET_KEY`, `WEB_ORDER_SECRET`, `CONSOLE_PASSPHRASE` and so on),
  which would mean server code was bundled for the browser.

### The leak scan, on the droplet

`scripts/ops/leak-scan.sh` runs after every deploy, over the same SSH
connection, and with `--test` too. It reads every file the two sites serve
without a login (each app's `.next/static` and `public`, 680 files as of
2026-09-26) and checks for two things: anything shaped like a key, and the
exact value of every secret in `/opt/kgc/shared/web.env` and
`organizer.env`. The second catches secrets no pattern can, like the order
secret or the dashboard passphrase. It prints the name of a leaked variable,
never its value. Run it by hand with
`ssh root@142.93.180.72 'bash -s' < scripts/ops/leak-scan.sh`.

### Penetration checks [`@security`]

Attacks somebody would try against a ticketing site, from outside with no
login. All are safe on production: nothing is written, no email is sent, no
Stripe session is created, and the traffic is a few dozen requests.

- Private files are not served: `.env`, `.env.local`, `.git/config`,
  `package.json`, `next.config.ts`, `netlify.toml`, `.netlify/state.json`,
  `.next` build files, a service account file.
- Path traversal (`../../etc/passwd` and encoded forms) is refused.
- JavaScript source maps are not published. Folders do not list their files.
- Script put in the search box, in any query string on the purchase pages, or
  typed into the checkout form never runs and is never reflected as markup.
- Database-style injection and 8,000-character input in search do not error.
  Oversized and malformed ticket ids (`__proto__`, `{"$ne":null}`) do not error.
- A forged server action on the checkout is refused without a stack trace.
  Error pages leak no stack trace or file path.
- PUT, DELETE, PATCH, OPTIONS and TRACE do not error, and TRACE does not echo.
- The sign-in endpoints do not allow requests from other websites (CORS).
  `verify-code` refuses guessed, empty, object and array codes and never
  returns a token. Only made-up addresses are used, so no real account's
  lockout counter moves.
- No open redirect to another website from `/r/`, encoded `//`, `\`, or
  `next` and `redirect` parameters.
- Plain HTTP is upgraded to HTTPS.
- Purchase pages cannot be framed by another site (clickjacking).
- The server does not advertise its framework.
- Cookies the site sets are Secure and not SameSite=None.

Not covered, on purpose: load or denial-of-service testing, brute-forcing the
sign-in code, and anything that sends email. Those need a staging copy and the
owner's say-so, not a publish gate.

### Every page, on desktop and phone [`@smoke`, `@mobile`]

For each of the 26 public pages (the three that can be switched off from the
dashboard, `/agenda`, `/rooms` and `/speakers`, may answer 404 but never 5xx):

- Answers 200 within 8 seconds, HTML under 1.5MB.
- Has a real `<title>`, one visible `h1`, a meta description, the shared
  header and footer, and a link home.
- No visible `undefined`, `NaN`, `[object Object]`, `Invalid Date`, lorem
  ipsum, TODO, FIXME or unfilled `{{slot}}`.
- No secret and no wrong hostname (`kgc-2027-*`, `localhost`, the emulator
  port) anywhere in the HTML.
- Every image loads, after scrolling so lazy images request, and every image
  has an `alt` attribute.
- No console errors, no uncaught exceptions, and no same-origin request
  answering 4xx or 5xx, recorded for every test in the suite.
- On a 390px phone, nothing scrolls sideways. A failure names the widest
  elements.

Plus: the 404 page is a real page with the header and a way out; the tab icon
is served.

### Getting around [`@smoke`]

- Every desktop nav link resolves, and the current page is marked.
- The header Tickets button reaches `/tickets` on desktop and from the phone
  menu.
- The logo returns home.
- The phone menu opens, shows links inside the screen, and closes.
- Site search finds "ticket".
- Every footer link resolves and mailto links are well formed.
- **Every internal link on every public page** answers below 400, including
  links to pages that have been switched off. External links are checked for
  shape only.

### Accessibility, search and sharing [`@a11y`, `@smoke`]

- axe-core (WCAG 2.1 A and AA) on every page. Purchase pages fail on serious
  and critical violations; other pages on critical only. Lesser findings are
  attached to the report as warnings.
- The home page carries a valid schema.org `Event` with a name, start date,
  location, and a url on the canonical origin.
- `/` and `/tickets` have `og:title`, `og:description` and an `og:image` that
  actually returns an image. `lang="en"` and a responsive viewport are set.
- Every page title is unique.

## The one check that issues a real ticket

`specs/local-fulfilment.spec.ts` runs only on localhost and only when asked. It
uses the demo button, which runs the same validation as Stripe and then the
same fulfilment the webhook runs: registration, order, app account,
entitlements, sold count and receipt.

```bash
cd apps/web && npm run dev          # in one terminal
cd tests/prepublish && PREPUBLISH_LOCAL_WRITE=1 npm run test:local
node scripts/ops/reset-demo-sales.mjs   # afterwards, to remove the demo orders
```

It checks one seat lands on an order page with the name, tier and QR code, the
order link survives a reload and a tampered one 404s, and a three-seat
purchase completes. ⚠️ It writes to whichever Firestore `.env.local` points at,
which today is the live project. Every order it makes is `channel: 'demo'`.

## What automation cannot check, before the first real sale

Do these by hand once Stripe keys are in, and again after any change to the
money path.

1. Buy one ticket on staging with the Stripe test card. The order page
   shows the name, tier and QR code.
2. The receipt email arrives. (Until the Resend domain is verified it only
   reaches `hartigandeely@gmail.com`; any other address is logged as `failed`
   in `emailLog` with nothing on screen.)
3. Sign into the attendee app with the purchased email and see the badge.
4. The order appears on the dashboard's Tickets tab with the right amount,
   and the tier's sold count moved by one.
5. Refund it from the dashboard. The ticket's seat is returned.
6. Apply a Stripe promotion code and see the discount on Stripe's page.
7. Tax shows for a New York billing address.

## Last run

Staging, 2026-09-25, commit `59a31d0`: **364 passed, 0 failed**, 56 skipped
(the sales-open checks; staging has no Stripe key).

The run before it found seven defects, all fixed in `59a31d0`: the return
page after Stripe redirected buyers to `http://localhost:3200` (it built URLs
from `req.nextUrl.origin`, the internal address behind Apache); no HSTS,
nosniff, frame protection or webhook `no-store`; `x-powered-by` exposed; no
`h1` on `/tickets/checkout` and `/learn`; and two WCAG AA contrast failures.
The security headers are now set in `apps/web/next.config.ts`, so they do not
depend on the web server in front.

## Keeping it honest

- **A failure is a finding until proven otherwise.** Loosen a check only when
  the site is right and the check is wrong, and say why in the spec.
- New public page: add it to `ROUTES` in `tests/prepublish/helpers.ts`.
- New purchase page: add it to `MONEY_ROUTES` as well, which puts it under the
  stricter accessibility bar and the bundle secret scan.
- Changing the checkout's class names (`.tier-chosen`, `.order-rail`,
  `.rail-amount`, `.seat-card`, `form.checkout`) means updating
  `specs/04-checkout.spec.ts` in the same commit.
- Running against a local production build: set `WEB_PUBLIC_ORIGIN` to the
  URL you are serving, or `og:image` points at the production domain and fails.
- The suite runs three browsers at a time. Staging shares a 2GB droplet with
  WordPress and the dashboard; do not raise it.
