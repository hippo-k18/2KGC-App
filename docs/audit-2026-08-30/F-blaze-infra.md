# F — Blaze infrastructure audit

**Date:** 2026-08-30
**Scope:** Cloud Functions, deployment path under the `serviceusage` 403, Cloud
Storage / file upload, push notifications, and a cost-safety checklist for
enabling Blaze without spending money.
**Method:** read-only. No file outside this one was written, nothing was
deployed, and no state-changing API was called. Two unauthenticated `GET`s
against `storage.googleapis.com` were used to establish whether the default
bucket exists (see §3).

**Hard constraint assumed throughout: do not spend money.** Where I am not
certain whether something bills, I say so and give the exact place to check.

---

## Headline findings

1. **It is not 8 functions, it is 12.** `functions/src/index.ts:24-35` exports
   twelve deployable units: 8 Firestore triggers, 2 Cloud Tasks handlers, 2
   HTTPS callables. Every doc in the repo says "8 triggers" (`AGENTS.md:86`,
   `BACKEND-ROADMAP.md:20`, `ROADMAP.md`) and that is true of the *Firestore
   triggers* only. Deploy cost, image count and attack surface are all sized on
   12.
2. **No function anywhere sets a single runtime option.** `grep` for
   `setGlobalOptions|region|maxInstances|minInstances|memory|concurrency` across
   `functions/src/` returns nothing but the word "region" in prose. Every
   function will deploy on platform defaults.
3. **The two HTTPS callables are unauthenticated public endpoints and are the
   only real money risk here.** `requestOtp`
   (`functions/src/callable/request-otp.ts:47`) writes 2 Firestore documents per
   call, is rate-limited *per email address* (5/hour), has no App Check, no
   CAPTCHA, and no `maxInstances`. Cycling email addresses defeats the rate
   limit entirely. This is the one path that can turn a script kiddie into a
   bill.
4. **No trigger can loop infinitely.** I traced every write. The worst case is a
   bounded 2-hop chain (§1.4). But there is a large *fan-out* accident available
   via `onSessionAgendaChange` — an agenda re-import (§1.5).
5. **The default Cloud Storage bucket does not exist.** Verified, not assumed —
   both `kgc-conference-app-and-website.firebasestorage.app` and
   `…appspot.com` return `404 The specified bucket does not exist` from the
   anonymous GCS JSON API. (An existing private bucket returns 403, not 404.)
   Nothing about upload works today, and Storage rules cannot be published to a
   release target that has no bucket.
6. **`scripts/ops/deploy-rules.mjs` already handles storage rules.** It takes
   `[sourcePath, releaseName]` on argv (`scripts/ops/deploy-rules.mjs:14`) and
   only *defaults* to `cloud.firestore`. `ROADMAP.md:313` says "pushing storage
   rules needs a second release target" — correct, but it needs an argument, not
   a second script.
7. **There is no ops script for functions, and writing one may not be the
   blocker.** The `serviceusage` 403 is about *enabling APIs*, and deploying a
   v2 function requires five APIs enabled. See §2 — my recommendation is to fix
   the IAM grant rather than route around it.
8. **Artifact Registry storage is the one line item that plausibly bills at
   idle**, and it grows with every redeploy. §2.4.
9. **Once functions deploy, announcements and room changes will send push
   twice.** `apps/organizer/src/lib/push.ts` already sends from the dashboard;
   `onAnnouncementCreate` and `onSessionAgendaChange` will send again. §4.4.

---

## 1. Cloud Functions

### 1.1 Generation, runtime, region

| Property | Value | Where |
|---|---|---|
| Generation | **v2 (2nd gen)** — every import is `firebase-functions/v2/*` | `functions/src/triggers/*.ts`, `functions/src/callable/*.ts` |
| SDK | `firebase-functions ^6.4.0`, `firebase-admin ^13.6.0` | `functions/package.json:14-15` |
| Node runtime | **20** | `functions/package.json:6-8` (`"engines": {"node":"20"}`) |
| Module format | ESM, esbuild-bundled to `lib/index.js` | `functions/package.json:4,10` |
| Region | **not set → defaults to `us-central1`** | no `region` anywhere in `functions/src/` |
| Memory | **not set → 256 MiB (v2 default)** | — |
| Timeout | **not set → 60 s (v2 default)** | — |
| `minInstances` | **not set → 0** ✅ this is the one that matters, and it is already right | — |
| `maxInstances` | **not set** → platform default (believed 100 for gen2/Cloud Run — verify in the Cloud Run console after the first deploy) | — |
| Concurrency | **not set** → gen2 default 80 requests/instance | — |
| Retry (Firestore triggers) | not set → `false` (v2 default). Good: a thrown error does not retry-storm. | — |
| Retry (task handlers) | `maxAttempts: 3`, explicitly | `tally-poll.ts:27`, `rebuild-qa-board.ts:28` |
| Task queue rate limits | **not set** → Cloud Tasks defaults (500 dispatches/s, 1000 concurrent) | — |

`us-central1` is inside `nam5`, the (permanent) location of the `(default)`
Firestore database (`AGENTS.md:562-563`). **Leave it there.** Choosing a
European or Asian region would add cross-region latency on every Firestore read
in every trigger and would put network egress charges on paths that are
currently free. The default is also the cost-optimal choice here.

### 1.2 The 8 Firestore triggers

