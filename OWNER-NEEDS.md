# What the product still needs from you

Written 2026-09-06, at the end of the pass that turned the organizer dashboard from a parity
demonstration into a product. Every screen now either does its job on real data or says
**"Not inputted yet"**; nothing on screen describes what the software cannot do, and nothing
displays an invented number. What is left is genuinely not code.

`OWNER-ACTIONS.md` remains the record of the infrastructure asks and their history. This file is
narrower: it is the list of things that block a *feature* from working, each one traced to the
screen that wants it.

⚠️ Three items in the working notes this file was assembled from were **already stale when they
were written**, all in the same direction — they named the Firebase Storage bucket as missing. It
has existed since 2026-09-01. `AGENTS.md` said otherwise for a week and eleven dashboard screens
repeated it, which is why §5 exists at the bottom.

---

## 1. Credentials and accounts

### 1.1 Stripe — ✅ mostly closed, 2026-09-06

A **test-mode** `STRIPE_SECRET_KEY` was supplied and is in `apps/web/.env.local` and
`apps/organizer/.env.local` (both gitignored). Verified against Stripe's own API: the key
authenticates and reports `livemode: false`, so no real money can move. `/tickets` now offers a
purchase instead of saying it cannot sell.

⚠️ **One piece is still missing: `STRIPE_WEBHOOK_SECRET`.** Checkout will start without it and
fulfilment will not finish — `apps/web/src/app/api/stripe/webhook/route.ts` refuses an unverified
event with a 500, which is the correct posture and also means no order is written and no account is
provisioned. Two ways to supply it, depending on where you are testing:

- **Locally** — install the Stripe CLI (`brew install stripe/stripe-cli/stripe`) and run
  `stripe listen --api-key <the test key> --forward-to localhost:3200/api/stripe/webhook`. It prints
  a `whsec_…` on startup; that is the value. I did not install it, because that puts software on
  your machine.
- **On Netlify** — add a webhook endpoint in the Stripe dashboard pointing at the deployed site's
  `/api/stripe/webhook`, and copy the signing secret it gives you.

⚠️ The **publishable key you also sent is not used anywhere in this project** and does not need to
be set. The site hands the buyer to Stripe's hosted Checkout, so no key ever reaches the browser —
which is why there are deliberately no card fields on `/tickets`.

⚠️ These are test keys, so the exposure is low, but they were pasted into a chat transcript. Roll
them in the Stripe dashboard before you ever put live keys near this project.

The screens below now work against the test key. They will need **live** keys before you sell a
real ticket.

| Screen | What the key unlocks |
|---|---|
| `tickets/publish-tickets` | The standing pre-flight blocker. Tiers can be priced, listed and made visible; none can be sold. |
| `tickets/orders-and-transactions/attendee-orders` | The Refund button cannot render at all. The ledger, the CSV export and mark-paid all work without it. |
| `tickets/ticket-setup/discount-codes` | Codes are Stripe promotion codes read live, not mirrored here. With no key there is nothing to read and none can be created. |
| `tickets/ticket-setup/create-group-tickets` | Raising an invoice from the dashboard. Deliberately not stubbed — an invoice with no Stripe object behind it is a promise to collect money that nothing can collect. |
| `tickets/payout` · `pay/balance` · `pay/billing-information` | Cleared balance, payouts, fees, disputes and the rolling hold that separates "sold" from "landed". Only Stripe knows these. |

### 1.2 The `functions/` IAM grant · `OWNER-ACTIONS.md` §3

`iam.serviceAccounts.ActAs` on `kgc-conference-app-and-website@appspot.gserviceaccount.com`. Only
`roles/owner` can grant it, and the owner is `francois@knowledgegraph.tech`. It is **not** Blaze and
**not** the old `serviceusage` 403 — both of those are resolved.

- **`engagement/live-polling`** — the dashboard now counts votes itself, and an organizer can press
  *Publish the count* to push a correct result to the app. What no read-time count can substitute
  for is a tally that moves **during** a vote, because that is a thousand phones reading rather than
  one.
- **`engagement/gamification`** — points cannot be counted at read time the way replies and votes now
  are. A score has to be written by something the scorer does not control.
- **`content/agenda-center/session-qanda-manager`** — Q&A upvote counts stay frozen at their seeded
  values in the app as well as here.
- **`content/call-for-speakers-abstracts`** — scheduled submission reminders want Cloud Tasks.
  `CallDoc.reminderDaysBefore` is stored and the screen says plainly that those are the days a
  *button* is offered on, not an automation.

### 1.3 Email · `OWNER-ACTIONS.md` §6

`RESEND_API_KEY` exists in local development. It is needed on two **deployments**:

- **on `apps/organizer`** — `content/exhibitor-center/message-exhibitors` resolves and previews the
  exhibitor audience, and logs every send as skipped without it.
- **on `apps/web`** — ⚠️ this one is sharper than it looks. The call-for-abstracts receipt carries
  the **only** route back to an author's own draft, because a submitter has no account. A call run
  without it works, and every "I lost my link" becomes a support ticket.

### 1.4 `WEB_SUBMISSION_SECRET` — one new variable, on both Netlify sites

`openssl rand -base64 32`. Without it, `WEB_ORDER_SECRET` signs submission links as a fallback,
which works but is worth avoiding: `WEB_ORDER_SECRET` is documented as rotatable, and a rotation
would silently kill every outstanding link back to a draft. That surfaces weeks later as *"the call
stopped getting submissions"*.

### 1.5 Third-party accounts nobody here has opened

- **A video host** (Mux, Cloudflare Stream, or an unlisted Vimeo) — ⚠️ **two ticket tiers already
  sell "three months of the KGC Video Library" and nothing serves a recording.** That is a live
  promise on a paid ticket, not a gap in a screen.
- **A streaming provider** for `virtual-and-hybrid/*` — an ingest endpoint and stream key per room,
  plus an AV rig and an operator per room for five days.
- **Zoom Marketplace OAuth app** — client credentials plus a published listing through Zoom's
  security review. Approval is outside our control.
- **Microsoft Entra app registration** — tenant-admin consent for `OnlineMeetings.ReadWrite.All` in
  **each participating organisation's own tenant**, which is every attendee's employer IT
  department rather than KGC's.
- **A live-captioning vendor**, billed per hour per room, if captioning is an accessibility
  commitment.
- **App Store and Google Play listings**, if store badges and deep links are wanted. Until then
  every snippet points at `/tickets`.

---

## 2. Assets — files somebody has to hand over

- ✅ **The KGC brand mark — no longer needed, 2026-09-06.** This ask was stale when it was written:
  the repo already held the mark, as `apps/web/public/kgc-logo.png`, the full-colour KGC lockup the
  website has used since August. It is now copied to `apps/organizer/public/kgc/logo-colour.png` and
  both screens carry it — `attendees/certificates` stamps it onto every certificate at issue as the
  default, and `tools/app-adoption/downloadable-graphics` prints it at the head of the A5 desk sign.
  ⚠️ Note for anyone tempted to "fix" this by reaching for the asset already in the dashboard:
  `public/kgc/wordmark-white.png` is the **header** mark, white artwork for the `#2180b2` bar, and
  it prints as nothing at all on white paper. Uploading your own mark on the certificate form still
  overrides the default, and Remove still prints no mark.
- **A floorplan image of Cornell Tech's conference space.** `RoomDoc.mapX`/`mapY` are modelled and
  readable, so the pins are fractions of a picture that does not exist yet —
  `marketing/event-webpages/venue-map-webpage`, and the app's Floormap tile.
- **2027 website copy** — the code-of-conduct reporting address, the poster and pitch submission
  URLs, and the real deadlines. ⚠️ All three public pages still render last edition's compiled-in
  text, **including URLs that carry `2026`**.

---

## 3. Decisions — no credential would help

### 3.1 Call for abstracts — four answers to ratify

`CFA-PLAN.md` §7 put four questions to you. None blocked the build: the plan's own recommendation
was taken in each case, and the schema was written so that changing the answer later is a setting
rather than a migration.

| Question | What was built | To change it |
|---|---|---|
| §7.1 Blind review | Built **double-blind-capable**, running **single-blind by default**. The author lives in `submissions/{id}/identity/author`, apart from the abstract. | `CallDoc.blindReview`. Turning the blind up is a decision about which document the review screen loads, not a rewrite. |
| §7.2 Form freeze | **Versioned, never frozen** — better than Whova's. Adding a question is always allowed; changing or removing one mints a version. | Nothing to change; every submission stores the `formVersion` it answered against. |
| §7.3 Speaker as a fourth registration product | **No, out of scope.** An accepted speaker gets no ticket from this feature. | A comped tier plus a decision about who mints the entitlement. |
| §7.4 Separate poster call | **One call with a `sessionType` field.** | The schema already supports two at once (`callId` is on every submission) and the screens switch between them. |

### 3.2 Cross-surface gaps — the dashboard writes it, the app cannot read it

These are the honest remainder of a two-surface product. Each is app work, not dashboard work.

- **Surveys** — the dashboard authors, publishes and reports on real surveys. **No screen in the app
  renders one**, so a published survey cannot be answered from a phone.
