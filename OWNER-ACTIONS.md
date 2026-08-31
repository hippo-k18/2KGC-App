# Things only you can do

Everything else in `BUILD-PLAN.md` proceeds without you. These do not, because
they need a console click, a credential, or an identity I do not hold.

Ordered by what unblocks the most.

---

## 1. Create the Storage bucket · unblocks ~24 screens

⚠️ **The default bucket does not exist.** Verified twice by probe: both
`kgc-conference-app-and-website.firebasestorage.app` and
`…appspot.com` return 404 "The specified bucket does not exist" from the
anonymous GCS API. (An existing private bucket returns 403, so this is a real
absence, not a permissions artefact.) The value in `.env.local` is SDK config,
not evidence of provisioning.

The whole upload path is built, tested against the Storage emulator, and waiting
on this one click.

1. **Firebase console → Build → Storage → Get started.**
   Choose location **`us-central1`**. It matches the `nam5` Firestore database
   and **cannot be changed later**.
2. Publish the storage rules:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=.secrets/service-account.json \
   node scripts/ops/deploy-rules.mjs \
     storage.rules \
     firebase.storage/kgc-conference-app-and-website.firebasestorage.app
   ```
   `deploy-rules.mjs` already takes both arguments — `ROADMAP.md:313` is wrong
   that this "needs a second release target"; it needs a second *argument*.
3. Only if the console hands out a different bucket name, set
   `FIREBASE_STORAGE_BUCKET` in `apps/organizer/.env.local` **and** on Netlify.

**Cost: no.** Free tier is ~5 GB stored and 1 GB/day download on the *default*
bucket. KGC's realistic total is under 100 MB — about 2%.
⚠️ Never point `FIREBASE_STORAGE_BUCKET` at a hand-made second bucket: a
non-default bucket bills from the first byte.

---

## 2. Stripe test keys · ⚠️ the website cannot sell a ticket without them

**Updated 2026-08-31 with BUILD-PLAN 1.4–1.8.** Demo mode is out, including the
branch that completed a purchase with no payment processor. There are still **no
Stripe keys anywhere in this repo**, so the deployed website now *declines to
sell*: `/tickets` says `STRIPE_SECRET_KEY` is not set, the pay button is
disabled, and the server action refuses before it reads a tier. That is the
intended behaviour (BUILD-PLAN D-1 — an unconfigured site must not hand out free
tickets), and it means this item has gone from "unblocks a cleanup" to "the only
thing standing between the site and taking money". The Stripe integration code is
written and correct; it has never had a key.

Paste into `apps/web/.env.local` and the Netlify UI for the website:

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
```

**Cost: none.** Stripe test mode moves no money and charges no fees.

The card boxes you asked to keep are still on the checkout page and always
render. ⚠️ **They do not yet reach a processor** — they carry no `name`, so
nothing is submitted, and with hosted Checkout the real card entry is on
`checkout.stripe.com`. Making them the boxes that actually take the payment is
BUILD-PLAN 1.6 (a Stripe Payment Element), and it needs a **publishable** key
(`pk_test_…`) as well as the two above.

---

## 3. The `serviceusage` IAM grant · unblocks Cloud Functions

Every `firebase deploy` pre-flights against `serviceusage.googleapis.com`, and
no identity on this project holds `serviceusage.services.use` — not the
signed-in owner, not the Admin SDK service account. That is why
`scripts/ops/deploy-rules.mjs` and `deploy-indexes.mjs` exist.

⚠️ **A `deploy-functions.mjs` would not solve it this time.** Rules and indexes
work around the 403 because those APIs do not need the permission. Deploying a
**v2 function needs five APIs *enabled***, which needs
`serviceusage.services.enable` — the same 403, one layer down. **The fix is the
IAM grant, not another script.**

`gcloud` is not installed on this machine, so I cannot diagnose or grant it.
`docs/deploy-functions.md` has the read-only diagnosis commands and the ordered
runbook.

---

## 4. ⚠️ Rotate two live secrets

**Updated 2026-08-31.** Both literals have been **removed from the working
tree** — the app password now comes from `SEED_PASSWORD`, the demo harness reads
`ORGANIZER_PASSPHRASE` and `BUYER_PASSWORD`, and the printed-credential panels
that displayed them are deleted. That is not the same as rotating them. Both
values are still in **git history**, still on **50 live Auth accounts**, and
still in the **Netlify configuration**, and only you can change that.

| Secret | Still live where | What it opens |
|---|---|---|
| the shared app password | 50 real Auth accounts on the live project; git history | Every one of those accounts, each carrying `registered: true` |
| the dashboard passphrase | `apps/organizer/.env.local` (gitignored) and the dashboard's Netlify env; git history | The live `CONSOLE_PASSPHRASE` — and the dashboard behind it uses the **Admin SDK, which bypasses `firestore.rules` entirely** |

