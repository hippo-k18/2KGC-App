# Things only you can do

Everything else in `BUILD-PLAN.md` proceeds without you. These do not, because
they need a console click, a credential, or an identity I do not hold.

Ordered by what unblocks the most.

---

## 1. ✅ DONE — the Storage bucket exists · 2026-09-01

★ **Completed and verified end to end.** The bucket
`kgc-conference-app-and-website.firebasestorage.app` exists,
`firebasestorage.googleapis.com` is `ENABLED`, and `storage.rules` is published
to it (release `firebase.storage/kgc-conference-app-and-website.firebasestorage.app`,
ruleset `e1acedfe`). Proven by an actual round trip, not by the console saying
so: a 70-byte PNG written with the Admin SDK, fetched anonymously through its
`?alt=media&token=` URL (200, `image/png`, 70 bytes), then deleted.

⚠️ One fix went in with it. `storage.rules` had match blocks for `avatars`,
`sessions`, `sponsors` and `exhibitors` but **not `speakers`**, which is the
third folder `uploads.ts` actually writes to. A client-SDK read of a speaker
portrait by path was denied while the identical sponsor read succeeded, and
nothing had noticed because every render goes through the token URL, which does
not evaluate the rules file at all. The block was added before first publish.

Nothing below in this section is outstanding; it is kept as the record of what
was done.

### The original instructions

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

## 3. ⚠️ STILL OUTSTANDING — the IAM grant did not land · retested 2026-09-01

★ **Reported as approved, and it is measurably not in effect.** Two independent
checks, both run after the storage half of the same approval had already
succeeded:

```
firebase deploy --only functions   → same ActAs error, unchanged
iam.serviceAccounts:testIamPermissions on
  kgc-conference-app-and-website@appspot.gserviceaccount.com
  asking for [actAs, get]          → 200 {}      ← empty: neither is held
```

An empty `testIamPermissions` response is the authoritative answer. It is not a
propagation delay and not a caching artefact: the identity holds *nothing* on
that service account, not even `get`.

### ⚠️ The most likely cause is the address

The Firebase CLI on this machine is authenticated as — confirmed by introspecting
the live token, not by reading a config file:

```
hartigandeely@gmail.com     (sub 112277041812908358571)
```

**Not** `hartigandeely456@gmail.com`, which is the address used elsewhere for
this project. A grant made to the `456` address would appear complete in the
console and do nothing for the CLI. That is the first thing to check.

### The other three things it could be

1. Granted on the **wrong service account** — `446276480921-compute@developer.gserviceaccount.com`
   is the other default and is easy to pick by mistake. It must be the
   **appspot** one.
2. Granted at **project** level rather than on the service account. That would
   also work, and it is not there: `getIamPolicy` on the project shows only
   `roles/firebase.admin` for this user, unchanged.
3. The console's **Save** was not committed on the Grant Access panel.

Nobody here can read the service account's own IAM policy to see who *was*
granted — `iam.serviceAccounts.getIamPolicy` is itself denied — so this has to
be checked from an Owner session.

### Everything else is ready and waiting

The functions are built, typechecked and green (**55 tests**, re-run
2026-09-01), and the cost guardrails in §5 are satisfied *in source*:
`maxInstances` is 10 by default, 1 on the serial fan-out and 3 on the OTP
callable, `minInstances` is 0 everywhere, and there is no `setGlobalOptions`
anywhere in `functions/src`. The deploy command is one line once the grant is
real.

---

## 3a. The original ask, unchanged

★ **Re-diagnosed 2026-08-31, and the answer changed.** Blaze is on, and turning
it on enabled every API a v2 function deploy needs. The `serviceusage` 403 this
section used to describe **is gone** — `firebase deploy --only functions` now
gets *past* the pre-flight and fails one layer later, on a single missing role.

Verified today against the live project, as `hartigandeely@gmail.com`:

```
Error: Missing permissions required for functions deploy. You must have
permission iam.serviceAccounts.ActAs on service account
kgc-conference-app-and-website@appspot.gserviceaccount.com.
```

The same command run with `GOOGLE_APPLICATION_CREDENTIALS` pointed at
`.secrets/service-account.json` fails identically, so this is not an
"use the other identity" problem. Both identities lack the one permission.

### Why it is only this