- **Round tables and 1-1 meetings** — `gatherings` is fully editable in the dashboard and nothing in
  the app reads it. ★ The blocker is structural, not laziness: `GatheringDoc.attendees` holds
  *names an organizer typed*, deliberately, because half the people at a sponsor meeting hold no
  ticket. So the per-attendee projection has no join key, and the tempting name-match seats the
  wrong person at the wrong table. It needs a decision — pick attendees out of the directory by uid,
  keeping free text for guests — then a dashboard change.
- **Push** — a desk message lands in the attendee's inbox and nothing tells them. Receiving needs a
  development build rather than Expo Go, which is a deferred decision of yours.

### 3.3 Product and privacy calls

- **Photos on name badges** — ⚠️ nothing in this project has ever *written* `users.photoURL`. The app
  only reads it, the seed does not set it, there is no avatar upload. A photo slot would print an
  empty box on all 1,000 badges. Closing it means an app-side upload **plus** a consent question
  about printing faces.
- **Tier-restricted documents** — an attendee now sees published documents with no ticket-tier
  restriction. A restricted one stays server-side entirely, because ticket tier is not a custom
  claim and rules filter documents rather than fields. Widening this is a decision about **the
  token**, not about the rules block.
- **Emailing announcements** — the bulk sender and a Resend key both exist, but `registrations` has
  no unsubscribe field, and mailing an opted-out address takes the transactional **ticket receipts**
  down with the newsletter. Needs an opt-out model first.
- **The remote ticket tier** — stop selling it, re-sell it as post-event recordings, or fund real
  streaming. It is live on the public site and nothing delivers what it promises.
- **Sponsor complimentary passes** — a sponsor tier's included passes are display bullets on
  `TicketTypeDoc.includes` and **nothing mints them**. Either sponsorship stays
  negotiated-and-invoiced (so the catalogue is a price list to quote from), or the entitlement has
  to be modelled.
- **A leaderboard at all** — and if so, what a point is worth, and whether it may name attendees who
  did not opt in to the directory.
- **Where organizer help content lives** — there is no article store and no editor, so a code deploy
  is the only route today.

---

## 4. One deploy step

`firestore.rules` gained a `match /documents/{documentId}` block and `firestore.indexes.json` gained
the `eventId, status, visibleToTicketTypes` composite index. **Both must be published before the
app's Documents screen shows anything against the live project.** Until then that screen renders its
error state on a `permission-denied` — deliberately, rather than a false empty.

    node scripts/ops/deploy-rules.mjs
    node scripts/ops/deploy-indexes.mjs

⚠️ Rules take two identities: the service account may *create* a ruleset, and only you may *publish*
one. Seven `submissions` / `reviewers` / `identity` indexes are also waiting, for the
call-for-abstracts ranking queries that phase 3 will write.

---

## 5. Corrections — things this project believed that were not true

Recorded because each one cost work, and because the first two were being copied from screen to
screen faster than they were being checked.

- ✅ **The Firebase Storage bucket exists**, since 2026-09-01, verified by an actual round trip.
  `AGENTS.md` said otherwise for a week and **eleven dashboard screens** repeated it — all now
  fixed. Uploads work; `apps/organizer/src/lib/uploads.ts` is the writer.
- ✅ **Rules and indexes have been live since 2026-08-27.** `publish/` was telling you they had never
  been pushed.
- ✅ **The KGC brand mark was never missing.** §2 asked the owner for a file that had been sitting in
  `apps/web/public/` since 16 August. Two screens described themselves as typographic for want of it
  and the ask was written down as an owner action — because `apps/organizer/public/` held only the
  white header wordmark, and nobody checked the other app's `public/` before concluding the mark did
  not exist. Fixed 2026-09-06.
- ❌ **`publish/` claimed the website "completes purchases as clearly-labelled tests and takes no
  money".** That described the demo-mode branch deleted on 2026-08-31. The path fails closed.
- ❌ **The test counts in `AGENTS.md` are stale.** The runner says 496 unit, 233 rules, 90 commerce
  and 64 call-for-abstracts. Trust the runner.
- ❌ **The call-for-abstracts portal silently kept a cleared answer.** `FieldValue.delete()` was used
  correctly in four top-level places in the same file, and then `answers` was written as a map —
  which merges key by key under `set(…, { merge: true })`, so an author who deleted an answer was
  told "Saved" and carried the old text into review. Four correct uses did not stop the fifth being
  wrong, because a map does not look like a field.
- ❌ **`lib/data.ts` crashed every screen that lists attendees** — a live `users` document has no
  `name` and `listAttendees()` sorted on it unguarded.
- ❌ **Attendee Orders' search box was decorative** — it sat outside any form, so typing and pressing
  Enter did nothing, on the busiest money screen in the product.
