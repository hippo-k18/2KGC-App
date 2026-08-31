# D — Demo mode: complete removal map

Audit date 2026-08-30. Scope: every demo flag, faked payment, fixture, printed
credential, gap-note gate and stubbed send in the repo, with a KEEP/REMOVE
verdict per site.

**Read the one-paragraph answer first, because it changes the order of the
work:** removing demo mode removes the *only* thing in this codebase that gives
a real ticket buyer a working account. There is no password-set flow, no
claim-code sign-in, no sign-up screen and no OTP delivery. `claimCode` is a
check-in fallback, not a credential. The Stripe webhook does not provision
anything. Section 4 traces this in full; it is the blocking item.

---

## 1. Summary

There are **five independent mechanisms** that make this deployment a demo, and
they are not one switch:

| # | Mechanism | Where | What it is |
|---|---|---|---|
| 1 | `DEMO_MODE=1` (server, Next.js) | `apps/web`, `apps/organizer` | Explicit switch. Approves payment; prints credentials. |
| 2 | `EXPO_PUBLIC_DEMO_MODE=1` (client, Expo) | `app/` | Typing shortcuts + printed password on the attendee login. |
| 3 | `isDemoMode()` — *derived, not a flag* | `apps/organizer/src/lib/demo/store.ts:282` | No credentials ⇒ silently serve an 11,462-line in-memory `fixture.json` instead of Firestore. |
| 4 | `SHOW_GAP_NOTES` | `apps/organizer/src/lib/gap-notes.ts:24` | Hides 129 `GapPanel`s, 8 `NotBuilt` cards, 8 `GapTag`s and the login security banner. |
| 5 | Unconfigured-service fallbacks | `stripeEnabled()`, `emailEnabled()` | Not demo mode as such, but the branch `DEMO_MODE` rides on. |

Mechanism 3 is the dangerous one, because nobody sets it — it turns *itself* on
whenever a service-account credential is missing, and the only signal is one
line of copy on the login screen (`firestore.ts:96`).

The codebase is unusually honest about all of this: there is no fake latency, no
mock upload, no hardcoded array standing in for a Firestore read outside the
fixture store, and every "not built" claim I spot-checked is accurate. The
pretend behaviour is concentrated, documented in place, and removable.

One thing hiding in `functions/` changes the plan for the better: **the real
sign-in design is already written** — `requestOtp` and `verifyOtp`
(`functions/src/callable/`) with brute-force limits, transactional rate limits
and correct claim-minting. It is undeployed (Spark) and its delivery step is a
`console.log`. That is the replacement for demo mode, not a greenfield build.

---

## 2. The KEEP list — do not delete these

Two exceptions, called out separately so nobody sweeps them up with the rest.

### KEEP (a) — the sign-in input boxes on both login screens

| File:line | What it is |
|---|---|
| `apps/organizer/src/app/login/login-form.tsx:16-21` | Organizer **email** input (`name="email"`). |
| `apps/organizer/src/app/login/login-form.tsx:34-38` | Organizer **passphrase** input (`name="passphrase"`, `type="password"`). |
| `apps/organizer/src/app/login/page.tsx:31` | `<LoginForm needsPassphrase={requirePassphrase()} />` — renders the pair. |
| `apps/organizer/src/lib/auth.ts:132-140` | `passphrase()` / `requirePassphrase()` — the real check behind the box. |
| `app/src/app/login.tsx:216-230` | Attendee **email/username** `TextInput`. |
| `app/src/app/login.tsx:232-243` | Attendee **password** `TextInput` (`secureTextEntry`). |
| `app/src/app/login.tsx:252-273` | The Sign in button. |

These are the *fields*, not the demo affordances. What must go from around them
is listed in §3 (the printed panel, the `demo`/`123` mapping, the prefill, the
`OPEN_SIGNIN` bypass). If the attendee login later moves to OTP, the two boxes
become "email" and "6-digit code" — still two boxes, still this screen.

### KEEP (b) — the credit-card entry on checkout

| File:line | What it is |
|---|---|
| `apps/web/src/app/tickets/checkout-form.tsx:197-225` | The `<fieldset className="demo-card">` with card number / expiry / CVC inputs. |
| `apps/web/src/app/tickets/checkout-form.tsx:85-87` | The `card` / `expiry` / `cvc` React state that backs them. |
| `apps/web/src/app/globals.css:4738-4760+` | `.demo-card`, `.demo-card legend`, `.demo-card-grid` styling. |

⚠️ **Two things to understand before touching this, because "keep the card box"
and "remove the bypass" pull in opposite directions here.**

1. Today those inputs deliberately carry **no `name` attribute**
   (`checkout-form.tsx:76-84` explains why), so the browser never serialises
   them and no card data reaches the server action. That is what makes the box
   safe *and* what makes it fake. Keeping a real card form means giving those
   fields a real processor, not just leaving the markup in place.
