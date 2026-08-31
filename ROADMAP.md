# What is left to reach Whova parity

> ⚠️ **SUPERSEDED, 2026-08-31.** `BUILD-PLAN.md` is the current measurement.
>
> This file counted **screens**. A six-part audit on 2026-08-30 found the
> binding constraint was never screen count but **capability**: the programme
> (`speakers`, `sponsors`, `tracks`, `rooms`) was read by all three surfaces and
> writable by none of them, so the only way to change a speaker's name was to
> re-run the seed. Several numbers below are also wrong in the optimistic
> direction — "8 Cloud Function triggers" is 14 deployable units, "5 of 21
> website pages read Firestore" was 8, and every test count is stale.
>
> Kept because its sequencing argument and its "what I would cut" section still
> hold. Read `BUILD-PLAN.md` first.

**Measured 2026-08-28** against the working tree, by running the checks rather
than reading the previous version of this file. It is the current status
document for the whole project; `whova-rebuild/*` is a research and audit
archive from 15–18 August and is superseded by this file wherever the two
disagree.

## Where the project actually is

| Surface | State |
|---|---|
| **Attendee app** (`app/`) | Five tabs on real Firestore data. Messages behind a header icon. Badge QR → check-in verified end to end. |
| **Website** (`apps/web/`) | 21 pages, all links resolving. Stripe Checkout, Stripe Invoicing, tracked links. **Deployed on Netlify.** |
| **Organizer dashboard** (`apps/organizer/`) | ⚠️ **Superseded — see `BUILD-PLAN.md`.** All 173 render without a throw, but "read real data" was wrong: 39 read nothing. Since 2026-08-31 the programme, sponsors and ticket specs are editable. |
| **Cloud Functions** (`functions/`) | **14 deployable units** — 10 Firestore triggers, 2 Cloud Tasks handlers, 2 public OTP callables. 55 tests, green against the emulator. **Not deployed** — blocked by the `serviceusage` 403, not by Blaze. |
| **Firestore** | Rules, 16 composite indexes and 6 field overrides **live on the real project**. 483 seeded documents, 50 Auth accounts. |
| **Tests** | ⚠️ Stale. **584 passing** as of 2026-08-31 — 241 unit (incl. 149 programme) · 182 rules · 62 commerce · 55 functions · 44 in three new suites. |

### ★ Settled since the last revision

- **The dashboard's gap notes are behind a flag.** 126 "Not built here" panels,
  8 gap cards, 8 grey tags and the sign-in banner render only under
  `SHOW_GAP_NOTES=1`. They are still accurate and still in the source; they are
  simply written for whoever is building this rather than for a demo audience.
  See `apps/organizer/src/lib/gap-notes.ts`.
- **Dashboard sign-in is settled as email + passphrase.** Not a placeholder, and
  no SSO step is coming — the earlier "v0 sign-in / DECISIONS.md #5" framing is
  withdrawn everywhere it appeared. What it costs (no MFA, no audit identity
  beyond the address typed beside the shared secret) is written down in
  `apps/organizer/src/lib/auth.ts` rather than implied.
- **Firestore rules and indexes are deployed.** Applied through
  `scripts/ops/deploy-rules.mjs` and `deploy-indexes.mjs`, because the Firebase
  CLI is refused on this project with a `serviceusage` 403. Docs that still say
  "written but never applied in production" are stale.
- **A demo ticket purchase now provisions a real account** — Auth user,
  `users/{uid}` and `directory/{uid}`, with the `registered` claim — so
  buy-a-ticket-then-open-the-app works in one continuous run. Confined to demo
  mode: it sets a publicly printed shared password. See
  `apps/web/src/lib/app-account.ts`.

### ⚠️ Corrected on 2026-08-28 — three claims here were stale toward pessimism

| Claim | Said | Is |
|---|---|---|
| Website images | "61 hotlinked, 0 uploaded here" | 242 local files in `apps/web/public`, **0** remote image URLs in `apps/web/src` |
| Remaining hotlinks | implied to be on shipped pages | **18**, all sponsor/exhibitor logos on Whova's CDN, in seed fixtures only |
| Website data | "every page is a React file" | **5 of 21** read Firestore: `/`, `/agenda`, `/sponsor`, `/tickets`, `/order/{token}` |
| Phase 5 agenda + sponsor pages | listed as to-do | already Firestore-driven |

---

## The honest numbers