| # | Name | Type | Path | Writes | File |
|---|---|---|---|---|---|
| 1 | `onReplyWrite` | `onDocumentWritten` | `communityPosts/{postId}/replies/{replyId}` | `communityPosts/{postId}.replyCount` (`FieldValue.increment(±1)`) | `functions/src/triggers/on-reply-write.ts:15-29` |
| 2 | `onReactionWrite` | `onDocumentWritten` | `communityPosts/{postId}/reactions/{uid}` | `communityPosts/{postId}.reactionCount` (±1) | `functions/src/triggers/on-reaction-write.ts:13-27` |
| 3 | `onQuestionUpvoteWrite` | `onDocumentWritten` | `sessions/{sid}/questions/{qid}/upvotes/{uid}` | `sessions/{sid}/questions/{qid}.upvoteCount` (±1) | `functions/src/triggers/on-question-upvote-write.ts:15-31` |
| 4 | `onPollVoteWrite` | `onDocumentWritten` | `sessions/{sid}/polls/{pid}/votes/{uid}` | **nothing in Firestore** — enqueues a `tallyPoll` Cloud Task with a hashed 5 s-bucketed id | `functions/src/triggers/on-poll-vote-write.ts:29-44` |
| 5 | `onQuestionWrite` | `onDocumentWritten` | `sessions/{sid}/questions/{qid}` | **nothing in Firestore** — enqueues a `rebuildQaBoard` task, same debounce | `functions/src/triggers/on-question-write.ts:23-50` |
| 6 | `mirrorDirectory` | `onDocumentWritten` | `users/{uid}` | `directory/{uid}` — `set()` if `visibleInDirectory`, `delete()` otherwise | `functions/src/triggers/mirror-directory.ts:59-87` |
| 7 | `onAnnouncementCreate` | `onDocumentCreated` | `announcements/{announcementId}` | `users/{uid}/notifications/{announcementId}` for every user in the event with `notificationPrefs.announcements == true`, batched at 500; then FCM multicast if `push == true` | `functions/src/triggers/on-announcement-create.ts:31-79` |
| 8 | `onSessionAgendaChange` | `onDocumentUpdated` | `sessions/{sessionId}` | `users/{uid}/notifications/{event.id}` for every attendee with the session in `savedSessions` (collection-group query), batched at 500; then FCM multicast | `functions/src/triggers/on-session-agenda-change.ts:44-111` |

### 1.3 The other 4 deployable units (not "triggers", but they deploy and they bill)

| # | Name | Type | Writes | File |
|---|---|---|---|---|
| 9 | `tallyPoll` | `onTaskDispatched` (Cloud Tasks) | `sessions/{sid}/polls/{pid}.{tallies,totalVotes,talliesUpdatedAt}` — full recompute from `votes/` | `functions/src/triggers/tally-poll.ts:26-57` |
| 10 | `rebuildQaBoard` | `onTaskDispatched` | `sessions/{sid}/qaBoard/current.{questions[],rebuiltAt}`, capped at 50 | `functions/src/triggers/rebuild-qa-board.ts:27-58` |
| 11 | `requestOtp` | `onCall` — **public HTTPS** | `otpCodes/{id}`, `rateLimits/{id}` | `functions/src/callable/request-otp.ts:47` |
| 12 | `verifyOtp` | `onCall` — **public HTTPS** | `otpCodes/{id}.attempts` / delete; creates an Auth account; mints custom claims; returns a custom token | `functions/src/callable/verify-otp.ts:112` |

Each of these deploys as its own Cloud Run service with its own container image.
Twelve services, twelve image lineages in Artifact Registry.

### 1.4 Runaway / loop analysis — **no infinite loop exists**

I traced every write against every trigger path. Firestore v2 triggers match an
*exact* path pattern, so a write to `users/{uid}/notifications/{id}` does **not**
re-fire a trigger registered on `users/{uid}`. That property is what saves this
design.