2. The real money path in this repo is **hosted Stripe Checkout**
   (`apps/web/src/app/tickets/actions.ts:216-297`), which redirects the buyer to
   `checkout.stripe.com`. The card box is then on Stripe's page, not ours — by
   design, to stay in PCI SAQ A (`apps/web/src/lib/stripe.ts:10-14`).

So there is a decision to make, and it should be made deliberately rather than
discovered:

- **Option A (recommended, zero new PCI scope):** keep hosted Checkout. The card
  entry boxes exist and are real — they are Stripe's, on Stripe's domain, in
  test mode with `sk_test_…`. Delete the local `demo-card` fieldset since Stripe
  now renders the genuine one. This satisfies "a real Stripe test-mode card
  entry must remain".
- **Option B (card box stays on our page):** replace the cosmetic fieldset with
  **Stripe Elements** / Payment Element bound to a PaymentIntent. Same three
  visual fields, real tokenisation, but the site moves from SAQ A to SAQ A-EP.

Either way, what must go is the auto-approval (`actions.ts:143`), never the card
entry itself. Renaming `.demo-card` → `.card-fields` is worth doing under both
options so the class name stops advertising what it used to be.

---

## 3. The REMOVE table

Columns: **file:line** | **flag/mechanism** | **what the demo path does** |
**what the real path should do** | **verdict** | **risk if removed**.

### 3.1 `DEMO_MODE` — apps/web (the money path)

| file:line | flag | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `apps/web/src/lib/demo.ts:24-26` | `demoMode()` — reads `process.env.DEMO_MODE === '1'` | Returns true; the definition every site below reads | Delete the module | **REMOVE** (whole file) | None once call sites are gone; `tsc` names each one |
| `apps/web/src/app/tickets/actions.ts:13` | import of `demoMode` | — | — | **REMOVE** | none |
| `apps/web/src/app/tickets/actions.ts:132-209` | `if (!stripeEnabled())` — the entire no-Stripe fulfilment branch | Completes a purchase with **no payment processor at all**: writes the registration, increments `quantitySold`, provisions an Auth account, sends the receipt, redirects to the confirmation | Refuse to sell. An unconfigured production site must return an error, not hand out free tickets — which is what `demo.ts:19-22` itself argues | **REMOVE** (whole branch) | High value, low risk: this is the free-ticket path. Local dev without Stripe keys loses the ability to complete a checkout — use `sk_test_…` instead |
| `apps/web/src/app/tickets/actions.ts:143` | `const approved = demoMode()` | Flips the order from `pending` to **`paid` without money** | Order status comes from the Stripe webhook only | **REMOVE** | This is *the* auto-approved payment. Removing it is the point |
| `apps/web/src/app/tickets/actions.ts:151` | `externalId: \`demo_${tierId}_${email}\`` | Deterministic id so repeat demo buys update one order | Stripe session id | **REMOVE** with the branch | none |
| `apps/web/src/app/tickets/actions.ts:154` | `paid: approved` | Marks unpaid money as paid | — | **REMOVE** | none |
| `apps/web/src/app/tickets/actions.ts:158` | `channel: 'demo'` | Tags the order so exports can exclude it | `'checkout'` from the webhook | **REMOVE** | Removing the *branch* removes the writer. See §3.7 for the `'demo'` enum member and the reset script that queries it |
| `apps/web/src/app/tickets/actions.ts:193` | `if (approved) await provisionAppAccount(...)` | **The only thing in the repo that gives a buyer an app account** | Must move to the webhook, in a form that does not set a shared password — see §4 | **REMOVE, but only after a replacement exists** | 🔴 **This is the blocking item.** Remove it alone and every real buyer is locked out of the app |
| `apps/web/src/app/tickets/actions.ts:201, 208` | `mintOrderToken({ …, demo: true })` | Stamps the token so the confirmation page shows demo copy | `demo: false` | **REMOVE** | Outstanding demo links 404 — acceptable |
| `apps/web/src/app/tickets/actions.ts:205` | `demo: true` on the receipt | Receipt says no money changed hands | Real receipt | **REMOVE** | none |
| `apps/web/src/app/tickets/page.tsx:8, 267` | `demo={demoMode()}` prop into `CheckoutForm` | Turns on the demo notice, the cosmetic card box and the credential panel | Drop the prop | **REMOVE prop**; see KEEP (b) for the card box | Card box must be re-provided by Stripe (Option A) or Elements (Option B) |
| `apps/web/src/app/tickets/checkout-form.tsx:42, 55-59` | `demo` prop + its docblock | — | — | **REMOVE** | none |
| `apps/web/src/app/tickets/checkout-form.tsx:106-111` | Demo notice banner ("The card box below is for show") | Tells the room nothing is charged | — | **REMOVE** | none |
| `apps/web/src/app/tickets/checkout-form.tsx:112-118` | `!stripeReady` "Test mode" banner | Says the button registers without taking money | Should become an error state, not a banner over a working button | **REMOVE** (with the actions.ts branch) | none |
| `apps/web/src/app/tickets/checkout-form.tsx:9-10` | imports of `DemoPanel`, `DEMO_BUYER` | — | — | **REMOVE** | none |
| `apps/web/src/app/tickets/checkout-form.tsx:235-254` | `<DemoPanel>` with one-click fill of name/email/card | Prints and auto-fills the buyer's identity and Stripe's test PAN | Nothing | **REMOVE** | none |
| `apps/web/src/app/tickets/checkout-form.tsx:267-273` | Demo hint text ("Approved on the spot") | — | Stripe copy only | **REMOVE demo arm** | none |
| `apps/web/src/app/tickets/checkout-form.tsx:358-378` | `SubmitButton` `demo` arm — label `Pay {price}` with no processor | — | `Pay {price} with Stripe` always | **REMOVE demo arm** | none |
| `apps/web/src/components/demo-panel.tsx` (whole file, 99 lines) | The credential/fill panel | Prints credentials, copies on click, fills the form | Nothing | **REMOVE** (whole file) | none |
| `apps/web/src/lib/demo-credentials.ts:29-36` | `DEMO_BUYER` — name, email, card `4242…`, expiry, CVC | Hardcoded buyer identity | Nothing | **REMOVE** | none |
| `apps/web/src/lib/demo-credentials.ts:48` | `DEMO_APP_PASSWORD = 'the shared app password (redacted)'` | **The "publicly printed shared password"** ROADMAP.md:39 refers to | Nothing — replaced by OTP or a reset link | **REMOVE** | 🔴 See §4. `app-account.ts` and `order/[token]/page.tsx` both depend on it |
| `apps/web/src/lib/app-account.ts` (whole file, 169 lines) | `provisionAppAccount()` | Creates a real Firebase Auth account with the shared password, stamps `registered`/`roles`/`eventId`, writes `users/{uid}` and `directory/{uid}` | **Do not delete outright.** Lines 99-155 (claims + profile + directory mirror) are exactly what production needs; only the password (`:90`, `:96`, `:157`) is the demo part | **REWRITE, do not delete** | 🔴 Deleting this file wholesale is how the account gap becomes permanent |
| `apps/web/src/app/order/[token]/page.tsx:6, 66` | `demoMode()` | Chooses which confirmation copy renders | Real copy only | **REMOVE** | none |
| `apps/web/src/app/order/[token]/page.tsx:107-118` | Two demo notice variants | "Payment approved — demo" / "No payment was taken" | Stripe receipt notice (`:120-124`) | **REMOVE both** | none |
| `apps/web/src/app/order/[token]/page.tsx:10, 209-231, 226` | Prints `{reg.email}` + `DEMO_APP_PASSWORD` on the confirmation page | Hands the buyer working credentials in plain text on a web page | Must print a **one-time sign-in link or "check your email"**, never a password | **REMOVE** | 🔴 Removing this leaves `:232-240`, which tells the buyer to "sign in with this address" — a promise nothing keeps. §4 |
| `apps/web/src/app/globals.css:4611-4736` | `.demo-panel*` rules | Styles the credential panel | — | **REMOVE** | none |
| `apps/web/.env.example` (Demo mode block, last 6 lines) | Documents `DEMO_MODE=1` | — | — | **REMOVE** | none |
| `apps/web/.env.local:5` | `DEMO_MODE=1` — **live, right now** | — | — | **REMOVE** | none |

