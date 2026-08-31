# The build plan — from "renders" to "runs the conference"

**Compiled 2026-08-30** from six parallel read-only audits of the working tree.
The audits are in `docs/audit-2026-08-30/` and every claim below is traceable to
one of them:

| | Audit | Scope |
|---|---|---|
| **A** | `A-dashboard-gaps.md` | Every route under `(dash)`, classified. 175 rows. |
| **B** | `B-ticketing.md` | Ticket price / quantity / specs, and the money chain. |
| **C** | `C-agenda-sponsors.md` | Agenda and sponsor authoring, and denormalisation. |
| **D** | `D-demo-mode.md` | Every demo-mode branch, and what breaks without them. |
| **E** | `E-linkage.md` | Dashboard ↔ Firestore ↔ website ↔ app correspondence. |
| **F** | `F-blaze-infra.md` | Cloud Functions, Storage, push, and what bills. |

This file supersedes `ROADMAP.md` as the current measurement. `ROADMAP.md`
counted **screens**; this counts **capabilities**, which is the thing that was
actually missing.

---

## 1. What is actually true

Three claims in the existing docs are wrong in the optimistic direction, and
correcting them is the whole reason this plan looks bigger than `ROADMAP.md`.

| Doc claim | Reality | Source |
|---|---|---|
| "All 173 screens read or write real Firestore data" | **39 of 173 read nothing.** 141 of 175 routes cannot write anything. | A |
| "8 Cloud Function triggers" | **12 functions** — 8 Firestore triggers, 2 Cloud Tasks handlers, 2 public HTTPS callables. | F |
| "5 of 21 website pages read Firestore" | **8 of 21.** | E |

And the finding that reframes everything:

> ★ **The programme is read-only on every surface.** `speakers`, `sponsors`,
> `tracks` and `rooms` are read by the dashboard, the website and the app, and
> written by **none** of them. The only way to change a speaker's name today is
> to re-run `npm run seed` or hand-edit Firestore. — C, E

The dashboard is not 173 finished screens with five capabilities missing. It is
a very good **reporting** tool over a database that only a seed script can fill.
The work below turns it into an **authoring** tool.

### The numbers that drive the plan

| | Count | Source |
|---|---:|---|
| Routes under `(dash)` | 175 | A |
| — that can write anything | **34** | A |
| — that read nothing at all | **40** | A |
| Server actions, total | 48 in 24 modules | A |
| — that delete anything | **1** | A |
| Collections declared in `@kgc/shared` | 50 | E |
| — the dashboard can create or edit | **15** | E |
| — the dashboard never touches | **15** | E |
| Entities the app shows that the dashboard cannot author | **7** | E |
| Entities the dashboard authors that nothing displays | **9** | E |
| Counters rendered in the app that can never move | **5** | E |
| Hard-`disabled` buttons visible regardless of `SHOW_GAP_NOTES` | **36** | A |
| `TicketTypeDoc` fields with no control | 4 of 18, plus 3 editable-but-inert | B |
| `SessionDoc` fields editable | **6 of 28** | C |
| `SponsorDoc` fields editable | **0 of 13** | C |

---

## 2. Decisions I am making, and the one I need from you

These are judgement calls the audits surfaced. I am proceeding on them rather
than blocking; each says what to change if you disagree.

**D-1 · "No more demo mode" means the payment *bypass* goes, not the card form.**
There are **no Stripe keys anywhere in this repo** — `DEMO_MODE=1` exists
because there is no Stripe account (`apps/web/.env.example:31` still has
`# STRIPE_SECRET_KEY=sk_test_...` commented out). So the plan removes every
demo branch *except* the two you named, and makes the purchase path run on real
Stripe **test-mode** keys the moment you paste them in. Stripe test mode moves
no money. Until you do, the card form stays and approves — clearly labelled, and
behind the same explicit flag rather than silently.
→ **This is the one thing I need from you: a `sk_test_…` key and a
`whsec_…` webhook secret.** Everything else in this plan proceeds without you.

**D-2 · The "credit card boxes" stay as an on-page form, so the real path is
Stripe Elements, not hosted Checkout.** Hosted Checkout renders the card box on
`checkout.stripe.com`, which would delete the boxes you asked to keep
(D, on `checkout-form.tsx:197-225`). Elements keeps three fields on our page
with real tokenisation. Cost: PCI scope moves SAQ A → SAQ A-EP. Say the word and
I keep hosted Checkout instead, and the "card boxes" become Stripe's.