| | Count |
|---|---:|
| Nav paths in Whova's tree | 215 |
| — of which section headers, not screens | 42 |
| **Real screens** | **173** |
| **Built and rendering** | **173** |
| — of which read or write real data | **173** |

`npm run smoke` boots the emulator, seeds it, builds the dashboard and requests
every registered path. All 173 return 200 against real data with no server-side
throw. That is the check; it takes one command.

### ★ What changed on 2026-08-26

**The thirty `GapScreen` stubs are gone.** Every screen in the dashboard now
reads or writes real data. `gap-screen.tsx` — the shared shell those stubs used
— is deleted, because nothing renders it any more.

That is not the same as "Whova parity is complete", and the sections below are
still the plan. What it means is narrower and worth stating precisely: **there
is no longer any screen whose entire content is a description of itself.**
Where a capability genuinely does not exist — no file upload, no camera, no app
surface for joining a table — the screen now measures the gap against live data
rather than asserting it. "There are N images, M of them on somebody else's
server, and 0 uploaded here" is a fact an organizer can plan around; "photos are
not built" was not. (Those counts come from live data — see
`apps/organizer/src/lib/images.ts`. An earlier version of this paragraph froze
them at 61 and was wrong within two days.)

### What was built, and what it unblocked

| Cluster | What it took |
|---|---|
| **Exhibitor & sponsor ticketing** (15 screens) | `listTiers()` filtered to attendees unconditionally, so an organizer could price a booth and no buyer could reach it. `/tickets/exhibitor` and `/tickets/sponsor` are real pages now. `OrderRow` dropped `ticketTypeId`, which is why three ledgers could describe a join they could not perform. |
| **Booth allocation** (new model) | `booths/{number}` — a ticket type sells "a 3m × 2m booth", this is the particular one. The only allocation in the product that is transactional rather than an optimistic counter, because two companies who shipped a stand for one space cannot both be refunded into being happy. |
| **Offline payment & comps** | One write, two screens. Issues a ticket against money this system cannot verify, so `channel: 'manual'`, the organizer's name and a required reason all live on the order document. |
| **Ticket marketing** (7 screens) | Contacts, tracked links, and attribution that survives the Stripe redirect via a cookie → metadata → webhook hop. The redirect counts its own clicks, so none of it waits on Blaze. |
| **Question forms** (3 screens) | Asked before checkout on our own page, held in `pendingAnswers`, copied onto the *registration* at fulfilment — never onto the order. 18 tests, because it gates the purchase path. |
| **Round tables & meeting rooms** | One `gatherings` model. An organizer's plan, not an attendee feature, and the screens say so. |
| **Speed networking** | The circle method: everybody meets everybody exactly once. 14 tests prove the no-repeat guarantee rather than a comment claiming it. |

### ⚠️ What "built" still does not mean

Five capabilities remain genuinely absent, and the screens that need them now
*measure* their absence instead of describing it:

| Blocker | Screens behind it | Status |
|---|---:|---|
| **1. An email sender** | ~14 | ✅ **Unblocked, and spent** |
| **2. Cloud Functions** | ~8 | ⚠️ **10 functions written, 32 tests green, not deployed** — Blaze |
| **3. File upload + image pipeline** | ~6 | ❌ Storage rules exist, nothing writes through them |
| **4. A generic entity CRUD + importer** | ~0 | ✅ **Done** — export registry and CSV importer both exist |
| **5. Streaming infrastructure** | ~15 | ❌ And argued as a candidate to cut |

★ **Blocker 4 has fallen**, which was the highest-leverage item on this page for
months. The CSV importer, the export registry and the per-audience screen
components together did what "the generic table" was meant to do — the exhibitor
and sponsor clusters cost days rather than the four months a screen-at-a-time
build would have.

★ **Blocker 2 moved while this was being written**, and the correction matters:
the aggregate triggers are no longer unbuilt. `functions/` holds them with 14
tests, and they run against the **emulator**, which needs no Blaze plan —
`BACKEND-ROADMAP.md` makes the point that everything through its Phase 4 is free
and local. What Blaze buys is *deployment*. So the eight screens behind this are
waiting on a card on file rather than on code, which is a different kind of
blocked and a much cheaper one.

★ **Blocker 3 still gates six screens** — app branding, banner artwork,
exhibitor logos and the three photo screens — but the argument that made it the
top of this list has expired. **Re-measured 2026-08-28:**