### 3.2 `DEMO_MODE` — apps/organizer (printed passphrase)

| file:line | flag | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `apps/organizer/src/lib/demo-mode.ts:15-17` | `demoMode()` | `DEMO_MODE === '1'` | Delete | **REMOVE** (whole file) | none |
| `apps/organizer/src/lib/demo-mode.ts:28-33` | `demoCredentials()` | Reads `CONSOLE_ALLOWLIST[0]` + `CONSOLE_PASSPHRASE` and returns them for printing | Nothing | **REMOVE** | none |
| `apps/organizer/src/app/login/page.tsx:7, 17` | import + `demoMode() ? demoCredentials() : null` | — | — | **REMOVE** | none |
| `apps/organizer/src/app/login/page.tsx:39-48` | `<DemoPanel>` printing the organizer email and passphrase | Prints the **only** secret in front of an Admin SDK that bypasses every security rule (`components/demo-panel.tsx:22-24` says so) | Nothing | **REMOVE** | none — this is a pure security win |
| `apps/organizer/src/components/demo-panel.tsx` (whole file, 77 lines) | The panel | — | — | **REMOVE** | none |
| `apps/organizer` CSS for `.demo-panel*` | (in the Whova stylesheet) | — | — | **REMOVE** | none |
| `apps/organizer/.env.example` (Demo mode block) | Documents `DEMO_MODE=1` | — | — | **REMOVE** | none |
| `apps/organizer/.env.local:8` | `DEMO_MODE=1` — **live** | — | — | **REMOVE** | none |
| `apps/organizer/.env.local:5-6` | `CONSOLE_ALLOWLIST=demo@knowledgegraph.tech,…`, `CONSOLE_PASSPHRASE=the live dashboard passphrase (redacted)` | A 13-char passphrase that is printed in `demo/act3-dashboard.mjs:39` and therefore committed history | Rotate to a random 32+ char value; drop the `demo@` allowlist entry | **REMOVE / ROTATE** | Anyone who has read the repo has the live dashboard credential |