**D-3 · `isDemoMode()`'s silent fixture fallback is a bug, not a feature.**
Missing credentials currently swap Firestore for a 343 KB in-memory
`fixture.json` and the dashboard reports saves that did not happen
(`demo/store.ts:282`, B). It will fail loudly instead.

**D-4 · `SHOW_GAP_NOTES` survives, but shrinks.** Gap notes get deleted as the
gap closes, not hidden. The 36 hard-`disabled` buttons that render *outside* the
flag get wired up or removed — a greyed-out button is the failure mode the flag
was invented to prevent.

**D-5 · Streaming / Virtual & Hybrid (15 screens) stays cut**, per `ROADMAP.md`.
One exception: a live ticket tier sells a **video library** (`includesVideoLibrary`),
so that entitlement gets honoured even though the streaming cluster does not get
built. Selling something and building nothing is worse than not selling it.

**D-6 · Nothing in this plan spends money.** Details in §3.

---

## 3. Cost safety — do this before anything deploys

⚠️ Blaze bills from the first unit on some services. F traced all twelve
functions and found **no infinite loop**, but three real risks. These are
prerequisites, not cleanup.

| Thing | Bills? | Free tier | Risk found | Mitigation |
|---|---|---|---|---|
| **Artifact Registry** | ⚠️ **Yes, at idle** | 0.5 GB | 12 function images, growing every redeploy | Cleanup policy on day one; measure after first deploy |
| Cloud Functions invocations | No, at this scale | 2M/mo | — | `maxInstances` cap on all 12 |
| Cloud Functions idle | Only if `minInstances > 0` | — | Unset → 0 ✅ already correct | Never set it |
| Cloud Build | No | 120 min/day | — | — |
| FCM push | No | Unmetered | — | — |
| Firestore | No, at this scale | 50k reads/day | ⚠️ free tier was exhausted once before (commit `4cd52ac`) | Budget alert |
| Cloud Storage | Marginal | 5 GB | Bucket **does not exist yet** (verified by probe) | Provision explicitly |

**Three specific hazards F found, all of which are cost hazards:**

1. **`requestOtp` / `verifyOtp` are unauthenticated public endpoints** whose rate
   limit is *per email address* — cycling addresses defeats it entirely. No App
   Check, no `maxInstances`, no TTL on `otpCodes`. This is the single most
   expensive thing that could be deployed carelessly.
2. **`onSessionAgendaChange` is undebounced and unconditional.** A bulk agenda
   re-import could produce ~100k notification writes **and ~100k real push
   notifications**.
3. ★ **`setGlobalOptions` in `index.ts` would silently do nothing.** That file is
   nothing but `export … from` statements, so all 12 functions are defined
   before its body runs. Options must be per-function, and verified in the Cloud
   Run console rather than in the source.

**Also:** deploying `onAnnouncementCreate` and `onSessionAgendaChange` creates
**duplicate push** — `apps/organizer/src/lib/push.ts` already sends for both.
Pick an owner before deploying, not during the conference.

---

## 4. The blocker graph

Everything downstream hangs off five things. Two are one-time infrastructure,
three are code.

```
B1  IAM: serviceusage.services.enable          ─┐
                                                ├─→  B2  Deploy 12 functions ──→ counters, tallies, OTP sign-in (9 routes)
B0  Cost guardrails (§3)                       ─┘
                                                     B3  Storage bucket + rules + upload path ──→ ~24 routes
                                                     B4  Shared CRUD/form vocabulary in (dash) ──→ every editor below
                                                     B5  Denormalisation fan-out helper ──→ speaker/track/room editors
```

**B1 is the one with an unknown.** F's finding: the `serviceusage` 403 that
blocks `firebase deploy` probably blocks functions *more* fundamentally than it
blocks rules — deploying a v2 function needs five APIs *enabled*, which needs
`serviceusage.services.enable`. A `deploy-functions.mjs` would hit the same 403
one layer down. **The fix is the IAM grant, not another script.** F's report has
the read-only diagnosis commands.

