# What is left to reach Whova parity

Measured against the working tree on **2026-08-25**, not against the older
`whova-rebuild/STATUS.md` — which is from 16 August and is stale in several
places (it says `apps/console` does not exist and that nothing is committed;
both were true then and are not now).

---

## The honest numbers

`apps/organizer/src/lib/nav.ts` transcribes Whova's own navigation tree from
their shipped bundle: **215 paths**. That figure overstates the work, because
42 of them are section headers rather than screens.

| | Count |
|---|---:|
| Nav paths in Whova's tree | 215 |
| — of which section headers, not screens | 42 |
| **Real screens** | **173** |
| Built and reading live data | **17** |
| **Remaining** | **156** |

By tab, built / total paths:

| Tab | Built | Note |
|---|---|---|
| Content | 8 / 44 | Agenda, speakers, sponsors done; exhibitors and artifacts untouched |
| Tickets | 5 / 60 | The money path is done; 3 parallel catalogues are not |
| Attendees | 2 / 28 | List and check-in done |
| Engagement | 1 / 21 | Announcements only |
| Tools | 1 / 16 | Report only |
| Marketing | 0 / 25 | Nothing |
| Virtual & Hybrid | 0 / 15 | Nothing |
| Pay | 0 / 5 | Nothing |
| Publish | 0 / 1 | Nothing |

The website is separate and in much better shape: **19 pages, and all 17 links
the nav declares resolve.** There are no broken pages. What it lacks is
content-management — every page is a React file, so editing the code of conduct
is a deploy. That is Whova's `marketing/event-webpages/*`, listed below.

⚠️ **This is a multi-month programme, not a sprint.** At a sustained pace of
roughly one screen a day — which is optimistic for the ones needing new data
models — 156 screens is six to eight months of solo work. The sequencing below
matters more than the total.

---

## The five things that block everything else

Most of the 156 are not blocked on effort. They are blocked on one of five
missing capabilities, and unblocking a capability makes a whole cluster cheap at
once. This is the single most useful way to read the list.

| Blocker | Screens behind it | Status |
|---|---:|---|
| **1. An email sender** | ~14 | ✅ **Unblocked Aug 2026** |
| **2. Cloud Functions (Blaze plan)** | ~22 | ❌ Project is on Spark |
| **3. File upload + image pipeline** | ~18 | ❌ Storage rules exist, no UI |
| **4. A generic entity CRUD + importer** | ~40 | ❌ Written once per entity today |
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

### Phase 1 — finish what the email sender unblocked · ~1 week

Cheapest possible value, because the hard part already exists.

- `content/exhibitor-center/message-exhibitors`
- `content/artifact-center-.../message-presenters`
- `content/project-management/message-team-members`
- `tickets/ticket-setup/1-3-confirmation-emails` — edit the receipt copy
- `engagement/session-feedback` — post-session survey mail

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

### Phase 4 — Attendees and Engagement · ~4 weeks

- Attendee analytics and exports
- Meet-ups, discussion topics, social groups — generic table again
- Surveys, session feedback
- Moderator tools (photos, chats, board, Q&A)
- Admin control, code access

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

Cutting those removes roughly **28 screens**, taking the real remainder from
156 to about **128**.

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
| Organizer screens with live data | 9 | **17** |
| Ticketing | external | **in-house, end to end** |
| Transactional email | none anywhere | **built, logged per recipient** |
| Website pages | 19, some links broken | **19, all links resolve** |
| Test count | 169 | **206** |
| `apps/console` | superseded, still tracked | **deleted** |
