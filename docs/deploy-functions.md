# Deploying the fourteen Cloud Functions

**Written 2026-08-30**, from `docs/audit-2026-08-30/F-blaze-infra.md`, as the
deliverable of BUILD-PLAN tasks 0.3 and 0.4. Nothing in this repo has been
deployed. No command in this file was run against the live project.

**Read this first.** It is ordered so that the things which *stop* spending come
before the things which *start* it. A budget alert emails you; it does not cap
anything. The steps that actually cap are 3 and 4. Do not reorder them, and do
not skip to Phase C because the deploy is the interesting part.

The project is `kgc-conference-app-and-website`. The `(default)` Firestore
database is in `nam5`, permanently. Every function deploys to `us-central1`,
which is inside `nam5`. **Do not deploy to another region** — it adds
cross-region latency to every Firestore read in every trigger and puts egress
charges on paths that are currently free.

---

## What you are deploying

Fourteen deployable units, not eight. Every doc in this repo that says "8
triggers" is counting the Firestore triggers only.

| # | Name | Kind | Fan-out risk |
|---|---|---|---|
| 1 | `onReplyWrite` | Firestore trigger | one counter write |
| 2 | `onReactionWrite` | Firestore trigger | one counter write |
| 3 | `onQuestionUpvoteWrite` | Firestore trigger | one counter write (chains to #5) |
| 4 | `onPollVoteWrite` | Firestore trigger | enqueues a task, writes nothing |
| 5 | `onQuestionWrite` | Firestore trigger | enqueues a task, writes nothing |
| 6 | `mirrorDirectory` | Firestore trigger | one document |
| 7 | `onAnnouncementCreate` | Firestore trigger | ~1 write per attendee |
| 8 | `onSessionAgendaChange` | Firestore trigger | ⚠️ **the big one** — see step 12 |
| 9 | `tallyPoll` | Cloud Tasks handler | bounded recompute |
| 10 | `rebuildQaBoard` | Cloud Tasks handler | bounded recompute |
| 11 | `requestOtp` | ⚠️ **public HTTPS callable** | 2 writes per call, unauthenticated |
| 12 | `verifyOtp` | ⚠️ **public HTTPS callable** | mints an Auth account, unauthenticated |

Each deploys as its own Cloud Run service with its own container image lineage
in Artifact Registry. Fourteen services, fourteen lineages. That is what step 13 is
about.

---

## Phase A — before you touch the billing plan

Steps 1 to 5 are all free and all reversible. None of them requires Blaze.

### 1. Diagnose the `serviceusage` 403 — read-only

This is the actual blocker and everything downstream hangs off it. All three
commands below only read.

```bash
gcloud projects get-iam-policy kgc-conference-app-and-website \
  --flatten="bindings[].members" \
  --filter="bindings.members:hartigandeely456@gmail.com" \
  --format="table(bindings.role)"

gcloud services list --enabled --project=kgc-conference-app-and-website

gcloud resource-manager org-policies list --project=kgc-conference-app-and-website
```

**What you expect:** `roles/owner` in the first output.

**Why it matters:** deploying a v2 function is not one API call a script can
substitute for. It requires five APIs to be *enabled on the project* —
`cloudfunctions.googleapis.com`, `cloudbuild.googleapis.com`,
`artifactregistry.googleapis.com`, `run.googleapis.com`,
`eventarc.googleapis.com`, plus `cloudtasks.googleapis.com` for #9 and #10 —
and enabling an API needs `serviceusage.services.enable`. That is the exact
permission being refused. **Writing a `deploy-functions.mjs` does not route
around this.** You would hit the same 403 one layer down, after building
several hundred lines of plumbing. The existing `.mjs` scripts work only
because the Rules and Firestore Admin APIs do not need that permission.

**If `roles/owner` is there and the 403 persists:**

```bash
firebase login --reauth
```

The refresh token that `scripts/ops/utoken.mjs` reads out of
`~/.config/configstore/firebase-tools.json` may predate a permission change.
If it still fails after a reauth, it is an org-policy constraint — the third
command above is what shows that.

**If `roles/owner` is not there:** grant it. That single change unblocks
`firebase deploy --only functions`.

### 2. Set a budget with alerts, on the billing account

GCP console → **Billing → Budgets & alerts → Create budget**.

- Scope: project `kgc-conference-app-and-website`
- Amount: **$1/month**
- Thresholds: 50% / 90% / 100% of **actual** spend
- Tick "send alert to billing admins"

> ⚠️ **A budget alert notifies. It does not cap.** It is a smoke detector, not
> a sprinkler. The next two steps are the sprinkler.

### 3. Set hard quota caps — these do stop things

GCP console → **IAM & Admin → Quotas & System Limits**. Filter by service,
select the quota, "Edit quotas", lower the limit.

| Service | Quota | Suggested |
|---|---|---|
| Cloud Firestore API | Write requests per day | `50,000` |
| Cloud Firestore API | Read requests per day | `200,000` |
| Cloud Run Admin API | Per-region instance limits | leave headroom above `maxInstances × 12` |

Set them deliberately low. **Hitting a quota cap is an outage; exceeding a
budget is a bill.** For a pre-production project you want the outage.

### 4. Cap Cloud Logging

Logging ingest above 50 GiB/month bills, and a fan-out accident or a retry
storm is exactly what produces that volume. This is the classic "a bug
generated a charge" line item.

GCP console → **Logging → Logs Storage**:

- Drop `_Default` bucket retention to **7 days**
- Add a **log exclusion** for `severity < WARNING` on the Cloud Run resource
  type, once you have confirmed the functions work (step 14) — not before, or
  you will be debugging the first deploy blind

Then add a second budget alert scoped to the Cloud Logging SKU specifically.

### 5. Register App Check — register only, do not enforce

Firebase console → **App Check**. Register the app. **Do not turn on
enforcement.**

Enforcement is step 16, and it is gated on something that does not exist yet.
See the note there before you enable anything.

---

## Phase B — upgrade, then verify the code caps

### 6. Upgrade the project to Blaze

Firebase console → the project → upgrade to **Blaze**. The upgrade flow offers
a budget amount; set it, and note it is the same notify-only mechanism as step
2, not a cap. Steps 3 and 4 are what cap.

### 7. Confirm the source is the hardened version

The runtime options, the OTP hardening and the `onSessionAgendaChange` debounce
were added in BUILD-PLAN tasks 0.3 / 0.4. Confirm they are present before
deploying, because the emulator does not enforce any of them and a stale branch
looks identical when it runs.

```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # only if you hit "Unable to locate a Java Runtime"

npm run typecheck --workspace=functions
npm run build --workspace=functions
npm run test:functions
```

Expect **55 tests across 11 files**, all passing. Then eyeball three things:

```bash
# Every function must carry runtime options. Expect exactly 14 files.
#
# NOTE: this pattern was wrong until 2026-08-31 and never printed the number
# it claimed. `request-otp.ts` carries OTP_REQUEST_CALLABLE, which the original
# three alternatives did not match, so the check silently under-counted. If you
# add a new options bundle, add it here too or this step goes quiet again.
grep -rln "TRIGGER\|SERIAL_FANOUT_TRIGGER\|PUBLIC_CALLABLE\|OTP_REQUEST_CALLABLE" functions/src --include='*.ts' \
  | grep -v runtime-options.ts | sort

# Must return NOTHING. Matches only a real call, not the two docblocks that
# warn against it — see the warning in functions/src/index.ts.
grep -rn "^[^*]*setGlobalOptions(" functions/src | grep -v '\*'

# minInstances must be 0 and explicit.
grep -n "minInstances" functions/src/runtime-options.ts
```

> ★ **Why `setGlobalOptions` must return nothing.** `functions/src/index.ts` is
> nothing but `export … from './triggers/….js'` statements. In ESM every
> imported module is fully evaluated *before* the importing module's body runs,
> so all fourteen functions are defined — and their endpoint metadata already
> computed — by the time any statement in that file executes. A
> `setGlobalOptions(...)` call placed there compiles, deploys, and caps
> **nothing**. You would ship believing instances were bounded when they were
> not, and find out on the bill. Options are set per function, in
> `functions/src/runtime-options.ts`, as an argument to the call that defines
> each endpoint. If someone "simplifies" that back to a global call, this is
> the paragraph they did not read.

Nothing in step 7 touches the live project.

### 8. Confirm the duplicate-push decision is in the tree

Deploying `onAnnouncementCreate` and `onSessionAgendaChange` next to
`apps/organizer/src/lib/push.ts` used to send **two notifications per device**
for the same event. One sender each was chosen in `functions/SPEC.md`
decision 11 and implemented. Verify it survived any merge:

```bash
# Must return NOTHING — the trigger no longer sends announcement push.
grep -n "getMessaging" functions/src/triggers/on-announcement-create.ts

# Must return NOTHING — the dashboard no longer sends room-change push.
grep -n "sendEachForMulticast" apps/organizer/src/lib/push.ts

# Must return exactly one match each — the surviving senders.
grep -n "getMessaging" functions/src/triggers/on-session-agenda-change.ts
grep -n "getMessaging().send(" apps/organizer/src/lib/push.ts
```

Ownership, for the record:

| Event | Sender | Why |
|---|---|---|
| Announcement | **dashboard** `announcementPush()` | one topic broadcast, not N multicasts; prefs honoured at subscribe time; announcements only ever originate there |
| Room / time / day / cancellation | **trigger** `onSessionAgendaChange` | fires on any write, including the CSV importer's and a script's |

If push ever moves back, delete the other sender **in the same commit**, never
in two.

### 8b. Set `RESEND_API_KEY` on the functions codebase

**Added 2026-08-31 with BUILD-PLAN task 1.2.** `requestOtp` now emails the
six-digit sign-in code through the shared sender in
`@kgc/scripts/src/lib/email.ts`, which reads `RESEND_API_KEY` from the
function's own environment. It used to print the code to this function's
console instead — a Cloud Functions log is not a delivery channel for a
credential, and step 4's log sink would have carried every attendee's code
into it.

Setting it on the two Netlify sites is **not** enough. Cloud Functions is a
third deployment with a third environment, and the failure mode if you skip it
is quiet from the outside and total from the attendee's: `requestOtp` still
returns `{ ok: true }` — it must, see the anti-enumeration note in that file —
and nobody ever receives a code.

```bash
# Firebase secrets, not a committed .env: the value is a credential.
npx firebase functions:secrets:set RESEND_API_KEY --project kgc-conference-app-and-website
```

`requestOtp` already declares it — `OTP_REQUEST_CALLABLE` in
`functions/src/runtime-options.ts` carries `secrets: ['RESEND_API_KEY']`, so no
code change is needed and the key is the only missing piece. Two consequences
worth knowing before they surprise you:

- **`firebase deploy` will stop and offer to create the secret** if you have not
  run the command above. Accept, or run it and retry. It is not an error in the
  deploy chain and does not mean step 1's 403 is back.
- **Locally the emulator prints a red 403 about the Secret Manager API** on
  every start, because the secret does not exist and that API is not enabled on
  this project. It is noise, not a failure: the emulator continues, the whole
  functions suite passes, and `RESEND_API_KEY` simply stays unset — which is
  what you want on a laptop that must never send real mail. Do not "fix" it by
  deleting the declaration.

**How to tell whether it took, without sending yourself a code:** the sender
records every attempt in `emailLog`, including the skips.

```
emailLog where template == "sign-in-code"
  status: "sent"    → delivered; providerId correlates with the Resend dashboard
  status: "skipped" → the key is not set on this deployment; nobody got a code
  status: "failed"  → Resend rejected it; `error` says why (usually an
                      unverified sending domain, which is a 403)
```

No row in that collection ever contains the code itself. If you find one that
does, that is a bug worth stopping for.

---

## Phase C — deploy

### 9. Deploy one function first

Do not push fourteen services as your first act on a newly-upgraded billing
account. Prove the whole chain — APIs enabled, Cloud Build succeeds, the image
lands, the Eventarc trigger is created — on the cheapest, most boring one:

```bash
npx firebase deploy --only functions:onReplyWrite --project kgc-conference-app-and-website
```

**Accept the Artifact Registry cleanup-policy prompt when the CLI offers it.**
If you miss it, step 13 sets it by hand.

If this fails on an API-not-enabled error, go back to step 1. That is the 403,
and it has not been fixed.

### 10. Deploy the rest

```bash
npx firebase deploy --only functions --project kgc-conference-app-and-website
```

### 11. Verify the caps in the Cloud Run console — not in the source

This is not optional and it is not a formality. It is the only way to know the
options landed, because the source can be right and the deploy still be wrong.

Cloud Run console → each of the fourteen services → the deployed revision:

| Service | max instances | min instances | concurrency |
|---|---:|---:|---:|
| `onreplywrite`, `onreactionwrite`, `onquestionupvotewrite`, `onpollvotewrite`, `onquestionwrite`, `mirrordirectory`, `onannouncementcreate`, `tallypoll`, `rebuildqaboard` | 10 | **0** | 80 |
| `onsessionagendachange` | **1** | **0** | **1** |
| `requestotp`, `verifyotp` | **3** | **0** | 80 |

**If any service shows min instances above 0, fix it immediately.** That is the
one setting that bills you per second for doing nothing, 24/7, whether or not a
request arrives.

### 12. Install the Firestore TTL policies

`otpCodes` and `rateLimits` both carry an `expiresAt` field that does
**nothing** until this step runs. Without it, both grow by one document per
distinct email and per distinct IP, forever — for endpoints whose entire threat
model is a caller generating distinct values.

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=otpCodes \
  --enable-ttl \
  --project=kgc-conference-app-and-website

gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits \
  --enable-ttl \
  --project=kgc-conference-app-and-website
```

Console equivalent: Firestore → **Time-to-live (TTL)** → Create policy →
collection group, field `expiresAt`.

Verify:

```bash
gcloud firestore fields ttls list --project=kgc-conference-app-and-website
```

> Deletion is not instant. Firestore sweeps TTL'd documents within about 24
> hours of expiry, which is fine here — nothing reads an expired code or an
> expired counter, the code checks `expiresAt` itself.

### 13. Set the Artifact Registry cleanup policy

This is the one line item that plausibly bills at idle, and it grows
monotonically with every redeploy. Fourteen images per deploy, retained forever;
ten redeploys is 120 image versions.

Artifact Registry console → repository **`gcf-artifacts`** → Edit → **Cleanup
policies**:

- Keep most-recent **2** versions
- Delete versions older than **1 day**

**Record the current repository size while you are there.** That number is what
tells you whether this is $0.00/month or $0.30/month. The free tier is 0.5 GB;
above it, roughly $0.10/GB/month. The true figure is genuinely uncertain from
the source — a Node 20 buildpack image is 100–300 MB uncompressed, Artifact
Registry bills on stored compressed bytes, and base layers dedupe across the
fourteen functions. Measure, do not estimate.

Also add a GCS lifecycle rule on the `gcf-v2-sources-…` staging bucket (delete
objects older than 30 days). It holds source zips, a few MB per deploy,
accumulating.

### 14. Smoke-test on live data — minimally

```
Post one community reply       → confirm communityPosts/{id}.replyCount moves
Upvote one question            → confirm upvoteCount moves, and qaBoard/current rebuilds
```

⚠️ **Do not create an announcement, and do not change a published session's
room, yet.** Those are the two paths that fan out. Test them at step 15, on
purpose, when you are watching.

### 15. Test the fan-out paths deliberately, once each

**One announcement.** Confirm exactly one notification lands in one attendee's
`users/{uid}/notifications` — and that only the dashboard sent push. If two
notifications arrive on a phone, step 8 did not survive; stop and fix it before
the conference.

**One published session's room change.** Confirm one `agenda-change`
notification per saver, and that the debounce holds: change the same session's
room again within two minutes and confirm **no second notification** appears.

**Then leave the fan-out alone.** Before any bulk agenda import, read the
warning in step 18.

### 16. App Check — read this before enforcing

**Do not enforce App Check on `requestOtp` / `verifyOtp` yet.** It would lock
out every real attendee while costing an attacker nothing.

The attendee app runs in **Expo Go**, which cannot attest. App Attest (iOS) and
Play Integrity (Android) need native modules only a development build carries,
and the JS SDK's reCAPTCHA providers need a browser DOM that React Native does
not have. There is no working App Check provider for this app today, which is
why `enforceAppCheck: false` is stated explicitly in
`functions/src/runtime-options.ts` rather than left unset — it is a dated
decision, not a missing option.

**Enforce it when, and only when, all three are true:**

1. A development build of the app exists (push and image upload both need one
   anyway — build once, not three times)
2. `@react-native-firebase/app-check` is installed and configured with App
   Attest and Play Integrity
3. A real device has been observed obtaining a token against the live project

Then: Firebase console → App Check → APIs → Cloud Functions → **Enforce**, and
flip `enforceAppCheck: true` in `runtime-options.ts` and redeploy the two
callables. Until then the per-IP and per-email rate limits plus
`maxInstances: 3` are what bound the cost, and they are deliberately generous
because a conference venue is behind NAT.

### 17. Watch the bill

Billing → Reports, grouped by SKU, at **24 hours, 7 days and 30 days** after
the first deploy.

The only line you expect to be non-zero is **Artifact Registry Storage**. If
anything else is non-zero, something in this runbook was wrong and it is worth
finding out which thing before the conference rather than during it.

---

## Phase D — Storage (independent of Phase C, can be done first)

The default bucket **does not exist** — verified, not assumed. Both
`kgc-conference-app-and-website.firebasestorage.app` and `…appspot.com` return
`404 The specified bucket does not exist` from the anonymous GCS JSON API. (An
existing private bucket returns 403, not 404.) The
`EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` value in `app/.env.local` is the config
string the console hands out, not evidence anything was provisioned.

### 18. Provision the default bucket

Firebase console → Build → Storage → Get started → **`us-central1`**. The
location is **permanent** and `us-central1` matches `nam5`. Then re-run the
probe and confirm it now returns 403 rather than 404:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://storage.googleapis.com/storage/v1/b/kgc-conference-app-and-website.firebasestorage.app
```

### 19. Publish the storage rules

No new script is needed. `scripts/ops/deploy-rules.mjs` already takes the
release name as its second argument — `ROADMAP.md:313` says this "needs a
second release target", which is wrong; it needs a second *argument*.

```bash
GOOGLE_APPLICATION_CREDENTIALS=.secrets/service-account.json \
node scripts/ops/deploy-rules.mjs \
  storage.rules \
  firebase.storage/kgc-conference-app-and-website.firebasestorage.app
```

Expect "uploaded ruleset …" then "created release firebase.storage/…". Note the
two-identity requirement: the service account uploads the ruleset, the
signed-in human publishes the release — so `firebase login` must be current.
Run this only after step 18; a release cannot point at a bucket that does not
exist.

---

## ⚠️ The bulk agenda import

Read this before running the CSV importer, or any script, against a live
agenda with `onSessionAgendaChange` deployed.

Re-importing an agenda where rooms or times differ updates many published
sessions at once. Each update independently runs a collection-group query,
writes one notification per saver, reads each saver's `fcmTokens` subcollection
and fires an FCM multicast. At KGC scale — 200 sessions changed, 500 attendees,
20 saved sessions each — that is roughly **100,000 notification writes and
100,000 real push notifications to real phones**.

The money is tens of cents. The 100,000 pushes are not recoverable, and being
blasted about other people's sessions is the single most-cited complaint about
the incumbent product.

Three things stand in the way, all now in the code:

1. **`maxInstances: 1, concurrency: 1`** on that function — the fan-out
   serialises instead of landing in ten seconds, so a human has time to notice
2. **The debounce** — a repeated change to the *same* session inside two
   minutes is dropped unless it says something new
3. **The circuit breaker** — past **20 distinct sessions** notified inside a
   rolling 10-minute window the fan-out stops and logs `console.error`

The breaker is the one that matters for an import, because a bulk import
changes 200 *different* sessions and the debounce does not see that shape.
Its log line is greppable:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND textPayload:"FAN-OUT SUPPRESSED"' \
  --project=kgc-conference-app-and-website --limit=20 --freshness=1d
```

**If you see that line, the right response is one announcement to the event,
not one push per attendee per session.** Do not raise
`FANOUT_MAX_SESSIONS` to "let the import through".

Note that the Admin SDK bypasses security rules, so a rules-based guard would
not have worked. This had to be in the function.

---

## Do not do

- **Do not set `minInstances > 0` on anything.** It bills per idle second,
  24/7. It is currently 0 and explicit. Somebody "fixing cold starts" later is
  the realistic way this changes.
- **Do not use `setGlobalOptions` in `functions/src/index.ts`.** It silently
  does nothing there. See step 7.
- **Do not deploy to a region other than `us-central1`.**
- **Do not create a second Storage bucket.** The no-cost tier is
  default-bucket-only; a second bucket bills from the first byte.
- **Do not serve video or large downloads from Storage.** Egress is the
  fastest route to a real bill in this whole project. Keep the documents screen
  link-based, as it is today.
- **Do not add a Firestore trigger on `directory/{uid}` that writes back to
  `users/{uid}`.** `mirrorDirectory` writes `directory/{uid}` on every write to
  `users/{uid}`; the reverse trigger closes an unbounded loop between two
  documents, billing every hop, with no stopping point. `directory/{uid}` is
  still client-writable, so this is a live hazard, not a hypothetical. Nothing
  guards against it — exact-path matching is the only reason none of the
  existing functions can loop.
- **Do not run a bulk agenda import against a live event** without reading the
  section above.
- **Do not install a Firebase Extension "just to try it".** Each one is another
  Cloud Function, another image, another Artifact Registry lineage.
- **Do not treat the budget alert as a spending cap.** It emails you.
- **Do not verify the instance caps by reading the source.** Cloud Run console,
  step 11.

---

## If something is already costing money

1. Billing → Reports, group by SKU. Identify the line.
2. If it is a function: Cloud Run console → the service → **set max instances
   to 0**. That stops it immediately without deleting anything, and is
   reversible in one click.
3. If it is Firestore reads/writes: the quota caps from step 3 are the
   emergency brake. Lower them further.
4. If it is Logging: add the exclusion from step 4, and find what is producing
   the volume before raising anything back.
5. `onSessionAgendaChange` and the two OTP callables are the three most likely
   culprits, in that order.