**B4 is invisible but load-bearing.** `(dash)/ui.tsx` exports 20 components and
**not one of them is a form control** — no field, no select, no modal, no submit
button. That is the mechanical reason 141 routes are read-only: there is no
vocabulary to write an editor in. Building it once is what makes the ~20 editors
below cheap instead of bespoke.

---

## 5. The work, in waves

Each numbered item is sized for one agent. **S** ≈ under an hour, **M** ≈ a few
hours, **L** ≈ a day.

### Wave 0 — Foundations · blocks everything

| # | Task | Size | Source |
|---|---|---|---|
| 0.1 | Cost guardrails: budget alert, hard quota caps, `maxInstances` per-function on all 12, Artifact Registry cleanup policy. **Before** the Blaze switch. | M | F |
| 0.2 | Diagnose and fix the `serviceusage` IAM grant; confirm `firebase deploy --only functions` pre-flights | M | F |
| 0.3 | Harden `requestOtp`/`verifyOtp`: App Check, per-IP limit, `maxInstances`, TTL on `otpCodes` | M | F |
| 0.4 | Debounce `onSessionAgendaChange`; resolve the duplicate-push ownership with `lib/push.ts` | M | F |
| 0.5 | Deploy the 12 functions. Verify caps in Cloud Run, not in source | M | F |
| 0.6 | Provision the Storage bucket; deploy `storage.rules` via `deploy-rules.mjs storage.rules firebase.storage/<bucket>` (it already takes the argument — `ROADMAP.md:313` is wrong) | S | F |
| 0.7 | **Form vocabulary in `(dash)/ui.tsx`**: `Field`, `Select`, `Textarea`, `Checkbox` (exists), `DatePicker`, `Modal`, `SubmitButton`, `FormState` — matching Whova's `.whova-form-*` CSS already in `globals.css` | L | A |
| 0.8 | **Upload path**: one `uploadImage()` used by sponsor logos, exhibitor logos, speaker headshots, session slides, branding | L | C, F |
| 0.9 | **Denormalisation fan-out helper**: given a changed speaker/track/room, batch-update every referencing session (`speakerNames`, `primaryTrackName`, `primaryTrackColor`, `roomName`) | M | C |

⚠️ **0.9 must land before 2.2–2.4.** Without it, a speaker editor silently
corrupts every session that names them. C calls this hazard *"armed, not fired"* —
it fires the day the editor ships.

### Wave 1 — Demo mode out, real sign-in in

★ **1.1–1.5 and 1.8 landed on 2026-08-31.** Demo mode is removed: no `DEMO_MODE`
branch, no `EXPO_PUBLIC_DEMO_MODE`, no credential panels, no `demo`/`123`
mapping, no `OPEN_SIGNIN`, no fixture Firestore. The two KEEPs render and are
verified. The purchase path fails closed on a missing `STRIPE_SECRET_KEY`.
**1.6 is half done** — the fail-closed half; the Elements card form waits on a
publishable key. **1.7 is the owner's** (`OWNER-ACTIONS.md` §4): the literals are
out of the working tree but not rotated. **1.8's Netlify half is the owner's
too** (`OWNER-ACTIONS.md` §4b).

The hard finding from D: **after removing demo mode there is currently no way
for a real purchaser to get an account at all.** `provisionAppAccount()` has
exactly one call site and it is inside `if (!stripeEnabled())` *and* behind
`if (approved)` where `approved = demoMode()`. The Stripe webhook writes a
registration, an order and a receipt — and **no identity**.

| # | Task | Size | Source |
|---|---|---|---|
| 1.1 | **Provision the account on the real webhook path** — move `provisionAppAccount()` onto `checkout.session.completed` / `invoice.paid` | M | D |
| 1.2 | **OTP email delivery.** `request-otp.ts:88` `console.log`s the code; its own docblock says that must not ship. Wire it to the existing email sender | M | D |
| 1.3 | App sign-in screen: OTP flow replacing email+password | M | D |
| 1.4 | Remove every `DEMO_MODE` branch **except the two KEEPs** (§2, D-1) | M | D |
| 1.5 | Replace the `isDemoMode()` fixture fallback with a loud failure | S | B, D |
| 1.6 | Real Stripe wiring: keys, Elements card form, webhook secret; fail closed when unconfigured | M | B, D |
| 1.7 | ⚠️ **Rotate the live secrets committed in-repo** — `the shared app password (redacted)` (5 files, on 50 live Auth accounts) and `the live dashboard passphrase (redacted)` (the live `CONSOLE_PASSPHRASE`, hardcoded at `demo/act3-dashboard.mjs:39`, guarding an Admin SDK that bypasses all rules) | S | D |
| 1.8 | Clear `DEMO_MODE=1` from all three `.env.local` files **and from the Netlify UI on both sites** — code removal alone is not enough | S | D |

