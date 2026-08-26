# What is left to reach Whova parity

Measured against the working tree on **2026-08-26**. Supersedes the
`whova-rebuild/STATUS.md` audit of 16 August, which is stale in several places.

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
rather than asserting it. "There are 61 images, all hotlinked, 0 uploaded here"
is a fact an organizer can plan around; "photos are not built" was not.

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
| **2. Cloud Functions (Blaze plan)** | ~8 | ❌ Project is on Spark |
| **3. File upload + image pipeline** | ~6 | ❌ Storage rules exist, nothing writes through them |
| **4. A generic entity CRUD + importer** | ~0 | ✅ **Done** — export registry and CSV importer both exist |
| **5. Streaming infrastructure** | ~15 | ❌ And argued as a candidate to cut |

★ **Blocker 4 has fallen**, which was the highest-leverage item on this page for
months. The CSV importer, the export registry and the per-audience screen
components together did what "the generic table" was meant to do — the exhibitor
and sponsor clusters cost days rather than the four months a screen-at-a-time
build would have.

★ **Blocker 3 is now the binding one.** Six screens wait on it: app branding,
banner artwork, exhibitor logos, and the three photo screens. It is also the
cheapest remaining fix with a real payoff — 61 hotlinked images currently break
when somebody else's domain moves.

The website is separate: **21 pages, all nav links resolving**, now including
`/tickets/exhibitor`, `/tickets/sponsor` and `/r/{code}`. What it lacks is
content management — every page is a React file, so editing the code of conduct
is a deploy. That is Phase 5.

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
`marketing/event-webpages/*` generates public pages from event data; ours are
hand-written React files.

- Agenda, speaker, sponsor and exhibitor webpages driven from Firestore
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

→ **Blocker 3 — file upload and an image pipeline.** It is the binding
constraint now that the generic-table work is done, it gates six screens, and it
has a payoff that is worth having on its own: the 61 images this project serves
are all hotlinked to domains KGC does not control, and each one breaks silently
when somebody's blog moves.

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
| Website pages | 19, some links broken | **21, all links resolve** |
| Test count | 169 | **201** |

### What is genuinely different about the remaining work

Every previous audit could say "N screens are unbuilt" and mean "nobody has
written them yet". That is no longer the shape of it. What remains is five
**capabilities**, each gating a cluster, and three of the five are one decision
each rather than a backlog:

- Blaze is a card on file, not money — the free quotas equal Spark's.
- Storage is written and never deployed.
- Streaming is a scope question, not an engineering one.

The screens waiting on them now measure the gap instead of describing it, which
means the next audit can be run by opening them rather than by reading this
file.