`serviceusage.services.list` returns **51 enabled APIs**, and all seven a v2
deploy touches are among them — `cloudfunctions`, `cloudbuild`,
`artifactregistry`, `eventarc`, `run`, `cloudtasks`, `pubsub`. Nothing needs
enabling. The previous entry here said "deploying a v2 function needs five APIs
*enabled*, which needs `serviceusage.services.enable` — the same 403, one layer
down". That was true on Spark. It is no longer true, and a `deploy-functions.mjs`
is still not the answer — but for the opposite reason. There is nothing left to
work around except the role.

### The current IAM policy, and why the grant lands on you

`cloudresourcemanager.projects.getIamPolicy` reports:

| Member | Role |
|---|---|
| `francois@knowledgegraph.tech` | `roles/owner` |
| `hdeschuyt@gmail.com` | `roles/editor` |
| `hartigandeely@gmail.com` | `roles/firebase.admin` |
| `firebase-adminsdk-fbsvc@…` | `roles/firebase.sdkAdminServiceAgent`, `roles/firebaseauth.admin`, `roles/iam.serviceAccountTokenCreator` |

`roles/firebase.admin` does **not** carry `iam.serviceAccounts.actAs`, and
`roles/editor` does. That is the whole difference. Granting it requires
`resourcemanager.projects.setIamPolicy`, which only `roles/owner` holds — so
this is François's click, not one that can be delegated to the signed-in
Firebase admin.

### The grant

Ask François for **exactly one role**, scoped as tightly as it will go — on the
service account, not on the project:

> On project `kgc-conference-app-and-website`, please grant
> `hartigandeely@gmail.com` the role **Service Account User**
> (`roles/iam.serviceAccountUser`) **on the service account**
> `kgc-conference-app-and-website@appspot.gserviceaccount.com`.

Console path: **IAM & Admin → Service Accounts →
`kgc-conference-app-and-website@appspot.gserviceaccount.com` → Permissions →
Grant access → Service Account User.**

⚠️ Granting `roles/iam.serviceAccountUser` at the **project** level instead
would work and is worse: it confers actAs over *every* service account in the
project, including `firebase-adminsdk-fbsvc`, which holds
`iam.serviceAccountTokenCreator` and can therefore mint tokens for anyone. Scope
it to the one App Engine default account.

### Then, and only then

Do §5's cost guardrails **first** — a budget alert notifies, a quota cap stops.
Then:

```bash
npm run test:functions          # 55 tests, on the emulator; green 2026-08-31
npm run build --workspace=functions
npx firebase deploy --only functions --project kgc-conference-app-and-website
```

`firebase` is not on `PATH`; it is `node_modules/.bin/firebase` (v15.27.0).

What this unblocks, verified against the screens that measure it: live poll
tallies and Q&A upvotes stop being frozen at whatever the seed wrote
(`engagement/live-polling` prints both numbers side by side today, and the gap
is the proof), reply counts and reaction counts start moving, the directory and
exhibitor-listing mirrors start maintaining themselves, and OTP sign-in becomes
possible once §6's Resend key exists.

---

## 3b. ✅ DONE — Cloud Storage for Firebase is enabled · 2026-09-01

`firebasestorage.googleapis.com` now reports `state: ENABLED` and the bucket
listing returns 200. Kept as the record; nothing here is outstanding. The
diagnosis below is what it looked like beforehand.

The bucket in §1 cannot be created by anyone but you, and the reason is one
layer earlier than that section assumes. Probed today:

```
GET firebasestorage.googleapis.com/v1beta/projects/…/buckets  →  403
"Cloud Storage for Firebase API has not been used in project
kgc-conference-app-and-website before or it is disabled."
```

`storage.googleapis.com`, `storage-api` and `storage-component` **are** enabled;
`firebasestorage.googleapis.com` is not. Enabling it needs
`serviceusage.services.enable`, which `roles/firebase.admin` does not carry —
attempting it as the signed-in user returns `403 Permission denied to enable
service [firebasestorage.googleapis.com]`.

The **Build → Storage → Get started** click in §1 performs this enablement as a
side effect, so if François does §1 there is nothing extra to do here. This
section exists so that the failure is recognisable if the click is delegated to
an account that cannot perform it — the console reports it as a generic error.

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