- `apps/web/public` holds **242 image files** and `apps/web/src` contains
  **zero** remote image URLs. The website is not hotlinking anything. The
  speaker roster says so explicitly in `lib/speakers-2026.ts`: 124 portraits,
  all local, `width`/`height` read back from the bytes.
- The hotlinks that remain are **18 unique sponsor and exhibitor logos** on
  Whova's own CDN (`d1keuthy5s86c8.cloudfront.net`), and they live in
  `scripts/src/lib/fixtures.ts` and `apps/organizer/src/lib/demo/fixture.json`
  — **seed data, not shipped pages**.

So the payoff that was doing the persuading here — "61 hotlinked images break
when somebody's domain moves" — has largely already been banked, and what is
left of it is demo fixtures pointing at the product being replaced. Upload is
still the thing those six screens need; it is no longer the thing standing
between this site and a broken page.

The website is separate: **21 pages, all nav links resolving**, now including
`/tickets/exhibitor`, `/tickets/sponsor` and `/r/{code}`. **Five of the 21
already read Firestore** — `/`, `/agenda`, `/sponsor`, `/tickets` and
`/order/{token}` — so "every page is a React file" is no longer true of the
pages that change most often. The sixteen that remain static are the ones whose
content is prose: the code of conduct, the CFP, the team page. Editing those is
still a deploy, and that is Phase 5.

---

## Sequencing

### Phase 1 — ✅ done

### Phase 2 — ✅ done, by a different route than planned

The plan was one parameterised CRUD screen. What actually happened was the CSV
importer plus the export registry plus a per-audience component per screen
family — `audience-catalogue`, `audience-orders`, `audience-registration`,
`question-form-screen`, `gathering-screen`. Same effect, and arguably better:
each family shares the code that would drift, and none of them pretends five
different entities have the same columns.

### Phase 3 — the rest of Tickets · ~1 week remaining

The money path, the catalogue, the three audiences, question forms, booths,
offline payment and payouts are all done. What is left:

- **Group tickets** beyond the invoice path
- **Ticket add-ons as products** — the attendee case genuinely needs them (a
  dinner and a workshop day are independent, and a tier per combination is a
  combinatorial price list). The Checkout session builds exactly one line item
  with `quantity: 1`, so this changes the purchase path's shape.
- **Refunding an invoice** (credit notes — a different Stripe API)
- **A public unsubscribe link** — ⚠️ legally required in several jurisdictions
  before a bulk campaign goes out, and the mechanism already exists as
  `/order/{token}`

### Phase 3.5 — sign-in, settled rather than remaining

Not a phase of work; a phase closed by a decision on 2026-08-28. Dashboard
sign-in **stays** an email allowlist plus a shared passphrase. Google SSO with
enforced MFA was on this list for months and is now off it: one event, four
organizers, and an identity provider is a second failure mode in front of a tool
that is already behind a private URL. Nothing here is waiting on it any more.

### Phase 4 — Attendees and Engagement · ~2 weeks remaining

Analytics and exports, the community views, surveys, session feedback, board
moderation, admin control and code access are **all built**. What is left here:

- Moderator tools for photos and session chats — neither feature exists in the
  app, so there is nothing to queue
- Name badges and certificates — the highest-value pair remaining in this tab
- Check-in variants: self check-in, kiosk, session self check-in, checkout
- Volunteers, release and consent forms

⚠️ Live polling and Q&A tallies sit behind **blocker 2**. They render in the app
today and their counters never move. Upgrading to Blaze is a card on file, not
money — Blaze's free quotas equal Spark's.

### Phase 5 — Marketing and the website CMS · ~4 weeks

This is where the *website* half of parity lives. Whova's
`marketing/event-webpages/*` generates public pages from event data. Ours are
mostly hand-written React files — **5 of 21 pages already read Firestore**, and
the sixteen that do not are the prose ones.

- ✅ **Agenda and sponsor webpages are already Firestore-driven** — `/agenda`
  calls `listAgenda()` and `/sponsor` calls `listSponsorsByTier()`. Verified
  2026-08-28; this bullet listed them as pending and was wrong.
- The **speakers page is deliberately not** driven from Firestore, and this is
  not a gap to close. `listSpeakers()` exists and works; `/speakers` ignores it
  on purpose, because the seeded `speakers` collection holds invented names and
  the page is public. It renders the real KGC 2026 roster instead, and says so.
  The day a real 2027 programme exists in Firestore, swapping the import is the
  whole change — see the docblock in `apps/web/src/app/speakers/page.tsx`.