### 3.3 `EXPO_PUBLIC_DEMO_MODE` — the attendee app

| file:line | flag | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `app/src/app/login.tsx:77` | `DEMO_MODE = EXPO_PUBLIC_DEMO_MODE === '1'` | Arms `SHORTCUTS` against the **live** project | — | **REMOVE** | none |
| `app/src/app/login.tsx:51` | `USE_EMULATOR` | Also arms `SHORTCUTS` | Keep the emulator flag itself (it selects the backend elsewhere) but stop it gating credentials | **REMOVE from `SHORTCUTS`** | none |
| `app/src/app/login.tsx:80` | `SHORTCUTS = USE_EMULATOR \|\| DEMO_MODE` | Master switch for the shortcuts below | — | **REMOVE** | none |
| `app/src/app/login.tsx:100` | `OPEN_SIGNIN` | **Total bypass** — any input, or none, signs in as a seeded attendee holding the `organizer` role. Triple-gated to the emulator (`:125-127`, `:158-161`) | Delete | **REMOVE** | none. Gating is careful, but the flag has no place in a shipping build |
| `app/src/app/login.tsx:102-106` | `DEMO_USERNAME='demo'`, `DEMO_PASSCODE='123'`, `DEMO_EMAIL`, `DEMO_REAL_PASSWORD='the shared app password (redacted)'` | The shared password, hardcoded a second time | — | **REMOVE** | none |
| `app/src/app/login.tsx:121-135` | `resolveCredentials()` | Maps `demo`/`123` → a real live account (`:128-130`); expands a bare local part to `…@example.test` and **substitutes the shared password when the field is empty** (`:131-133`) | Pass the typed values straight through: `return { email: username.trim(), password }` (`:134`) | **REMOVE :125-133**, keep `:134` | none |
| `app/src/app/login.tsx:142-143` | Prefilled `demo` / `123` in state | Fields arrive pre-typed | Empty strings | **REMOVE** | none |
| `app/src/app/login.tsx:220, 226-228` | `SHORTCUTS ? 'Username' : 'Email'` etc. | Relabels the email field as "Username", switches keyboard type | Always the email variants | **REMOVE ternaries, keep the input** | none — the box itself is KEEP (a) |
| `app/src/app/login.tsx:255, 260` | `!OPEN_SIGNIN && (!email \|\| !password)` | Lets the button enable with empty fields | `disabled={busy \|\| !email \|\| !password}` | **REMOVE the `OPEN_SIGNIN` term** | none |
| `app/src/app/login.tsx:275-316` | The whole printed-credentials block | Prints `demo`/`123`, the seeded address, `the shared app password (redacted)`, and "Just bought a ticket? Use that email address, with the same password" | Nothing — or, after OTP, "we emailed you a code" | **REMOVE** | 🔴 `:312-314` is the *only* place the app tells a real buyer how to get in. Removing it without §4 leaves the screen silent about a flow that no longer exists |
| `app/.env.local:19` | `EXPO_PUBLIC_DEMO_MODE=1` — **live** | — | — | **REMOVE** | none |
| `app/.env.example` (last block + `EXPO_PUBLIC_OPEN_SIGNIN=0`) | Documents both | — | — | **REMOVE** | none |

### 3.4 `isDemoMode()` — the silent fixture Firestore (highest-risk item)

| file:line | mechanism | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `apps/organizer/src/lib/demo/store.ts:282-285` | `isDemoMode()` — **derived**, not a flag: true whenever `FIRESTORE_EMULATOR_HOST`, `GOOGLE_APPLICATION_CREDENTIALS` and `FIREBASE_SERVICE_ACCOUNT` are all unset | Silently substitutes an in-memory store | Throw. `firestore.ts:76-84` already has the correct error text for the no-credential case | **REMOVE** | ⚠️ A misconfigured deploy currently shows a fully-populated dashboard of invented data. After removal it shows a startup error — which is the honest outcome |
| `apps/organizer/src/lib/demo/store.ts` (whole file, 285 lines) | A partial Firestore implementation (`==`, `in`, `array-contains`, `orderBy`, `limit`, `count`, `collectionGroup`, subcollections) | Writes mutate one Netlify instance's memory and vanish (`:28-34`) | — | **REMOVE** | Loses the ability to run the dashboard with no backend at all. That capability is the problem |
| `apps/organizer/src/lib/demo/fixture.json` (343 KB, 11,462 lines) | A verbatim export of the seeded emulator — 72 sessions, 45 speakers, 50 attendees, 50 registrations | The data every screen renders when credentials are absent | — | **REMOVE** | none |
| `apps/organizer/src/lib/firestore.ts:5, 32` | `if (isDemoMode()) return demoFirestore()` | The substitution point | Fall through to the credential check | **REMOVE** | none |
| `apps/organizer/src/lib/firestore.ts:96` | `if (isDemoMode()) return 'demo data (no database — nothing is saved)'` | The **only** on-screen signal that the dashboard is fictional — rendered at `login/page.tsx:29` | — | **REMOVE** | none |
| `apps/organizer/src/lib/data.ts:430-433` | `select('email')` deliberately omitted because the fixture store doesn't implement `select` | Costs a full-document read on every masthead render | Add `select('email')` back | **REMOVE the workaround** — i.e. add the `select` | Small perf win, free once the store is gone |