### Wave 2 — The programme becomes editable

This is the largest cluster and the one the owner asked for by name.

| # | Task | Size | Source |
|---|---|---|---|
| 2.1 | **Session create + delete-by-status**, and the 22 unwritable fields — above all `speakerIds` and `trackIds`. Extend the existing `saveSessionAction` transaction; it already has the right shape and re-derives times correctly | L | C |
| 2.2 | **Speaker CRUD** (10 disabled menu items today). Must preserve the `userId` join. Gated on 0.9 | L | C |
| 2.3 | **Track CRUD** (name, colour, description). Gated on 0.9 | M | C |
| 2.4 | **Room CRUD** — no screen exists at all, and `roomName` is the only thing telling an attendee where to walk | M | C |
| 2.5 | **Sponsor CRUD** — 0 of 13 fields today. Mirror `exhibitor-manager/actions.ts`, which already does audit + validation + id collision + no-delete correctly | L | C |
| 2.6 | **Sponsor + speaker images through 0.8**; retire the 18 CloudFront hotlinks and the website's swap-in whitelist | M | C |
| 2.7 | ⚠️ **Fix the exhibitor↔booth split-brain — live today, not hypothetical.** The exhibitor form takes `boothNumber` as free text and never touches `booths`, so an exhibitor can claim a booth the floor plan shows as free | M | C |
| 2.8 | Extend the CSV importer beyond attendees and contacts to speakers, sessions, sponsors | M | E |

### Wave 3 — Ticketing: the specs around the price

★ **The price chain itself is correct and needs no work.** B traced it end to
end: no cache, no hard-coded fallback, and the form posts a tier *id* rather
than an amount, so the classic "$1 for a $1,199 ticket" bug is closed by
construction. What is broken is everything around it.

| # | Task | Size | Source |
|---|---|---|---|
| 3.1 | 🔴 **`groups` has no editor and `groups` is what renders.** Editing "What's included" on the two flagship tiers changes nothing a buyer sees | M | B |
| 3.2 | 🔴 Pass currency through on `/tickets` — a non-USD tier misprices itself on the public page. Two one-line fixes | S | B |
| 3.3 | 🔴 A sold-out tier still shows a live "Choose" button on `/tickets`; the audience pages already do this correctly | S | B |
| 3.4 | ⚠️ **`quantitySold` is a one-way ratchet** — never decremented on refund, no control corrects it. Ten refunds permanently consume ten seats | M | B |
| 3.5 | Write `users/{uid}/entitlements` at fulfilment from `includesWorkshops` / `includesVideoLibrary`; read it in the app. Also: **a tier created from this dashboard can never include workshops** — no form exposes the field | M | A, B |
| 3.6 | Honour `featured` instead of hard-coding two slugs; render `tagline`; resolve `inPerson` | S | B |
| 3.7 | Re-check capacity at `invoice.paid`, not only when the invoice is raised — a 30-day oversell window on net-30 terms | S | B |
| 3.8 | Timezone the sales window — `parseDate` uses the server's zone; sessions already solve this | S | B |
| 3.9 | **Ticket add-ons as products** — the largest single ticketing gap. Checkout hard-codes `quantity: 1` | L | B |
| 3.10 | Multi-seat card checkout; group/bundle tickets; dashboard-raised invoices; partial refunds and credit notes | L | B |
| 3.11 | ⚠️ **A public unsubscribe link** — legally required in several jurisdictions before the first bulk campaign. The mechanism exists as `/order/{token}` | S | A |

### Wave 4 — Linkage: dashboard → website → app

Nine entities the dashboard authors that nothing displays; seven the app
displays that the dashboard cannot author.