- Exhibitor webpage from Firestore — still to do
- Prose pages from a CMS: code of conduct, CFP, team, about
- Branding centre (colours, logo, banner) — needs **blocker 3**
- Social wall, social media centre

### Phase 6 — the long tail

- **Virtual & Hybrid (15)** — needs **blocker 5**. For an in-person conference
  at Cornell Tech this is the most deferrable cluster on the list, and possibly
  one to cut rather than build.
- **Artifact Center, Fair Center, Passport Contest, Gamification** — real
  features, low value for KGC's format.
- **Whova Listing, Organizer Co-Promo (4)** — ❌ **not applicable.** These
  market your event inside Whova's own marketplace. There is no marketplace to
  list in, and building one is not parity, it is a different product.
- **Six connection guides** (MemberClicks, iMIS, YourMembership, Neon CRM,
  HubSpot, Zapier) — these are **documentation pages in Whova, not features**.
  They are static help text. Cheap, and worth doing only if KGC actually uses
  one of those systems.

---

## What I would cut

Parity is the stated destination, and reaching it literally means building
things that make no sense for this event. Stating them plainly is more useful
than quietly skipping them:

- **Whova Listing and Co-Promo** — advertises your event inside Whova. Not
  reproducible and not wanted.
- **Virtual & Hybrid** — 15 screens of streaming infrastructure for an event
  whose value is being in the room. The `virtual` ticket tier streams sessions;
  that is a different and much smaller job.
- **Passport Contest, Exhibitor Trivia, Attendance Gamification** — trade-show
  mechanics for a research conference.
- **Attendee Limit Upgrade** — a Whova billing screen. We have no tiers to
  upsell.

Cutting those removes roughly **26 screens** from what is left, taking the real
remainder from 111 to about **85**.

---

## Recommended next slice

→ **Blocker 3 — file upload and an image pipeline.** It gates six screens and it
is the largest remaining capability. ⚠️ Note that its second argument no longer
holds: the website's 242 images are local, and the 18 hotlinks left are sponsor
logos in seed fixtures. Pick this because the six screens are worth having, not
because something is about to break.

Two things after it, in this order and for different reasons:

- **A public unsubscribe link.** ⚠️ Small, and legally required in several
  jurisdictions before the first bulk campaign goes out. The mechanism already
  exists — `/order/{token}` is the same capability-token pattern.
- **Name badges and certificates.** The highest-value unbuilt pair in the
  Attendees tab, and the one an organizer notices on the morning of day one.

---

## Progress since the last audit

For comparison with `whova-rebuild/STATUS.md` (16 August):

| | Then | Now |
|---|---|---|
| Organizer screens with live data | 9 | **173** |
| Screens that were only a gap note | 164 | **0** |
| Ticketing | external | **in-house, three audiences, end to end** |
| Transactional email | none anywhere | **built, logged per recipient, plus campaigns** |
| Campaign attribution | none | **click → cookie → Stripe metadata → order** |
| Registration questions | none | **asked before checkout, stored on the registration** |
| CSV exports / imports | none | **six exports, generic importer** |
| Website pages | 19, some links broken | **21, all links resolve, 5 Firestore-driven** |
| Cloud Function triggers | 0 written | **10 written, 32 tests, awaiting Blaze to deploy** |
| Rules and indexes in production | none applied | **rules + 16 indexes + 6 overrides live** |
| Deployment | localhost only | **both sites on Netlify, app hosted on the web** |
| Buying a ticket | wrote a registration and stopped | **also provisions the account that signs into the app**, on the Stripe webhook, with no password |
| Tests | 169 | **358** — 119 unit · 66 programme · 143 rules · 16 commerce · 14 triggers |

### What is genuinely different about the remaining work

Every previous audit could say "N screens are unbuilt" and mean "nobody has
written them yet". That is no longer the shape of it. What remains is five
**capabilities**, each gating a cluster, and three of the five are one decision
each rather than a backlog:

- Blaze is a card on file, not money — the free quotas equal Spark's, and the
  eight triggers it would deploy are already written and tested against the
  emulator.
- **Firestore** rules and indexes are live now; **`storage.rules` still is not**,
  and nothing writes through it either — that pair is blocker 3, and neither half
  is useful without the other. `scripts/ops/deploy-rules.mjs` publishes
  `cloud.firestore` only, so pushing storage rules needs a second release target.
- Streaming is a scope question, not an engineering one.

The screens waiting on them now measure the gap instead of describing it, which
means the next audit can be run by opening them rather than by reading this
file.