The dashboard passphrase is the more serious of the two: `apps/organizer/src/lib/auth.ts`
is an email allowlist plus that one shared secret, and it is the whole security
boundary in front of every organizer capability.

This is yours because rotating the first means changing 50 Auth accounts, and
because a new secret should not pass through me. Note that nothing needs the
first one any more: no account this project provisions has a password, and
sign-in is the six-digit code. Deleting those 50 accounts is a valid rotation.

### 4b. ⚠️ Delete `DEMO_MODE=1` from Netlify, on both sites

Removing it from the code does not remove it from the hosting configuration. It
is set in the Netlify UI on **both** the website and the dashboard
(`DEPLOY-NETLIFY.md` §Environment variables). It is now inert — nothing reads it
— but a stale flag in a hosting config is how the next person concludes it still
does something. Site settings → Environment variables → delete, on each site.

---

## 5. Before any function deploys — the cost guardrails

Do these **first**, in this order. A budget alert *notifies*; it does not cap.
Only a quota cap actually stops spending.

1. A **budget alert** on the project.
2. **Hard quota caps** on Cloud Functions invocations and on Firestore
   reads/writes. ⚠️ This project has exhausted the Firestore free tier before —
   see commit `4cd52ac`.
3. Confirm `maxInstances` is set on all 12 functions and that `minInstances`
   stays unset. ★ Verify this **in the Cloud Run console, not in the source**:
   `setGlobalOptions` placed in `functions/src/index.ts` would silently do
   nothing, because that file is nothing but `export … from` statements and all
   12 functions are defined before its body runs. You would deploy believing you
   had capped them.
4. An **Artifact Registry cleanup policy**. It is the one thing here that bills
   at idle — 0.5 GB free, and 12 function images grow with every redeploy.

`docs/deploy-functions.md` is the full runbook, written to be followable at 2am.

---

## 6. A Resend API key · unblocks OTP sign-in

**Added 2026-08-31 with BUILD-PLAN task 1.2.**

`requestOtp` now emails the six-digit sign-in code instead of printing it to
the function's console. Everything on our side is written, tested and waiting on
one credential.

This matters more than it did when the same key only governed receipts. Demo
mode is now out, so **OTP is the only way a real ticket purchaser gets into the
app** — audit D's central finding. A missing receipt is an annoyance; a
missing sign-in code is an attendee who cannot open the app.

1. Create an account at <https://resend.com> and **verify the sending domain**
   (`knowledgegraph.tech`, or whatever `EMAIL_FROM` points at). An unverified
   domain does not fail quietly — Resend returns 403 on every send.
2. Set the key in **three** places. Two of them are already documented in
   `SETUP-PAYMENTS.md`; the third is new, and is the one that governs sign-in:

   | Where | How | Governs |
   |---|---|---|
   | `apps/web` on Netlify | Netlify UI env var | purchase receipts, invoices, refunds |
   | `apps/organizer` on Netlify | Netlify UI env var | bulk messages, invoice-paid receipts |
   | **Cloud Functions** | `npx firebase functions:secrets:set RESEND_API_KEY --project kgc-conference-app-and-website` | ⚠️ **the OTP sign-in code** |

   ```
   RESEND_API_KEY=re_…
   ```

   The functions one is a Secret Manager secret, not a Netlify variable, and
   setting the two websites does nothing for it. `requestOtp` already declares
   it (`OTP_REQUEST_CALLABLE` in `functions/src/runtime-options.ts`), so no code
   change is needed — but the callable must be redeployed after the secret
   exists for the runtime to mount it.

3. Optionally set `EMAIL_FROM` and `EMAIL_REPLY_TO` alongside it. They default
   to `KGC 2027 <tickets@knowledgegraph.tech>` and `hello@knowledgegraph.tech`.

**How to check it worked, without asking anyone for their code.** Every send
attempt writes one row to `emailLog`, and no row ever contains the code:

```
emailLog where template == "sign-in-code"
  status: "sent"    → delivered; providerId matches the Resend dashboard
  status: "skipped" → the key is not set on that deployment; nobody got a code
  status: "failed"  → Resend rejected it; `error` says why (usually the domain)
```

**Until the key exists**, `requestOtp` fails closed and says so: it sends
nothing, writes a `skipped` row naming the missing variable, and logs
`[requestOtp] RESEND_API_KEY is not set — no sign-in code was delivered to …`
against the function. It still answers `{ ok: true }`, and that is deliberate
rather than a cover-up — the response must not vary with anything about the
address, or "request a code" becomes a way to test whether somebody holds a
ticket.

**Cost: free at this scale.** Resend's free tier is 3,000 emails a month and
100 a day. A 500-person conference sends roughly one receipt and a handful of
sign-in codes per attendee. ⚠️ The daily 100 is the one to watch — the morning
of day one is when several hundred people sign in at once. If that is a real
risk, move to the paid tier before the doors open, not during.