| # | Task | Size | Source |
|---|---|---|---|
| 4.1 | 🔴 **`settings` is read by nobody.** `saveSettings` is reached from six routes including all three Branding Center screens; `COLLECTIONS.settings` appears **zero times** in `app/src` and **zero times** in `apps/web/src`. Nothing an organizer sets there changes any colour, logo or URL | L | E |
| 4.2 | **Announcements never reach the website** — the banner and ticker are constants in `lib/site.ts`. "Keynote moved to Bloomberg 165" reaches every phone and no browser | S | E |
| 4.3 | **Surveys**: fully authorable, and the app's Surveys tile routes to `coming-soon` saying it waits on "the organizer console". The console is done; the copy is stale | M | E |
| 4.4 | **Exhibitor listing** on the website and the app — `/tickets/exhibitor` sells "your booth number in the app every attendee already has open" and no such listing exists | M | C, E |
| 4.5 | **Gatherings**: full seating machinery, and no attendee can see which table they were placed at | M | E |
| 4.6 | 🔴 **The readiness screen lies about `/speakers`** — it counts speakers with no photo for a page that renders a hardcoded 2026 roster and never calls `listSpeakers()`. Either drive the page from Firestore or tell the readiness screen | S | E |
| 4.7 | Website CMS for the prose pages (code of conduct, CFP, team, about) — editing them is a deploy today | L | E |
| 4.8 | Fix `(dash)/layout.tsx:149,154` — hard-coded `localhost:8081` and `localhost:3000/tickets` preview links, dead on Netlify and the wrong port locally | S | A |
| 4.9 | Filter `deletedAt` in the app's session query to match the website's | S | C |
| 4.10 | ⚠️ **The organizer and the attendee see different poll numbers on the same stage.** The dashboard subtracts correctly (`polls.ts:17-27`); the app does not | S | E |
| 4.11 | **`threads` appears 0× in the dashboard** — no organizer can read or send a DM | M | E |
| 4.12 | ⚠️ **`upvoteCount` is frozen *and* is the Q&A sort key** (`qa.ts:63-65`) — worse than its docblock admits. Closed by 0.5, but the sort needs re-checking after | S | E |

### Wave 5 — The remaining dashboard surface

A's eleven clusters, minus what the waves above already close. Roughly **60
routes**, and most become cheap once 0.7 and 0.8 exist.

| # | Cluster | Routes | Source |
|---|---|---:|---|
| 5.1 | Screens gated on file upload — closed by 0.8, then wired per screen | ~24 | A |
| 5.2 | Submission forms + a response store (call for speakers, applications) | ~8 | A |
| 5.3 | Per-session attendance — the check-in engine already supports the scope | ~7 | A |
| 5.4 | Capability-token self-service for speakers / sponsors / exhibitors, generalising `/order/{token}` | ~9 | A |
| 5.5 | Closed unions in `models.ts` that need widening | ~7 | A |
| 5.6 | ⚠️ **Five settings screens that save documents nothing reads** — the most misleading failure mode in the dashboard (overlaps 4.1) | 5 | A |
| 5.7 | Wire the 36 hard-`disabled` buttons, or remove them. Two are disabled although the export registry already serves the CSV — pure wiring | 8 screens | A |
| 5.8 | Delete `lib/gaps.ts` (dead code, says so in its own header); move the ~34 plain-`Panel` gap prose behind the flag | — | A |

### Wave 6 — Verification

| # | Task | Source |
|---|---|---|
| 6.1 | `npm run smoke` — all 173 routes against a seeded emulator | AGENTS.md |
| 6.2 | Full suite: 358 tests, plus new tests per wave. ⚠️ Stop dev servers first — `.next` collisions on :3100 and :3200, and the `apps/web` one **fails silently** as unstyled HTML | AGENTS.md |
| 6.3 | `npx expo export` on **both** iOS and Android — typecheck alone does not catch module resolution | AGENTS.md |
| 6.4 | End-to-end run: dashboard price edit → website → real Stripe test purchase → account provisioned → OTP sign-in → badge → check-in scan | D |
| 6.5 | Correct the three false doc comments C found, and restate the "173 screens read real data" claim in `ROADMAP.md` and `apps/organizer/README.md` | A, C |

---

## 6. Sequencing

Wave 0 is strictly first — 0.7 (form vocabulary) and 0.8 (upload) are what make
Waves 2–5 cheap, and 0.9 must precede 2.2–2.4 or the speaker editor corrupts the
agenda on its first save.

After that, Waves 1–4 parallelise across agents with these edges:

- 1.1 → 1.4 (do not remove the demo provisioning until the real one works)
- 0.5 → 1.2, 1.3 (OTP sign-in needs the functions deployed)
- 0.9 → 2.2, 2.3, 2.4
- 0.8 → 2.6, 5.1
- 4.1 ⊃ 5.6 (same defect, different screens)

Wave 5 is breadth and follows the foundations. Wave 6 gates the claim of done.

---

## 7. Standing constraints

- **No money is spent.** §3 is a prerequisite, not a follow-up.
- **No Claude attribution** in any commit or PR.
- Everything written to a file is in **English**.
- `nav.ts` wins over the research archive on IA questions.
- Never spell a collection name as a string literal — use `@kgc/shared`.
- Never construct a Firestore sentinel inside `@kgc/scripts` (three copies of
  `firebase-admin`; `instanceof` fails across them and takes the whole write
  down).
- New gap notes use `GapPanel` / `GapTag`, never a bare `Panel`.
- Before writing reassuring microcopy, exercise the path. **Fourteen** cases of
  the app claiming a capability it does not have have been found here, three of
  them introduced by agents cleaning up the other eleven.

---

## 8. Progress log

Updated as waves land. Every ✅ here was verified by running the check, not by
an agent asserting it.

### Done

| # | Task | Evidence |
|---|---|---|
| 0.3/0.4 | Functions hardened — per-function `maxInstances`, explicit `minInstances: 0`, per-IP OTP limits, agenda debounce + bulk-import circuit breaker, duplicate-push ownership settled | `test:functions` **40 green** (baseline was 32, not the 14 our docs claimed) |
| 0.7 | Form vocabulary — 18 components in `(dash)/form.tsx` | organizer typecheck + build clean |
| 0.8 | Upload path — `lib/uploads.ts`, `components/image-field.tsx`, wired to exhibitor logos | Verified against the Storage emulator, 14 assertions |
| 0.9 | Denormalisation fan-out + reconcile | `test:denormalise` **25 green** |
| 2.1 | Session create, 22 new fields, `SpeakerDoc.sessionIds` index | `test:programme` **94 green** (was 66) |
| 2.2/2.3/2.4 | Speaker, track and room editors, all wired to the fan-out | organizer typecheck clean |
| 3.2/3.3 | Currency and sold-out state on `/tickets` | web build clean, both branches exercised |
| 4.2 | Dashboard announcements now reach the website | 3 live documents rendered on `/` |
| 4.6 | `/speakers` source made an explicit switch; readiness screen no longer reports on a page it does not drive | both halves done |
| 4.8 | Dead `localhost` preview links | typecheck clean |
| 4.9/4.10/4.12 | App: `deletedAt` parity, honest poll tallies, client-side upvote/reaction counts | `npm test` **157 green** (was 119) |

### In flight

Website CMS + settings reader + sponsor-logo retirement · the `exhibitorListings`
mirror trigger · organizer messaging + the session/speaker/track CSV importer.

### Done since the first log

| # | Task | Evidence |
|---|---|---|
| 1.1 | ★ **The real Stripe path provisions the account** — Auth user, `registered` claim, profile and directory entry, no password. Replay-safety demonstrated with real signed events, not asserted. | `test:commerce` **62 green** (was 16) |
| 1.2 | OTP code delivery by email, reusing the shared sender | `test:functions` **46 green** |
| 1.3 | ★ **OTP sign-in in the app**, anti-enumeration property preserved and pinned | 8 emulator tests, both Expo exports |
| 2.5/2.6 | Sponsor CRUD — 0 of 13 fields → all 13, logos through Storage, CSV import | Emulator-verified, 20 assertions |
| 3.1–3.10 | Ticketing specs: `groups` editable, sold-count correctable, sales window timezoned | `test:commerce` 62 |
| 3.11/4.4 | One-click unsubscribe (RFC 8058) and the public exhibitor listing | Both exercised against the live project |
| 4.1/5.6 | `settings` given a typed contract; **three of six keys deleted** rather than wired | Gotcha 9 proven by control experiment |
| 4.3 | Surveys have an attendee surface | `test:rules` 182 |
| 4.5 | Gatherings — the projection's *reader*; the writer is blocked on a modelling gap | — |
| 5.3/5.7 | Per-session attendance, and **zero disabled controls left** in six directories | `test:attendance` 10 green |
| FU-20 | The emergency card on a phone, behind a one-key rule | Both verbs tested |