### 3.5 `SHOW_GAP_NOTES` — every screen it hides

| file:line | mechanism | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `apps/organizer/src/lib/gap-notes.ts:23-25` | `gapNotesVisible()` — `SHOW_GAP_NOTES === '1'`, **default off** | Hides all gap UI | — | **Decision, not a removal** — see below | — |
| `apps/organizer/src/app/(dash)/ui.tsx:316-325` | `GapPanel` — returns `null` when off | Hides **129 "Not built here" panels** across `(dash)` | — | **KEEP the component, flip the default** | Turning them *on* makes 129 screens carry a "not built" panel |
| `apps/organizer/src/app/(dash)/ui.tsx:334-337` | `GapTag` | Hides **8 grey "not built" header tags** | — | same | — |
| `apps/organizer/src/app/(dash)/ui.tsx:~355-365` | `NotBuilt` | Hides **8 full gap cards** | — | same | — |
| `apps/organizer/src/app/login/page.tsx:8, 56-69` | The sign-in security banner (shared-secret caveats, Admin SDK warning) | Hidden from the audience | Operator guidance — arguably should always show | **KEEP; consider unconditional** | — |
| `apps/organizer/src/app/(dash)/error.tsx:15` | Note that `gapNotesVisible()` is server-read | Documentation only | — | **KEEP** | — |

**Verdict on the gap-note system: this is not demo mode and should probably
survive the cleanup.** The flag hides *accurate* statements about what the
product does not do (`gap-notes.ts:14-16` argues the asymmetry honestly). If the
goal is "behaves like the real thing", the honest position is either to leave the
notes off permanently *because the gaps get closed*, or to turn them on
permanently *because they are true*. What is not defensible is keeping a switch
whose stated purpose is "an audience reads them as a verdict on the product".
Recommend: keep `GapPanel`/`GapTag`/`NotBuilt` as components, delete
`gap-notes.ts`, and make each one render unconditionally — then delete the ones
whose gap has actually been closed. That is a follow-on task, not a blocker.

### 3.6 Stubbed sends and other pretend behaviour

| file:line | mechanism | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `functions/src/callable/request-otp.ts:88` | `console.log(\`[requestOtp] sign-in code for ${email}: ${code}\`)` | **The sign-in code is written to a Cloud Functions log instead of being emailed.** The docblock (`:40-45`) states plainly this must not ship | Send via `sendOtpEmail` using `scripts/src/lib/email.ts` | **REMOVE / REPLACE** | 🔴 Without this replaced, deploying the OTP flow gives you an OTP nobody receives. §4 |
| `scripts/src/lib/email.ts:55-56` | `emailEnabled()` — `Boolean(RESEND_API_KEY)` | — | — | **KEEP** | — |
| `scripts/src/lib/email.ts:123-127` | No key ⇒ write `emailLog` with `status: 'skipped'`, `reason: 'RESEND_API_KEY is not set'` and return | Nothing is sent; nothing is claimed to have been sent | Same, plus a real key in production | **KEEP the code, SET the key** | This is correct graceful degradation, not a fake. It becomes a *behaviour* problem only because `RESEND_API_KEY` is currently unset (`DEMO.md:29-32`) |
| `apps/organizer/src/app/(dash)/messaging/actions.ts:85-90`, `.../email-campaign/actions.ts:85-90` | Refuse to "send" when no provider is configured | Returns an explicit refusal | Same | **KEEP** | — |
| `apps/organizer/src/lib/push.ts:42+` | `canSend()` false without config; refuses rather than pretends | — | — | **KEEP** | — |
| `apps/web/src/app/page.tsx:80-91` | `withDeadline()` — a 6s `setTimeout` racing a Firestore read | A real timeout, not fake latency | — | **KEEP** | — |
| `apps/web/src/components/demo-panel.tsx:50`, `apps/organizer/src/components/demo-panel.tsx:34` | `setTimeout` on the "copied" flash | — | — | **REMOVE with the panels** | — |
| — | **Fake uploads** | None found. `apps/organizer/src/lib/images.ts:14-40` states that nothing in the project uploads a file and *counts* the gap from live data | Build uploads | **N/A** | Genuinely absent, not faked |
| — | **Hardcoded arrays standing in for Firestore** | None outside `demo/fixture.json`. `apps/web/src/lib/catalogue.ts:140` explicitly **throws** rather than falling back to hardcoded prices | — | **KEEP that throw** | — |

