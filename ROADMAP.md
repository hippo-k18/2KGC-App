# What is left to reach Whova parity

Measured against the working tree on **2026-08-25**, not against the older
`whova-rebuild/STATUS.md` — which is from 16 August and is stale in several
places (it says `apps/console` does not exist and that nothing is committed;
both were true then and are not now).

---

## The honest numbers

Updated **2026-08-25**. **Every leaf screen in Whova's navigation tree now
exists and renders.**

| | Count |
|---|---:|
| Nav paths in Whova's tree | 215 |
| — of which section headers, not screens | 42 |
| **Real screens** | **173** |
| **Built and rendering** | **173** |
| Remaining | **0** |

`npm run smoke` boots the emulator, seeds it, builds the dashboard and requests
every registered path. All 173 return 200 against real data with no server-side
throw. That is the check; it takes one command.

### ⚠️ What "built" means, because the number alone is misleading

Roughly **a third read and write real data**: the money path end to end, the
programme, attendees, exhibitors, the team checklist, surveys, moderation,
exports, imports, name badges.

The rest are **honest gap notes** — what Whova does on that screen, what this
repo would need, and roughly how big that is. That is deliberate. An organizer
evaluating the move can click any nav item and get a straight answer rather
than a spinner, an empty table, or a feature that half-works; an empty state
implying "this nearly works" is worse than one that names the gap.

**So the parity number is not 100%.** By nav coverage it is complete. By
capability it is closer to a third, and the sections below are still the plan
for the rest.

| Tab | Screens | Substantially real |
|---|---|---|
| Tickets | 53 | Money path, catalogue, orders, refunds, discounts |
| Content | 34 | Agenda, speakers, sponsors, exhibitors, documents, checklist |
| Attendees | 23 | List, check-in, exports, imports, badges, cohorts |
| Marketing | 18 | Webpage readiness reports |
| Engagement | 17 | Announcements, community, matchmaking, surveys, moderation |
| Tools | 12 | App adoption, admin control, board moderation, report |
| Virtual & Hybrid | 11 | None — argued as a candidate to cut |
| Pay | 4 | Balance, billing |
| Publish | 1 | Pre-flight check |

The website is separate: **19 pages, all 17 nav links resolving.** What it lacks
is content management — every page is a React file, so editing the code of
conduct is a deploy. That is Phase 5.

---

## The five things that block everything else

Most of the 111 are not blocked on effort. They are blocked on one of five
missing capabilities, and unblocking a capability makes a whole cluster cheap at
once. This is the single most useful way to read the list.

| Blocker | Screens behind it | Status |
|---|---:|---|
| **1. An email sender** | ~14 | ✅ **Unblocked, and spent** |
| **2. Cloud Functions (Blaze plan)** | ~22 | ❌ Project is on Spark |
| **3. File upload + image pipeline** | ~18 | ❌ Storage rules exist, no UI |
| **4. A generic entity CRUD + importer** | ~40 | ⚠️ **Export half built**; importer still missing |
| **5. Streaming infrastructure** | ~15 | ❌ And arguably out of scope |

★ **Blocker 1 fell as a side effect of building ticket receipts**, which is why
Message Speakers and Message Sponsors were built this week for a fraction of
the 4–6 days `gaps.ts` estimated. The remaining message screens — Exhibitors,
Presenters, Team Members — are now roughly a day each.

★ **Blocker 4 is the highest-leverage thing on this page.** Exhibitor Manager,
Artifact Manager, Fair Manager, Documents, Meet-ups, Discussion Topics, Social
Groups and a dozen more are all the same screen over a different collection:
list, filter, sort, page, edit, import CSV, export CSV. Written generically
once — about two weeks — each of them becomes half a day instead of four days.
Written one at a time, that cluster alone is four months.

---

## Sequencing

### Phase 1 — ✅ done

The messaging screens the email sender unblocked are built. What remains of this
phase is three more of the same, now roughly a day each because the audience
abstraction exists: `message-exhibitors`, `message-presenters`,
`message-team-members`, plus `1-3-confirmation-emails` to edit the receipt copy.

### Phase 2 — the generic table · ~2 weeks, then everything is cheaper

Build one parameterised CRUD screen (list · search · sort · page · edit ·
CSV in · CSV out) and one generic importer. This is scaffolding, not a feature,
and it is the difference between a six-month tail and a two-month one.

`scripts/src/import-whova.ts` already does the import half for agendas and
speakers; generalising it is most of the work.

### Phase 3 — the rest of Tickets · ~3 weeks

The money path is done; the catalogue around it is not.

- Question forms (custom registration fields) — needs the generic table
- Ticket add-ons, group tickets
- Exhibitor and sponsor ticket catalogues — the model has `TicketAudience`
  already, so these are the same screens filtered
- Refunding an invoice (credit notes)
- `Pay` tab (5 paths) — payout settings, mostly links into Stripe

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

Phase 1 then Phase 2, in that order. Phase 1 is a week of cheap wins that make
the Content tab feel finished; Phase 2 is the two weeks that decides whether the
remaining tail is two months or six.

→ The single highest-value thing is **the generic table in Phase 2.** Everything
after it is faster, and every screen built before it is a screen that will want
rewriting once it exists.

---

## Progress since the last audit

For comparison with `whova-rebuild/STATUS.md` (16 August):

| | Then | Now |
|---|---|---|
| Organizer screens with live data | 9 | **62** |
| Ticketing | external | **in-house, end to end** |
| Transactional email | none anywhere | **built, logged per recipient** |
| CSV exports | none | **six, injection-safe** |
| Website pages | 19, some links broken | **19, all links resolve** |
| Test count | 169 | **222** |
| `apps/console` | superseded, still tracked | **deleted** |

### What the build-out changed about the plan

**Phase 1 is done.** The messaging screens the email sender unblocked are built.

**Phase 2 is half done.** The export side exists — six CSVs behind one registry,
so a seventh is an entry rather than a module. **The importer does not**, and it
is still the highest-leverage thing left: roughly forty screens collapse into
"map these columns" once it exists, and every entity screen built before it will
want revisiting.

**One integration would answer ten screens.** Both Zapier guides land on the same
point: a single outbound webhook on fulfilment lets Zapier fan out to thousands
of products, which is about a day against five to twelve for any individual
integration. The Stripe webhook already has the hook point.