### Still to do

**1.4–1.8 — demo-mode removal itself.** Both prerequisites are now met, so this
is next. · 2.8 importer · 4.7 CMS · Wave 5.2/5.4/5.5 · Wave 6 verification and
the documentation pass.

### Final verification — 2026-08-31, every command run on the integrated tree

| Check | Result |
|---|---|
| `npm test` | **241 passed** (was 119) |
| `npm run test:programme` | **149 passed** (was 66) |
| `npm run test:rules` | **182 passed** (was 143) |
| `npm run test:functions` | **55 passed** (was 32; documented as 14) |
| `npm run test:commerce` | **62 passed** (was 16) |
| `npm run test:denormalise` | **25 passed** (new) |
| `npm run test:attendance` | **10 passed** (new) |
| `npm run test:programme-import` | **9 passed** (new) |
| `npm run smoke` | ✓ **all 173 screens render** |
| typecheck × 4 workspaces | clean |
| `apps/web` build | 83 pages |
| `npx expo export` ios + android | both exported |

**584 distinct tests**, from 358 at the start. ⚠️ Every documented count in this
repo was wrong at some point today — three agents were handed stale figures from
`AGENTS.md`. Run the suite; do not quote a doc.

### Bugs found that no audit predicted

1. ★ **`x || undefined` on a merge write can never clear a field** — silent data
   loss that reports success. Two live instances. Now `AGENTS.md` gotcha 9.
2. **`.whova-form-row` matched no CSS rule** while being used 90 times across 17
   editors.
3. **`.whova-btn-main.danger` did not exist**, so the *refund* button rendered as
   an unstyled transparent box.
4. **`onAnnouncementCreate` crashed twice per test run** — `if (!snap) return`
   guards the snapshot but not `snap.data()`.
5. ~~A tier created from the dashboard could never include workshops.~~
   **RETRACTED — this one was not real.** Audit A reported it, and the ticketing
   agent found the form already carries both entitlement checkboxes and the
   action already reads them. The gap-note bullet still asserting it has been
   deleted. What *is* still missing is narrower: nothing writes
   `users/{uid}/entitlements`, so the checkboxes are honoured nowhere.
6. ⚠️ **Audit E's own recommendation for the poll tallies was wrong** — the read
   it proposed is denied to attendees by `firestore.rules:470`. Caught by
   verifying against the rules instead of implementing the suggestion.
7. **`Date.parse('not a time:00Z')` returns a finite number in V8, not `NaN`.**
   A malformed `startsAtLocal` produced a 14,380,440-minute session — **239,674
   hours on an attendance certificate**.
8. ★ **The `List-Unsubscribe` header pointed at the page route, not the API
   route.** Gmail POSTs to whatever that header names; a POST to the page
   returned **HTTP 200 and did nothing**, so Gmail would have shown the
   recipient "Unsubscribed" while they stayed on the list. Invisible to
   typecheck, to the build, and to reading the code.
9. ★ **The shared email sender silently wrote no log rows at all.** `send()`
   spread four optional fields into every `emailLog` entry as `undefined`, which
   Firestore rejects — and the logger catches its own errors by design. It only
   ever worked because both existing callers set `ignoreUndefinedProperties`.
   Delivery would have "worked" in production while the log stayed empty.
10. **A stored-XSS hole on the public site.** The sponsor `website` field flows
    into an `href` on the marketing page and into `Linking.openURL` in the app,
    unsanitised on all three surfaces. A `javascript:` URL typed in the
    dashboard would have been stored script on a public page.
11. **The third instance of the thread-id claim**, which `AGENTS.md` says is by
    definition a bug. Found in a `@kgc/shared` docblock.
12. **A refund guard that could not have worked.** Stripe reports the same
    cumulative `amount_refunded` on every delivery, so `fullyRefunded` is true
    on every replay — the guard has to read the order's prior status instead.

### The pattern in those twelve

Nine of the twelve were invisible to `tsc`, to `next build`, and to reading the
code carefully. They were found by *running the path* — POSTing the header a
mail client would POST, replaying a signed webhook three times, clearing a field
and reading the document back. That is the argument for the verification
discipline in §5 Wave 6, and it is the single most transferable finding of this
session.