### 3.7 Seed data, demo tooling and ops — lower priority

| file:line | mechanism | demo path does | real path should | verdict | risk if removed |
|---|---|---|---|---|---|
| `scripts/src/lib/fixtures.ts` (934 lines) | Seed content: real tracks/rooms/ticket tiers, **invented** session titles and speaker names (`:1-13`) | Feeds `npm run seed` only — imported by `scripts/src/seed-demo.ts:21` and nothing else | Replaced by `npm run import:whova` when the real export exists | **KEEP for now, REPLACE with the real import** | Not wired into any runtime path. Losing it costs local development |
| `scripts/src/seed-demo.ts:223` | Mints `claimCode()` / `qrSecret()` on 50 synthetic registrations | Demo data | — | **KEEP** (dev tooling) | — |
| `scripts/src/set-claims.ts:23, 81, 98` | `DEMO_PASSWORD = 'the shared app password (redacted)'` set on 50 real Auth accounts, printed to stdout | The shared password's third hardcoded copy | Delete once OTP lands | **REMOVE (after §4)** | Dev sign-in against the emulator breaks until OTP exists locally |
| `scripts/src/set-claims.ts:26-48` | `--confirm-live` guard | Correctly refuses to touch live Auth without both emulator hosts. **Note: it was run against live anyway** — `DEMO.md:53-58` records 50 live accounts created with this password | Rotate or delete those 50 accounts | **KEEP the guard; REMEDIATE the accounts** | 🔴 50 live accounts on `kgc-conference-app-and-website` currently share a password published in this repo |
| `packages/shared/src/models.ts:854` | `channel?: "checkout" \| "invoice" \| "manual" \| "demo"` | The `'demo'` enum member | Drop `'demo'` | **REMOVE the member last** — after existing demo orders are cleared | Dropping it while `channel: 'demo'` documents exist breaks the reset script's query |
| `scripts/ops/reset-demo-sales.mjs` | Deletes `orders` where `channel == 'demo'` and their registrations, decrementing `quantitySold` | Rehearsal cleanup | Run it **once**, then delete the script | **RUN, then REMOVE** | Run it before dropping the `'demo'` enum member, or the demo orders become unfindable |
| `demo/` (act1-buy.mjs, act2-app.mjs, act3-dashboard.mjs, lib.mjs, cards.mjs …) | Playwright recording harness driving the deployed sites | Depends on `DEMO_MODE=1`, `demo.attendee@example.com`, `the shared app password (redacted)` (`act2-app.mjs:31`), `the live dashboard passphrase (redacted)` (`act3-dashboard.mjs:39`) | — | **REMOVE the whole directory**, or accept it stops working | It is not a workspace member and nothing imports it. It does hardcode two live secrets |
| `app/scripts/public-demo.sh`, `EXPO_PUBLIC_EMULATOR_*_URL` | Cloudflare tunnel demo | Emulator-only | — | **REMOVE** | none |
| `DEMO.md`, `PRESENT.md`, `HANDOFF-PROMPT.md:6`, `DEPLOY-NETLIFY.md:87,109,122,207`, `README.md:285`, `ROADMAP.md:36-40,297`, `AGENTS.md:91-101,108-112` | Documentation of all the above | — | — | **UPDATE** | Stale docs describing a demo mode that no longer exists is the failure mode `AGENTS.md` itself warns about |
| Netlify env (both sites) | `DEMO_MODE=1` set in the Netlify UI, per `DEPLOY-NETLIFY.md:109,122` | — | — | **REMOVE from both site configs** | Code changes alone are not enough — the env var lives in Netlify, outside the repo |

---

## 4. What breaks, and what must be built to replace it

### 4.1 The answer, stated first

**No. After removing demo mode, a real purchaser has no way to get an account
and no way to sign in.** There is no real password-set flow and no claim-code
sign-in flow. Both exist only inside `DEMO_MODE`. The production design is
written but undeployed and, in its current state, undeliverable.

### 4.2 The trace

**Step 1 — What creates a Firebase Auth account today?** Exactly three things,
and only one of them is reachable by a buyer.

| Creator | file:line | Reachable by a real buyer? |
|---|---|---|
| `provisionAppAccount()` | `apps/web/src/lib/app-account.ts:57-168` | **Only via `actions.ts:193`** |
| `set-claims.ts` | `scripts/src/set-claims.ts:81` | No — a laptop script, run by hand |
| `verifyOtp` | `functions/src/callable/verify-otp.ts:193` | No — not deployed (Spark) |

**Step 2 — Is `provisionAppAccount` reachable on the real money path?** No. Its
single call site is:

```
apps/web/src/app/tickets/actions.ts:132   if (!stripeEnabled()) {
apps/web/src/app/tickets/actions.ts:143     const approved = demoMode();
apps/web/src/app/tickets/actions.ts:193     if (approved) await provisionAppAccount({ … });
```