| Writer | Writes to | Re-triggers? | Verdict |
|---|---|---|---|
| `onReplyWrite` | `communityPosts/{postId}` | no trigger on that path | terminates |
| `onReactionWrite` | `communityPosts/{postId}` | no trigger | terminates |
| `onQuestionUpvoteWrite` | `sessions/{sid}/questions/{qid}` | **yes → `onQuestionWrite` (#5)** | 2-hop chain, see below |
| `onQuestionWrite` | nothing (enqueue only) | — | terminates |
| `onPollVoteWrite` | nothing (enqueue only) | — | terminates |
| `tallyPoll` | `sessions/{sid}/polls/{pid}` | no trigger (only `…/votes/{uid}` is watched) | terminates |
| `rebuildQaBoard` | `sessions/{sid}/qaBoard/current` | no trigger | terminates |
| `mirrorDirectory` | `directory/{uid}` | no trigger on `directory` | terminates |
| `onAnnouncementCreate` | `users/{uid}/notifications/{id}` | no trigger (subcollection ≠ `users/{uid}`) | terminates |
| `onSessionAgendaChange` | `users/{uid}/notifications/{id}` | no trigger | terminates |

**The one chain:** an upvote fires `onQuestionUpvoteWrite`, which increments
`upvoteCount` on the parent question, which fires `onQuestionWrite`
(`on-question-write.ts:35` treats an `upvoteCount` change as relevant —
deliberately, per its own docblock at lines 16-18), which enqueues a Cloud Task,
which runs `rebuildQaBoard`, which writes `qaBoard/current`. Chain length 3,
guaranteed to terminate. Amplification: **1 attendee upvote ⇒ 3 function
invocations + 1 Cloud Task + ~N question reads + 2 Firestore writes.** That is
the correct design (it is why the debounce exists), but it means a live keynote
Q&A with a few hundred people upvoting produces roughly 3× the invocations you
would estimate from user actions alone. Still nowhere near any free-tier ceiling.

**Two latent loop hazards to write down before someone trips them later:**

- `directory/{uid}` is *still client-writable* — a deliberate dual-write shim
  (`functions/SPEC.md:24`, Phase 0 decision 2 at `SPEC.md:41-44`). If anyone
  ever adds a trigger on `directory/{uid}` that writes back to `users/{uid}`,
  that is an instant unbounded loop between the two documents. There is no
  guard, only the absence of the second trigger.
- `announcements` is client-writable by an organizer-claimed account
  (`firestore.rules:511-514`, `allow write: if isOrganizer()`), not
  Admin-SDK-only. Each create fans out to every attendee. A loop in dashboard
  code that creates announcements would be expensive.

### 1.5 The genuine fan-out risk: `onSessionAgendaChange` + a bulk agenda import

`onSessionAgendaChange` is deliberately **not** debounced
(`functions/SPEC.md:212-215` records that as a decision) and notifies
**unconditionally** — there is no preference gate (`on-session-agenda-change.ts:33-35`).

The accident: the CSV agenda importer exists and is used
(`scripts/src/import-whova.ts`, and the organizer's CSV import path). Re-importing
an agenda where room or time fields differ updates many published sessions at
once. Each update independently runs a collection-group query, writes one
notification per saver, reads each saver's `fcmTokens` subcollection, and fires
an FCM multicast.

Rough worst case at KGC scale — 200 published sessions changed, 500 attendees,
each attendee saving 20 sessions:

- ~200 invocations
- ~200 collection-group queries
- ~100,000 notification writes
- ~100,000 subcollection reads for tokens
- ~100,000 push notifications to real phones

The Firestore free tier is 20,000 writes/day. 100,000 writes is ~80,000 billable —
on the order of tens of cents on `nam5`. **The money is trivial; the 100,000
unwanted push notifications are not.** Whova's most-cited complaint, per
`apps/organizer/src/lib/push.ts:199-201`, is exactly this.

**Mitigation is not a runtime option, it is a guard:** before the first bulk
import against a live event, either (a) set `maxInstances: 1` on this function
so the fan-out serialises and can be caught, or (b) add a kill-switch document
the function reads first, or (c) never run an import against a live agenda
without checking. Options (a) and (c) are free and available today. Note that
the Admin SDK bypasses rules, so a rules-based guard will not work.

### 1.6 Cost at KGC scale — a few hundred attendees

Compute is effectively free. Gen2 functions run on Cloud Run and draw on Cloud
Run's monthly free tier (≈2M requests, 360,000 GiB-s, 180,000 vCPU-s). At
256 MiB × 1 vCPU, a 200 ms invocation consumes ~0.05 GiB-s and ~0.2 vCPU-s.
Reaching 180,000 vCPU-s needs ~900,000 invocations/month. A 500-person, 3-day
conference will not produce 900,000 function invocations even with the Q&A
amplification in §1.4.

Realistic conference-weekend totals: low tens of thousands of invocations, low
hundreds of thousands of Firestore ops. **Under free tier on every axis except
the two below.**

The two things that are *not* zero:

1. **Artifact Registry storage** (see §2.4) — cents per month, but non-zero from
   the moment the first deploy lands, and growing with every redeploy.
2. **Cloud Logging above 50 GiB/month ingest.** Normal operation is far below
   this. A fan-out accident or a retry storm is what puts you near it. Logging
   is the sneaky bill in every "a bug generated a charge" story.

### 1.7 Missing caps — what is not set that should be

Nothing is set. Specifically absent from all of `functions/src/`:

- no `setGlobalOptions(...)` call anywhere
- no `maxInstances` on any of the 12
- no `concurrency` override
- no `memory` / `timeoutSeconds` override
- no `rateLimits` on either Cloud Tasks queue (`tally-poll.ts:27`,
  `rebuild-qa-board.ts:28` set `retryConfig` only)
- no App Check enforcement on either public callable

`minInstances` is unset, which means 0, which is correct — that is the option
that would bill you for idle capacity, and it is already right by omission.

### 1.8 Minimum-cost deploy configuration

Recommended (this is a source change, outside my write scope — recorded here for
whoever makes it):

```ts
// Per-function, not global. See the ESM gotcha below.
const BASE = {
  region: 'us-central1',   // matches nam5 — do not change
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  minInstances: 0,         // explicit, so nobody "optimises" cold starts later
  maxInstances: 10,        // the 8 triggers + 2 task handlers
  concurrency: 80,
};

// The two public callables get a tighter cap, because they are the internet-
// facing ones and the only path an attacker can reach directly.
const PUBLIC = { ...BASE, maxInstances: 3 };
```

Task queues additionally want a dispatch cap:

```ts
onTaskDispatched<T>({
  retryConfig: { maxAttempts: 3 },
  rateLimits: { maxConcurrentDispatches: 5, maxDispatchesPerSecond: 10 },
}, handler)
```

> ⚠️ **ESM ordering gotcha — do not use `setGlobalOptions` in `index.ts`.**
> `functions/src/index.ts:24-35` is nothing but `export … from './triggers/….js'`
> statements. In ESM, imported modules are fully evaluated *before* the importing
> module's body runs. By the time any statement in `index.ts`'s body executes,
> all twelve functions have already been defined and their endpoint metadata
> already computed. A `setGlobalOptions(...)` call placed in that body would
> silently do nothing — you would deploy believing you had capped instances when
> you had not, which is the exact defect class `AGENTS.md:592-598` warns about.
> Either set options **per function** (recommended: explicit, and lets the
> callables differ), or put `setGlobalOptions` in its own module and make
> `import './runtime-options.js';` the **first** line of `index.ts`, above the
> re-exports. If you take the global route, verify it landed by checking the
> deployed Cloud Run service's max-instances in the console — not by reading the
> source.

`initializeApp()` at `functions/src/index.ts:18-22` is unaffected by this,
because every handler calls `getFirestore()` lazily at request time, not at
module load.

---

## 2. How to actually deploy them, given the `serviceusage` 403

### 2.1 What the existing ops scripts do

| Script | API called | Auth identity | Notes |
|---|---|---|---|
| `scripts/ops/deploy-rules.mjs` | `firebaserules.googleapis.com/v1` — `POST …/rulesets` then `PATCH`/`POST …/releases/{name}` | **two identities**: service account uploads the ruleset (`deploy-rules.mjs:22,43`), signed-in human publishes the release (`deploy-rules.mjs:23-24`) | Takes `[sourcePath, releaseName]` on argv, defaulting to `firestore.rules` / `cloud.firestore` (`deploy-rules.mjs:14`) |
| `scripts/ops/deploy-indexes.mjs` | `firestore.googleapis.com/v1` — `POST …/indexes`, `PATCH …/fields?updateMask=indexConfig` | human token only (`deploy-indexes.mjs:20`) | `--wait` polls to READY (`deploy-indexes.mjs:91-102`) |
| `scripts/ops/gtoken.mjs` | mints an SA access token from `GOOGLE_APPLICATION_CREDENTIALS` | — | docblock at lines 3-9 states the 403 precisely |
| `scripts/ops/utoken.mjs` | refreshes the human's token from `~/.config/configstore/firebase-tools.json` | — | needs a prior `firebase login` |
| `scripts/ops/reset-demo-sales.mjs` | Admin SDK — demo cleanup, unrelated to deployment | — | — |

**There is no ops script for functions.** Root `package.json:13` still defines
`deploy:rules` as `firebase deploy --only firestore:rules,firestore:indexes,storage`,
which is the CLI and therefore 403s. That npm script is stale and misleading —
the real path is the two `.mjs` files.

### 2.2 Does the 403 also block Cloud Functions?

**Probably yes, and more fundamentally than it blocks rules.** Here is the
distinction that matters:

- The `firebase` CLI 403 is a **pre-flight**. `gtoken.mjs:5-9` records it
  exactly: the CLI calls `serviceusage.googleapis.com` before every deploy, and
  neither identity holds `serviceusage.services.use`. The *underlying* Rules and
  Firestore Admin APIs do not need that permission, which is why the two `.mjs`
  scripts work.
- Deploying a v2 function is **not** one API call that a script can substitute
  for. It requires five APIs to be **enabled on the project**:
  `cloudfunctions.googleapis.com`, `cloudbuild.googleapis.com`,
  `artifactregistry.googleapis.com`, `run.googleapis.com`,
  `eventarc.googleapis.com` (plus `cloudtasks.googleapis.com` for #9/#10).
  Enabling an API requires `serviceusage.services.enable` — which is the same
  permission family that is being refused.

So the failure is not "the CLI is fussy". It is "this identity cannot turn on
the services a function needs". **Writing a `deploy-functions.mjs` will not fix
that.** You would hit the same 403 one layer down, and only after building the
plumbing.

`serviceusage.services.enable` is included in `roles/owner` and `roles/editor`.
`AGENTS.md:566-568` says the signed-in *owner* does not hold it, which is
unusual and points at either an org policy constraint, a custom role, or the
account not actually holding `roles/owner` on this project. **That is the thing
to diagnose first**, and it is diagnosable read-only:

```bash
# read-only — no state change
gcloud projects get-iam-policy kgc-conference-app-and-website \
  --flatten="bindings[].members" \
  --filter="bindings.members:hartigandeely456@gmail.com" \
  --format="table(bindings.role)"

gcloud services list --enabled --project=kgc-conference-app-and-website
gcloud resource-manager org-policies list --project=kgc-conference-app-and-website
```

If the account genuinely holds `roles/owner` and the 403 persists, it is an
org-policy or a stale credential (`firebase login --reauth` refreshes the token
`utoken.mjs` reads).

### 2.3 If the 403 is fixed, what does a functions deploy actually need?

Once the APIs are enabled, `firebase deploy --only functions` works normally
and is by far the right tool — the CLI handles source packaging, the staging
upload, Eventarc trigger creation, the Cloud Tasks queue provisioning for
`onTaskDispatched`, and (importantly) it prompts to set an Artifact Registry
cleanup policy.

If you must avoid the CLI entirely, a `deploy-functions.mjs` would need to,
per function, per region:

1. `POST cloudfunctions.googleapis.com/v2/projects/{p}/locations/us-central1/functions:generateUploadUrl`
2. `PUT` the source zip to the returned signed URL (lands in a
   `gcf-v2-sources-{projectNumber}-us-central1` GCS bucket the platform creates)
3. `POST …/functions?functionId={name}` with `buildConfig` (runtime `nodejs20`,
   entryPoint) + `serviceConfig` (memory, maxInstances, minInstances) +
   `eventTrigger` (`eventType`, `eventFilters` for the document path,
   `triggerRegion`, `retryPolicy`)
4. poll the returned LRO
5. separately create/patch the Cloud Tasks queues for `tallyPoll` /
   `rebuildQaBoard`, which the CLI otherwise does for you

That is a meaningful amount of code (several hundred lines) to reproduce
something the CLI already does, it still needs the APIs enabled, and getting the
`eventFilters` wrong produces a function that deploys and never fires.
**Recommendation: fix the IAM grant, use the CLI for functions, keep the `.mjs`
scripts for rules and indexes.**

### 2.4 Do Artifact Registry and Cloud Build bill?

**Cloud Build — has a free tier, almost certainly free here.** Google's free
tier is on the order of 2,500 build-minutes/month on the default pool (older
documentation said 120 build-minutes/day; either framing covers this). A gen2
Node 20 function builds in roughly 1–3 minutes. Twelve functions is ~15–35
build-minutes per full deploy. You would need dozens of full redeploys per
month to approach the ceiling. **Verify the current figure at
`https://cloud.google.com/build/pricing` before the first deploy** — this
number has changed before.

**Artifact Registry — bills above 0.5 GB, and this is the one to watch.** Every
deployed v2 function stores a container image in a `gcf-artifacts` repository in
your project. Free tier is 0.5 GB of storage; above that it is on the order of
$0.10/GB/month in US regions.

Honest uncertainty: I cannot tell you the total from the repo. A Node 20
buildpack image is roughly 100–300 MB uncompressed, but Artifact Registry bills
on stored compressed bytes and the base layers **dedupe across the twelve
functions** in the same repository. So the true figure could be anywhere from
comfortably under 0.5 GB to a few GB. **Measure it after the first deploy** —
Artifact Registry console → `gcf-artifacts` repo → the size column — rather than
trusting an estimate.

What is not uncertain: **it grows monotonically with redeploys** unless you stop
it. Every deploy creates a new image version and the old ones are retained. Ten
redeploys of twelve functions is 120 image versions. This is how a $0.00
project quietly becomes a $0.40/month project and then a $3/month project.

**Mitigation, and do it on day one:** set a cleanup policy on the
`gcf-artifacts` Artifact Registry repository — keep the most recent 1–2
versions, delete anything older than ~1 day. The Firebase CLI offers to do this
interactively on first deploy; if you deploy another way, set it in the Artifact
Registry console (Repositories → `gcf-artifacts` → Edit → Cleanup policies) or
via the Artifact Registry API. There is also a small GCS staging bucket
(`gcf-v2-sources-…`) holding source zips — a few MB, inside the GCS free tier,
but worth a lifecycle rule for the same reason.

**Eventarc** sits between Firestore and each v2 trigger. Google-source event
delivery is free or effectively free at published thresholds far above anything
this event will generate (thousands of events/month). I am not fully certain of
the current pricing structure — verify at
`https://cloud.google.com/eventarc/pricing` — but at this scale it rounds to
zero under any reading.

**Cloud Tasks** free tier is 1M operations/month. `onPollVoteWrite` and
`onQuestionWrite` enqueue at most one task per 5 s bucket per poll/session. Not
close.

---

## 3. Cloud Storage / file upload

### 3.1 Current state

- `storage.rules` exists (30 lines) and is coherent: `avatars/{uid}/{fileName}`
  is writable by the owning signed-in user, capped at 5 MB, `image/*` only
  (`storage.rules:11-17`); `sessions/**` and `sponsors/**` are `allow write: if
  false` (`storage.rules:20-28`).
- **The rules are not published.** `ROADMAP.md:310-313` says so, and
  `AGENTS.md:73-79` confirms only Firestore rules and indexes are live.
- **No writer exists anywhere.** `app/src/lib/firebase/client.ts:198-200`
  exports `getFirebaseStorage()` and — verified by grep across `app/src`,
  `apps/web/src`, `apps/organizer/src` — **nothing calls it**. There is no
  `uploadBytes`, no `getDownloadURL`, no `ref()` in the codebase.
- The app has **no image picker**: `app/package.json` has no
  `expo-image-picker` and no `expo-camera`. The dashboard says so in its own
  words (`apps/organizer/src/app/(dash)/engagement/photos/photo-collection/page.tsx:145`).
- **The default bucket does not exist.** Verified with two unauthenticated GETs
  (an existing private bucket returns 403; a non-existent one returns 404):

  ```
  GET https://storage.googleapis.com/storage/v1/b/kgc-conference-app-and-website.firebasestorage.app
    → 404 "The specified bucket does not exist."
  GET https://storage.googleapis.com/storage/v1/b/kgc-conference-app-and-website.appspot.com
    → 404 "The specified bucket does not exist."
  ```

  `app/.env.local` already carries
  `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=kgc-conference-app-and-website.firebasestorage.app`
  — that is the SDK config value the console hands out, **not** evidence the
  bucket was provisioned. It was not.

### 3.2 What is needed for upload to work — four things, in order

1. **Provision the default bucket.** Firebase console → Build → Storage → Get
   started. **Choose `us-central1`.** The location is *permanent*, and
   `us-central1` matches `nam5` (no cross-region reads from the dashboard's
   Admin SDK) and is a free-tier-eligible region.

   > ⚠️ Uncertainty worth stating plainly: since October 2024 the default bucket
   > for new Firebase projects lives on the `firebasestorage.app` domain, and at
   > announcement time provisioning it required the Blaze plan. Firebase has
   > adjusted that policy at least once since. Since you are moving to Blaze
   > anyway, the question is moot for you — but do not read "Storage works on
   > Spark" (`AGENTS.md:606`) as "you could have had a bucket on Spark". You
   > could not, on this project: it has none.

2. **Publish `storage.rules`.** This needs **no new script**.
   `scripts/ops/deploy-rules.mjs:14` already accepts the release name on argv:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=.secrets/service-account.json \
   node scripts/ops/deploy-rules.mjs \
     storage.rules \
     firebase.storage/kgc-conference-app-and-website.firebasestorage.app
   ```

   The release-name format for Storage is `firebase.storage/{bucket}`. This
   corrects `ROADMAP.md:313` ("needs a second release target") — it needs a
   second *argument*. Run it only after step 1; a release cannot point at a
   bucket that does not exist.

3. **A client SDK upload path.** For attendee avatars this is the mobile app:
   add `expo-image-picker`, call the existing `getFirebaseStorage()`, `uploadBytes`
   to `avatars/{uid}/{file}`, `getDownloadURL()`, write the result to
   `users/{uid}.photoURL`. That URL will be
   `https://firebasestorage.googleapis.com/v0/b/…` — which satisfies **both**
   the rules-side check (`firestore.rules:254`, regex on the
   `https://firebasestorage.googleapis.com/` prefix) **and** `mirrorDirectory`'s
   defence-in-depth check (`functions/src/triggers/mirror-directory.ts:34`,
   `protocol === 'https:' && hostname === 'firebasestorage.googleapis.com'`).
   Good — those two do not need changing for the new bucket domain, because the
   *download* host stays `firebasestorage.googleapis.com` even for a
   `.firebasestorage.app` bucket. Worth re-verifying with a real URL before
   shipping, since a mismatch here fails silently (the photo is simply dropped
   from the directory).

   ⚠️ **`expo-image-picker` is not in the Expo Go SDK 54 bundle**, so this needs
   a development build — the same prerequisite as push (§4). The dashboard
   already documents this at
   `apps/organizer/src/app/(dash)/engagement/photos/photo-booth/page.tsx:84`.

   For **organizer** uploads (logos, banners, documents) the client path is
   closed by design: `storage.rules:20-28` sets `allow write: if false` on
   `sessions/**` and `sponsors/**`. Those uploads must go through the Next.js
   server using `firebase-admin` (which bypasses rules), not the browser SDK.
   That is the right shape — it keeps the write authority with the already-
   trusted dashboard server — but it means "add upload" is two different pieces
   of work, not one.

4. **An image pipeline.** None exists. Options, cheapest first:
   - **Resize client-side before upload** (free, no infra). Recommended.
   - The Firebase "Resize Images" **extension** — deploys another Cloud
     Function, so it inherits everything in §2.4 (another image lineage in
     Artifact Registry) plus per-invocation compute. Not free, though small.
   - Server-side resize in the Next.js dashboard on upload (free-ish, already a
     trusted Node server).

### 3.3 Does Storage bill on Blaze at low volume?

At KGC's scale, **no** — but only if you use the default bucket. Firebase's
Cloud Storage no-cost tier covers roughly 5 GB stored, 1 GB/day download,
20,000 upload ops/day and 50,000 download ops/day. A few hundred avatars at
even the 5 MB rules cap is ~2.5 GB worst case, and realistically ~100 MB.

Two traps:

- **Additional buckets bill from the first byte.** The no-cost tier applies to
  the *default* bucket only. Do not create a second bucket.
- **Egress.** 1 GB/day download is generous for avatars, but not for video. The
  `content/documents-and-videos/documents` screen is currently link-based
  (`apps/organizer/src/app/(dash)/content/documents-and-videos/documents/page.tsx:12-21`)
  — keep it that way. Serving conference video from Storage is the single
  fastest route to a real bill in this whole audit.

Verify the current no-cost tier figures at
`https://firebase.google.com/pricing` before relying on them.

### 3.4 The ~6 screens gated on this

`ROADMAP.md:105` scores it "~6". `ROADMAP.md:126-127` names them: "app
branding, banner artwork, exhibitor logos and the three photo screens".

| # | Screen | File | Evidence |
|---|---|---|---|
| 1 | App Branding | `apps/organizer/src/app/(dash)/content/branding-center/app-branding/page.tsx` | `:22` "dashboard can put a file into Firebase Storage. There is no upload"; `:105` |
| 2 | Advanced Banners | `apps/organizer/src/app/(dash)/content/sponsor-center/advanced-banners/page.tsx` | `:208-209` "Real banner assets need the Storage upload pipeline" |
| 3 | Exhibitor Manager (logos) | `apps/organizer/src/app/(dash)/content/exhibitor-center/exhibitor-manager/page.tsx` | `:267` "`logoURL` exists on the record and nothing uploads" |
| 4 | Photo Collection | `apps/organizer/src/app/(dash)/engagement/photos/photo-collection/page.tsx` | `:145` |
| 5 | Photo Booth | `apps/organizer/src/app/(dash)/engagement/photos/photo-booth/page.tsx` | `:84` |
| 6 | Profile Photo Frames | `apps/organizer/src/app/(dash)/engagement/photos/profile-photo-frames/page.tsx` | `:21`, `:88` "nothing writes to Storage", `:141` |

Three more are partially gated and worth knowing about:
`tools/moderator-tools/photos/page.tsx:49-50` (which claims the blocker "gates
roughly eighteen" screens — a wider count than ROADMAP's six),
`content/documents-and-videos/documents/page.tsx:53`, and
`content/artifact-center-poster-pitch-gallery/artifact-manager/page.tsx`. The
shared measurement module is `apps/organizer/src/lib/images.ts` (see its
docblock at `:13-42`).

---

## 4. Push notifications

### 4.1 `apps/organizer/src/lib/push.ts` — verified, exists, 273 lines

`AGENTS.md:607-608` is accurate. The file exists and does real work:

| Export | Line | What it does |
|---|---|---|
| `canSend()` | `:70-81` | Refuses if `FIRESTORE_EMULATOR_HOST` is set, or if `GOOGLE_APPLICATION_CREDENTIALS` is absent. The emulator check is the important one — its docblock (`:62-69`) explains that the Admin SDK would otherwise reach *real* FCM from what everyone believes is a local test. |
| `announcementTopic()` | `:93-95` | `event-${EVENT_ID}-announcements` |
| `announcementPush()` | `:106-136` | **One** `getMessaging().send({topic})` call, not a per-device fan-out. Per-user preference is honoured at *subscribe* time (`:102-104`), so it costs nothing at send time. |
| `roomChangeAudience()` | `:148-195` | Collection-group query on `savedSessions` filtered `remind == true` + `sessionId ==`, then per-uid preference check on `notificationPrefs.sessionReminders` and a `fcmTokens` subcollection read. Uses the composite index already declared at `firestore.indexes.json:238-250`. |
| `roomChangePush()` | `:205-269` | Targeted `sendEachForMulticast`, chunked at 500. |

The module is honest about its own limits: every function returns
`{wired: false, detail}` with the audience it *would* have reached rather than
silently no-opping (`:33-48`). `:228` even says "Nothing writes fcmTokens yet,
so this is expected."

**So push targeting is built and tested; push delivery has never run against
live FCM.** `:38-40` states that plainly.

### 4.2 What is missing on the app side

Verified by grep across `app/src` and `app/package.json`:

1. **`expo-notifications` is not a dependency.** `app/package.json` has no push
   package at all. Confirmed by `AGENTS.md:81-82` and
   `app/src/app/messages/index.tsx:62-63`.
2. **Nothing writes `users/{uid}/fcmTokens`.** The type exists
   (`packages/shared/src/models.ts:603-606`, `PushTokenDoc`), the collection name
   exists (`packages/shared/src/collections.ts:62`), and three places *read* it —
   `push.ts:184`, `on-announcement-create.ts:67`, `on-session-agenda-change.ts:99`
   — but there is no writer anywhere. Every token list is empty.
3. **Nothing subscribes to the announcement topic.** `push.ts:102-104` states
   the design ("the app subscribes or unsubscribes the device from this topic
   when the switch moves"), but that app code does not exist. `announcementPush`
   would today broadcast to a topic with zero subscribers.
4. **A development build is required.** Expo Go cannot receive remote push on
   SDK 54 (`AGENTS.md:589-591`). This means EAS Build, plus:
   - `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) in
     the project
   - an **APNs auth key** uploaded to Firebase console → Project settings →
     Cloud Messaging, for iOS
   - the `expo-notifications` config plugin in `app/app.json`
   This is the same dev-build prerequisite as `expo-image-picker` in §3.2 —
   worth doing both in one build rather than two.

Order of work: dev build → `expo-notifications` + permission prompt → write the
token to `users/{uid}/fcmTokens/{token}` → subscribe/unsubscribe the topic from
the prefs switch. Only then does anything in `push.ts` do anything visible.

### 4.3 Does FCM cost anything?

**No.** Firebase Cloud Messaging is free and unmetered on both Spark and Blaze —
no per-message charge, no volume tier. There is no cost lever here at all, which
is why `push.ts:15-23` is right that push was never blocked on Blaze.

The costs adjacent to push are Firestore-side, not FCM-side: reading every
recipient's `fcmTokens` subcollection is one read per user minimum (even when
empty). `onAnnouncementCreate` at 500 attendees does ~500 such reads per
announcement (`on-announcement-create.ts:66-68`). Free tier is 50,000
reads/day — not a concern.

### 4.4 ⚠️ Deploying the functions will cause duplicate push

This is a real defect that does not exist today only because neither half is
live. It becomes live the moment functions deploy **and** `fcmTokens` gets a
writer:

| Event | Dashboard sends | Function sends | Result |
|---|---|---|---|
| Announcement created from the dashboard | `announcementPush()` → topic broadcast (`push.ts:121-127`) | `onAnnouncementCreate` → per-token multicast (`on-announcement-create.ts:73-78`) | **two notifications per device** |
| Session room change from the dashboard | `roomChangePush()` → targeted multicast (`push.ts:252`) | `onSessionAgendaChange` → targeted multicast (`on-session-agenda-change.ts:105-110`) | **two notifications per device** |

Pick one owner per notification type before deploying. The trigger is the better
owner for `onSessionAgendaChange` (it catches changes made by the CSV importer
and by scripts, not just by the dashboard UI); the dashboard is arguably the
better owner for announcements, per its own argument at `push.ts:24-30`, and it
uses one topic call instead of N multicasts. Either way, **decide before deploy,
not after the first double-notification during the conference.**

---

## COST RISKS

| Thing | Bills? | Free tier | Risk | Mitigation |
|---|---|---|---|---|
| Cloud Functions v2 invocations (12 units) | Effectively no at this scale | Cloud Run: ~2M req, 360k GiB-s, 180k vCPU-s / month | Would need ~900k invocations/month to exceed | `minInstances: 0` (already true by omission); `maxInstances: 10` |
| `minInstances > 0` on any function | **Yes — bills per idle second, 24/7** | none | Nobody has set it. Someone "fixing cold starts" later will. | Set `minInstances: 0` **explicitly** so it reads as intentional |
| `maxInstances` unset on 12 functions | Indirectly | — | Default (believed 100) × concurrency 80 = up to ~8,000 concurrent requests. Bounds a runaway at a high ceiling, not a safe one. | Set `maxInstances: 10` on triggers, `3` on the two public callables |
| **`requestOtp` / `verifyOtp` — public unauthenticated HTTPS** | Indirectly, and this is the #1 risk | — | Rate limit is **per email** (`request-otp.ts`, 5/hr). Cycling addresses defeats it entirely. Each call = 1 invocation + a transaction + 2 writes. No App Check, no CAPTCHA. Unbounded `otpCodes`/`rateLimits` growth. | `maxInstances: 3`; enable **App Check** and enforce it on both callables; add a Firestore **TTL policy** on `otpCodes.expiresAt` and `rateLimits`; consider an IP-bucketed limit alongside the email one |
| **Artifact Registry storage** (`gcf-artifacts`) | **Yes, above 0.5 GB — from the first byte over** | 0.5 GB/month | 12 images × every redeploy, retained forever. Total size genuinely uncertain (layers dedupe) — could be under 0.5 GB or several GB. Grows monotonically. | Set a **cleanup policy** on the repo on day one (keep 1–2 versions / delete >1 day). Measure actual size in the console after the first deploy. |
| Cloud Build (function builds) | Has a free tier | ~2,500 build-min/month (verify — figure has changed) | ~15–35 build-min per full 12-function deploy. Dozens of deploys before it matters. | Nothing to do. Re-check `cloud.google.com/build/pricing` before first deploy. |
| GCS staging bucket (`gcf-v2-sources-…`) | Counts toward GCS storage | GCS free tier | Few MB of source zips per deploy, accumulating | Add a lifecycle rule (delete >30 days) |
| Eventarc (Firestore → v2 trigger) | **Unsure** — believed free for Google-source events | Published thresholds far above this scale | Rounds to zero at thousands of events/month under any reading | Verify `cloud.google.com/eventarc/pricing`. Not worth blocking on. |
| Cloud Tasks (`tallyPoll`, `rebuildQaBoard`) | No at this scale | 1M ops/month | Debounced to ≤1 task per 5 s per poll/session | Add `rateLimits: {maxConcurrentDispatches: 5, maxDispatchesPerSecond: 10}` |
| **Cloud Logging ingest** | **Yes, above 50 GiB/month** | 50 GiB/month | Normal operation is nowhere near. A retry storm or fan-out accident is exactly what gets you there — and it is the classic "a bug generated a bill" line item | Set a **log exclusion / retention** and a logging-specific budget alert. Cap function instances so a storm cannot produce the volume. |
| **`onSessionAgendaChange` fan-out on bulk agenda import** | Yes, modestly (tens of cents) | Firestore 20k writes/day | 200 changed sessions × 500 savers ≈ 100k writes **and 100k real push notifications**. Money is trivial; the push spam is not. | `maxInstances: 1` on this function before any bulk import; never import against a live agenda without checking; consider a kill-switch doc |
| `onAnnouncementCreate` fan-out | No | 50k reads / 20k writes per day | ~1,000 reads + 500 writes per announcement at 500 attendees. ~40 announcements/day before the write cap. | None needed. Do not loop announcement creation. |
| Firestore reads/writes generally (`nam5`) | Above free tier | 50k reads, 20k writes, 20k deletes, 1 GiB stored / day | Multi-region unit prices are ~1.7× regional. Location is permanent — nothing to decide. | Nothing. Free tier covers a 500-person conference comfortably. |
| **Cloud Storage — default bucket** | Not at this volume | ~5 GB stored, 1 GB/day download, 20k upload / 50k download ops per day | Avatars at the 5 MB rules cap: ~2.5 GB worst case for 500 people | Resize client-side before upload; keep the 5 MB cap in `storage.rules:15` |
| **Cloud Storage — a second bucket** | **Yes, from the first byte** | none | Free tier is default-bucket-only | Never create one |
| **Serving video/large files from Storage** | **Yes — egress** | 1 GB/day download | Fastest route to a real bill in this whole audit | Keep `documents` link-based, as it is today |
| FCM (messages) | **No** — free and unmetered | unlimited | — | — |
| Firebase Extensions (e.g. Resize Images) | Yes — deploys another function | — | None installed today. Each one adds an Artifact Registry lineage + compute. | Resize client-side instead |
| **Budget alerts** | — | — | **A budget alert does not stop spending.** It emails you. | Pair it with **hard quota caps** (below), which do stop things |

---

## Deployment runbook

Safe to execute in this order. Steps 1–3 happen **before** the plan is upgraded.

### Phase A — before touching the plan

1. **Diagnose the `serviceusage` 403 (read-only).** This is the actual blocker
   and everything downstream depends on it.
   ```bash
   gcloud projects get-iam-policy kgc-conference-app-and-website \
     --flatten="bindings[].members" \
     --filter="bindings.members:hartigandeely456@gmail.com" \
     --format="table(bindings.role)"
   gcloud services list --enabled --project=kgc-conference-app-and-website
   gcloud resource-manager org-policies list --project=kgc-conference-app-and-website
   ```
   Expect `roles/owner`. If it is there and the 403 persists, run
   `firebase login --reauth` (the stored refresh token that `utoken.mjs:21-25`
   reads may predate a permission change) and retry. If it is *not* there, grant
   it — that single change unblocks `firebase deploy --only functions` and makes
   §2.3's custom deploy script unnecessary.

2. **Set a GCP budget with alerts, on the billing account, before upgrading.**
   Billing → Budgets & alerts → Create. Scope it to
   `kgc-conference-app-and-website`. Amount: **$1/month**. Thresholds at 50% /
   90% / 100% of *actual* spend, and check "send alert to billing admins".
   `BACKEND-ROADMAP.md:149` already puts this first; it is right.
   > A budget alert **notifies**, it does not cap. Treat it as a smoke detector.

3. **Set hard quota caps.** These *do* stop things, which is what you actually
   want. GCP console → IAM & Admin → **Quotas & System Limits**, filter by
   service, then "Edit quotas" to lower the limit:
   - Cloud Firestore API — write requests per day → e.g. `50,000`
   - Cloud Firestore API — read requests per day → e.g. `200,000`
   - Cloud Run / Cloud Functions — per-region instance limits
   - Cloud Logging — set a **log exclusion** for high-volume debug logs and drop
     `_Default` retention to 7 days
   Set them deliberately low. Hitting a quota cap is an outage; exceeding a
   budget is a bill. For a pre-production project you want the outage.

4. **Enable App Check** for the project (console → App Check) and register the
   app. Do not enforce yet — register first, enforce in step 10.

### Phase B — upgrade and cap

5. **Upgrade `kgc-conference-app-and-website` to Blaze.** During the upgrade
   flow Firebase offers a budget amount — set it, and note it is the same
   notify-only mechanism as step 2, not a cap.

6. **Add explicit runtime options to `functions/src/`** (code change — §1.8).
   Per-function, not `setGlobalOptions` in `index.ts` — read the ESM ordering
   warning in §1.8 before choosing. Then:
   ```bash
   npm run build --workspace=functions
   npm run typecheck --workspace=functions
   npm run test:functions      # 10 test files, still against the emulator
   ```
   Nothing here touches the live project.

7. **Decide the duplicate-push question** (§4.4). Either remove the FCM branch
   from `on-announcement-create.ts:64-78` / `on-session-agenda-change.ts:98-110`,
   or stop the dashboard sending. Do this **before** step 8 — it is a one-line
   change now and an incident later.

### Phase C — deploy functions

8. **Deploy.** If step 1 fixed the 403:
   ```bash
   npx firebase deploy --only functions --project kgc-conference-app-and-website
   ```
   Accept the Artifact Registry **cleanup policy** prompt when the CLI offers it.
   Consider deploying one function first (`--only functions:onReplyWrite`) to
   confirm the whole chain — APIs enabled, Cloud Build succeeds, image lands,
   Eventarc trigger created — before pushing all twelve.

9. **Immediately verify the caps landed.** Cloud Run console → each of the 12
   services → check **max instances** and **min instances = 0** on the deployed
   revision. Do not verify by reading the source (§1.8).

10. **Enforce App Check on `requestOtp` and `verifyOtp`.** They are the only
    internet-reachable surfaces in the set.

11. **Set the Artifact Registry cleanup policy** if the CLI did not: Artifact
    Registry → `gcf-artifacts` → Edit → Cleanup policies → keep most-recent 2,
    delete versions older than 1 day. Record the current repo size while you are
    there — that is the number that tells you whether §2.4 is $0.00 or $0.30.

12. **Smoke-test the chain on live data, minimally.** Post one community reply
    and confirm `replyCount` moves. One upvote, confirm `upvoteCount` and
    `qaBoard/current`. **Do not** create an announcement or change a published
    session's room yet — those fan out.

### Phase D — Storage (independent of C; can be done first)

13. **Provision the default bucket.** Firebase console → Storage → Get started
    → **`us-central1`** (permanent; matches `nam5`). Then re-run the §3.1 probe
    to confirm it now returns 403 rather than 404.

14. **Publish the storage rules:**
    ```bash
    GOOGLE_APPLICATION_CREDENTIALS=.secrets/service-account.json \
    node scripts/ops/deploy-rules.mjs \
      storage.rules \
      firebase.storage/kgc-conference-app-and-website.firebasestorage.app
    ```
    Expect "uploaded ruleset …" then "created release
    firebase.storage/…". Note the two-identity requirement
    (`deploy-rules.mjs:16-21`): the service account uploads, the signed-in human
    publishes — so `firebase login` must be current.

15. **Set a GCS lifecycle rule** on the `gcf-v2-sources-…` staging bucket
    (delete objects >30 days), and confirm no *second* bucket has appeared.

16. Only then build the upload path (§3.2 step 3) — which needs the dev build
    that push also needs, so plan them together.

### Phase E — ongoing

17. **Check the billing report at 24 h, 7 d and 30 d after the first deploy.**
    Billing → Reports, grouped by SKU. The line you are looking for is
    "Artifact Registry Storage". If anything else is non-zero, something in this
    report was wrong and it is worth finding out which thing.

### Do not do

- Do not set `minInstances > 0` on anything.
- Do not create a second Storage bucket.
- Do not serve video or large downloads from Storage.
- Do not deploy to a region other than `us-central1`.
- Do not run a bulk agenda import against a live event with
  `onSessionAgendaChange` deployed and uncapped (§1.5).
- Do not install a Firebase Extension "just to try it" — each one is another
  function, another image, another lineage.
- Do not treat the budget alert as a spending cap.