It is **doubly gated**: inside the no-Stripe branch *and* behind `demoMode()`.
The moment `STRIPE_SECRET_KEY` is set, control never reaches line 132 — it goes
to hosted Checkout at `:216-297` instead.

**Step 3 — Does the Stripe webhook provision anything?** No. I grepped
`apps/web/src/app/api/stripe/webhook/route.ts` for `getAuth`,
`setCustomUserClaims`, `createUser`, `provision` and `app-account`: **zero
matches**. The webhook writes the registration (`ensureRegistration`),
increments `quantitySold`, marks the order paid, and sends the confirmation
email with a claim code and an `/order/{token}` link (`:239-250`, `:415`). It
creates no identity of any kind.

**Step 4 — Can a buyer sign themselves up?** No. The app's entire auth surface
is one call:

```
app/src/app/login.tsx:12    import { signInWithEmailAndPassword } from 'firebase/auth';
app/src/app/login.tsx:163   await signInWithEmailAndPassword(auth, creds.email, creds.password);
```

There is no `createUserWithEmailAndPassword`, no `sendPasswordResetEmail`, no
`sendSignInLinkToEmail`, no `signInWithCustomToken` anywhere in `app/src`. The
route list (`app/src/app/`) has `login.tsx` and no sign-up, no forgot-password,
no claim screen.

**Step 5 — Is `claimCode` a sign-in credential?** **No**, and this is the most
likely wrong assumption to make from the confirmation page's wording. Its uses:

- Minted in `scripts/src/lib/fulfilment.ts:117,131` and printed on the
  confirmation page (`order/[token]/page.tsx:182-187`) and in the receipt email
  (`scripts/src/lib/email.ts:266,278`).
- Consumed at the **check-in desk** only — matched against a typed string in
  `apps/organizer/src/lib/checkin.ts:189-200` (`matchedOn: 'claimCode'`).
- `app/src/lib/data/badge.ts:80-83` states it explicitly: `qrSecret` "is not a
  sign-in credential. The sign-in fallback printed on a badge is `claimCode`" —
  but nothing in the app or the website ever *accepts* a `claimCode` as
  sign-in input. The intent exists; the implementation does not.
- `claimedByUid` (`app/src/lib/data/badge.ts:353`) is written **after** sign-in
  as bookkeeping. It records a claim; it does not grant one.

**Step 6 — Even with an account, would the app work?** No. `firestore.rules` is
default-closed and gates on the `registered` custom claim (AGENTS.md "Security
model"). The claim is minted in exactly three places — `app-account.ts:108`,
`set-claims.ts:87`, `verify-otp.ts:186,195` — the same three from Step 1. A
buyer who somehow obtained an account would sign in successfully and see an
empty app, with `permission-denied` on `users/{uid}`.

**Step 7 — What survives removal?** The confirmation page's non-demo arm
(`order/[token]/page.tsx:232-240`) tells the buyer: *"Sign in with `{reg.email}`
— the same address you registered with."* That sentence becomes false the moment
`DEMO_MODE` comes out. It is precisely the failure `app-account.ts:14-18`
describes as the reason the module was written in the first place.

### 4.3 What already exists to build on — this is better than it looks

`functions/src/callable/` contains a complete, careful OTP implementation:

- `request-otp.ts:47-91` — 6-digit code, 10-minute TTL, 5-per-hour rate limit,
  all in one transaction, and **deliberately no registration lookup** so the
  endpoint cannot be used to enumerate the guest list (`:20-32`).
- `verify-otp.ts:112-199` — 5-attempt cap enforced transactionally, expiry
  separate from exhaustion, an active-registration check on primary email *and*
  `altEmails`, correct claim minting that never overwrites a manually-granted
  `organizer` role (`:177-196`), and a custom token returned for
  `signInWithCustomToken`.
- Both are exported from `functions/src/index.ts:33,35`.
- `otpCodes` and `rateLimits` are modelled in `packages/shared/src/collections.ts:53-54`
  and have **no `match` block in `firestore.rules`** — correct, since the
  callables use the Admin SDK.

Two things are missing from it: **deployment** (needs Blaze) and **delivery**
(`request-otp.ts:88` logs the code instead of emailing it).

### 4.4 Prioritized TODO

**P0 — must land before, or in the same change as, removing demo mode.**

1. **Give `requestOtp` a real delivery channel.** Replace the `console.log` at
   `functions/src/callable/request-otp.ts:88` with a send through
   `scripts/src/lib/email.ts` (add a `sendSignInCode` template beside
   `sendPurchaseConfirmation`). Set `RESEND_API_KEY` on both Netlify sites and
   in the functions config. Until this is done the OTP flow delivers nothing.
   *Risk if skipped: the replacement flow is as broken as the thing it replaces.*
2. **Upgrade to Blaze and deploy `requestOtp` / `verifyOtp`.** Per
   AGENTS.md "Suggested next steps", Blaze is required for function deployment
   and nothing else here; free quotas are identical. Note `firebase deploy` is
   refused on this project (`serviceusage` 403) — the existing workaround
   scripts are rules/indexes only, so function deployment needs its own path
   sorted out. *This is the long-pole item; start it first.*
3. **Rebuild the attendee sign-in screen around OTP.** Keep both input boxes
   (KEEP (a)): field one becomes email, field two becomes the 6-digit code,
   with a "send me a code" step between. Call `requestOtp`, then `verifyOtp`,
   then `signInWithCustomToken(auth, token)`. Delete
   `app/src/app/login.tsx:51,77,80,100-106,121-133,142-143,275-316`.
4. **Move account provisioning onto the real money path — without a shared
   password.** Keep `apps/web/src/lib/app-account.ts:99-155` (claims, `users/{uid}`,
   the `directory/{uid}` mirror — all of which production needs and which the
   undeployed `mirrorDirectory` trigger cannot yet do). Remove the `password:`
   arguments at `:90` and `:96` and the return at `:157`. Then decide:
   - *If OTP ships (P0.2):* `verifyOtp` creates the account on first sign-in and
     `app-account.ts` is not needed on the purchase path at all. Simplest.
   - *If OTP slips:* call the rewritten `provisionAppAccount` from the **Stripe
     webhook** (`apps/web/src/app/api/stripe/webhook/route.ts`, beside
     `sendPurchaseConfirmation` at `:239` and `:415`), creating a
     password-less account and emailing an Admin-SDK
     `generatePasswordResetLink()` — a per-buyer, time-limited, single-use link.
     Never a constant.
5. **Fix the confirmation page's promise.** `apps/web/src/app/order/[token]/page.tsx:207-241`
   must say "we emailed you a sign-in link/code", not print a password
   (`:226`) and not assert an account exists (`:232-240`) unless one does.
6. **Remove the auto-approval and the free-ticket branch.**
   `apps/web/src/app/tickets/actions.ts:132-209` in full. Make an unconfigured
   `stripeEnabled()` return an error at `:132` rather than fulfil.

**P1 — security remediation, independent of the above.**

7. **Rotate the 50 live Auth passwords.** `DEMO.md:53-58` records 50 real
   accounts created on the live project with `the shared app password (redacted)`, which appears in
   five files in this repo. Delete or rotate them, then delete
   `scripts/src/set-claims.ts:23`.
8. **Rotate `CONSOLE_PASSPHRASE`.** `apps/organizer/.env.local:6` is
   `the live dashboard passphrase (redacted)`, also hardcoded in `demo/act3-dashboard.mjs:39`. It is the
   entire boundary in front of an Admin SDK. Also drop the `demo@` entry from
   `CONSOLE_ALLOWLIST` and confirm `requirePassphrase()` (`auth.ts:138-140`)
   holds in production — it does, via `NODE_ENV`.
9. **Delete the fixture Firestore.** `apps/organizer/src/lib/demo/{store.ts,fixture.json}`
   and the two call sites in `firestore.ts:32,96`. A missing credential must
   throw (the error text at `firestore.ts:76-84` is already correct), not
   silently serve 343 KB of invented data as if it were the event.
10. **Clear `DEMO_MODE=1` from Netlify** on both sites, and delete it from all
    three `.env.local` files and both `.env.example`s. Code removal alone leaves
    the variable set in the hosting UI.

**P2 — tidy-up, once the above is green.**

11. Run `scripts/ops/reset-demo-sales.mjs`, then delete the script, then drop
    `"demo"` from `OrderDoc['channel']` (`packages/shared/src/models.ts:854`).
    That order matters — the script's only query is `channel == 'demo'`.
12. Settle the card-entry question (KEEP (b), Options A/B) and rename
    `.demo-card` → `.card-fields` in `checkout-form.tsx:198` and
    `globals.css:4738+`.
13. Decide the fate of `SHOW_GAP_NOTES` (§3.5). Recommend deleting the flag and
    rendering the notes unconditionally, then closing or deleting them one by
    one — 129 panels, 8 cards, 8 tags.
14. Delete `demo/` (the Playwright harness) and `app/scripts/public-demo.sh`.
15. Rewrite `DEMO.md`, and correct `AGENTS.md:91-112`, `ROADMAP.md:36-40,297`,
    `README.md:285`, `DEPLOY-NETLIFY.md:87,109,122,207` and
    `HANDOFF-PROMPT.md:6`.
16. Add `select('email')` back at `apps/organizer/src/lib/data.ts:~434`, now
    that the fixture store no longer constrains it.

### 4.5 One thing that does *not* break

Everything downstream of sign-in is real and survives untouched: the `registered`
/ `roles` custom claims, the 143-test `firestore.rules` boundary, the badge QR
(`qrSecret`), the check-in loop, the idempotent `checkIns` keying, the refund
path, invoice splitting, and the whole organizer dashboard's data layer. The
demo was never faking those. It was faking **payment** and **identity** — and of
the two, identity is the one with no replacement currently in the product.
