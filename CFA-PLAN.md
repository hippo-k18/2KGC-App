# Call for Abstracts — build plan

Written 2026-08-31. Supersedes the "clearest case for not building it" conclusion
on `Content > Call For Speakers/Abstracts`, which was correct while the
programme committee ran on a spreadsheet and is not the owner's priority any
more. That screen's own sizing (15–20 days, four pieces) is the floor, not the
scope: it costed a minimum viable portal, and §12 of
`whova-rebuild/research/02-organizer-backend.md` — 31 help articles — is what
Whova actually ships.

## 0. What this is, in one paragraph

A **second public surface** with its own audience. The people who use it hold no
ticket, have no account, and may never attend. They write a title and an
abstract; reviewers who are a third class of user score them against a rubric;
organizers accept or reject; accepted work becomes a session and a speaker on
the agenda. Every one of those clauses is a system, not a screen — and the
identity model is the part that will hurt, not the form.

## 1. The three things that must be decided before any code

These are not implementation details. Each one changes the schema, and each is
much cheaper decided now than retrofitted.

### 1.1 Blind review: none, single, or double?

**Recommendation: build for double-blind, run it single-blind by default.**

Anonymity is not a UI preference — it determines *what the submissions
collection may contain* and *who may read which fields*. If author identity has
to be hidden during scoring, then author name, affiliation and email cannot live
on the document a reviewer reads. That means either a two-document split
(`submissions/{id}` and `submissions/{id}/identity`) or field-level redaction at
the read boundary. Retrofitting either onto a flat document is the rewrite this
plan exists to avoid. KGC is an applied-industry conference where affiliation is
often load-bearing, so the *default* should be single-blind; the schema should
not assume it.

### 1.2 Does the submission form freeze on first submission?

Whova's does — *"if at least 1 submission has been made you cannot edit the
submission form anymore"* — and its own research notes call it a known pain
point, brutal for a call that runs for months.

**Recommendation: version the form instead of freezing it.** Each submission
stores `formVersion`, the same pattern `consentForms` already uses for exactly
this reason (`firestore.rules` reads the parent form so a signature is pinned to
the wording that was actually published). Adding a question is then allowed and
old submissions simply have no answer for it; *changing or removing* one mints a
new version. This is strictly better than Whova and costs a field.

### 1.3 Is a speaker a fourth registration product?

`research/02-organizer-backend.md:25` is explicit that Whova is four largely
separate registration products — Attendee, Exhibitor, Sponsor, and **Speaker via
Call for Speakers** — each with its own ticket types, question forms,
confirmation emails, discount codes and order tables.

**Recommendation: no, not in phase 1.** An accepted speaker gets a comped
`ticketTypes` entry with `audience: 'speaker'` and goes through the existing
purchase path at zero. Building a fourth parallel registration product to get a
free ticket is the single largest way this scope inflates, and the research
itself notes CFS accept/reject "isn't ticketing" (`:638`).

## 2. Data model

Five new collections. All server-owned: **no `match` block in
`firestore.rules`**, every write through the Admin SDK, same posture as
`orders` and `ticketTypes`.

| Collection | Key | Holds |
|---|---|---|
| `calls/{callId}` | slug | One call for abstracts: title, instructions, open/close dates, session types, tracks, the form definition and its version history, reminder schedule |
| `submissions/{id}` | minted | Title, abstract, track, session type, answers, status, `callId`, `formVersion`, `submitterToken` hash |
| `submissions/{id}/identity` | fixed doc | Author name, affiliation, email, co-authors. Separate so blind review is a read decision, not a rewrite (§1.1) |
| `submissions/{id}/reviews/{reviewerId}` | reviewer uid | Per-criterion scores, comments, confidence, conflict declaration |
| `reviewers/{id}` | minted | Name, email, topics, assignment load, invitation state. **Not** `users` — a reviewer need not hold a ticket |

Two fields carry the whole state machine:

- `submissions.status` — `draft` → `submitted` → `under-review` →
  `accepted` | `rejected` | `withdrawn`. `draft` is not optional: Whova's
  Incomplete Submissions tab exists because most of the work of running a call
  is chasing people who started and stopped.
- `submissions.decision` — `{ by, at, round }`, absent until made, so
  "undo decision" is a delete rather than a second boolean.

**`eventId` leads every document and every composite index.** Firestore cannot
add a field to an existing index, so getting this wrong is a full rebuild and
backfill (AGENDA: this is already the house rule; it is repeated because a new
collection is exactly where it gets forgotten).

## 3. The identity problem, and how it is solved

This is the piece that is genuinely hard and the reason the screen's own
estimate put the portal first.

`isRegistered()` — the `registered` custom claim — is the gate for everything in
`firestore.rules`. A prospective speaker does not have it and must not get it:
the claim is minted only for ticket holders, and a submission portal that
requires a ticket is not a call for papers.

Three classes of person need access, and each gets a different mechanism:

- **The submitter.** A **capability token**, the pattern `/order/{token}`
  already proves — an HMAC over the submission id, mailed to them, giving them a
  URL that resolves to their own draft and nothing else. `scripts/src/lib/
  order-token.ts` and `consent-token.ts` are the two working examples; this is a
  third of the same shape. No account, no password, no Firebase Auth user.
  Writes go through a server action, never a client write.
- **The reviewer.** Also token-first, for the same reason — a reviewer is often
  an external academic who will log in twice in their life. A `reviewers`
  document plus a signed link beats provisioning accounts, and it keeps the
  `roles` claim meaning what it means today. ⚠️ If reviewers later need a real
  session, they become a `roles: ['reviewer']` claim, and the claim minting path
  already exists in `scripts/src/set-claims.ts`.
- **The organizer.** Already solved. Dashboard screens under
  `Content > Call For Speakers/Abstracts`, behind `requireOrganizer()`.

## 4. Phases

Each phase is shippable on its own and leaves the product in a coherent state.
Estimates are working days for one person and assume the decisions in §1 are
made first.

### Phase 1 — Collect submissions · 6–8 days

The call exists, people can submit, organizers can read what came in. No review,
no decisions.

- `calls` schema + a setup screen (title, dates, tracks, session types)
- The form builder — **shared with Question Forms**, which needs the same thing.
  Building them separately is how a codebase ends up with two. Field types:
  short answer, paragraph, multiple choice, checkbox, description, consent.
- Public portal in `apps/web`: `/submit/{callId}`, plus `/submit/{token}` to
  return to a draft
- Submission-token mint/verify in `@kgc/scripts/src/lib/`
- Submissions list in the dashboard: status filter, search, view one
- Admin notification email on each submission (the bulk sender already exists)

⚠️ **Deadline enforcement is server-side or it is nothing.** A closed call must
refuse the write in the server action, not hide the button.

### Phase 2 — Chase the incompletes · 3–4 days

The unglamorous half that decides how many submissions you actually get.

- `draft` submissions surfaced in their own tab, filterable by how far along
  (title only vs. abstract written), searchable by name, email, affiliation
- Bulk "send a nudge" into the existing mail path
- Scheduled reminders at 2 weeks / 1 week / 3 days before close
- Deadline extension prompts the ready-made email to incomplete submitters

⚠️ Reminder scheduling wants Cloud Tasks, and `functions/` is blocked on one IAM
grant (`OWNER-ACTIONS.md` §3). Until that lands, reminders are a dashboard
button an organizer presses — which is honest, and should say so on screen
rather than appear automatic.

### Phase 3 — Review · 6–8 days

The largest phase and the one with the real rules work.

- `reviewers` collection, invitation by email with a token link
- Assignment: manually, by topic, and randomly
- Conflict-of-interest declaration and exclusion
- A configurable rubric — criteria with score ranges, plus free-text comments
- The review screen, **hiding other reviewers' scores until yours is entered**.
  This is a rule enforced server-side, not a UI preference.
- Reviewer progress tracking and a reminder button
- Organizer view: sort and rank by average score, per criterion

### Phase 4 — Decide and announce · 4–5 days

- Accept / reject / undo, individually and in bulk
- Templated acceptance and rejection mail (cheapest piece — the bulk sender is
  built and `emailLog` already records what went out)
- **Promotion into the agenda.** ⚠️ Note that Whova's marketing claims this is
  automatic and its help centre says the opposite — *"Accepting a speaker
  submission will not automatically synchronize with your Agenda"* — and the
  help centre is right. Build it the way the help centre describes: an explicit
  `Add a Session > From Accepted Submissions` step in Session Manager, because
  scheduling is a decision about rooms and times that acceptance does not make.
  It must reuse `speakerId(name, company)` so an accepted author who already
  exists as a speaker updates that document rather than duplicating it.

### Phase 5 — Confirmation and exports · 3–4 days

- Speaker confirmation form: deadline, confirm/decline, consent agreement, up to
  five custom questions, attached to the acceptance email
- Manage confirmations: confirmed / declined / pending, reminders, download
- Two exports, and they are two on purpose: one plain-text for the committee to
  read, one HTML-preserving so formatting survives import into Session Manager
- Reviews export: scores per criterion, per reviewer, with comments

**Total: 22–29 days.** The screen's 15–20 was phases 1, 3, 4 and the form
builder with nothing around them.

## 5. Explicitly out of scope

Named so nobody has to rediscover that they were considered. All of these are
things Whova does **not** do either (`research §12.10`):

- Camera-ready / final-paper upload with versioning and deadlines
- Proceedings, DOI minting, ISBN, copyright transfer — the poster track already
  goes to CEUR-WS and should keep going there
- Reviewer bidding (reviewers expressing preferences)
- Rebuttal / author-response rounds
- PC chair hierarchy — meta-reviewers, area chairs
- Plagiarism or similarity checking
- Dual simultaneous calls. The schema supports it (`callId` is on every
  submission); no screen will, in phase 1.

## 6. What this replaces

`npm run import:whova` reads a CSV of accepted talks and writes sessions and
speakers. It is real, it is used, and it starts *after* every decision has
already been made in a spreadsheet. It should keep working after this ships —
a call for abstracts is not a reason to lose the ability to import a programme
somebody assembled elsewhere.

The website currently sends poster submissions to EasyChair
(`apps/web/src/app/call-for-posters/page.tsx:62`). That link should stay until
phase 4 is live: half a pipeline is worse than an external one that works.

## 7. Open questions for the owner

1. Single-blind or double-blind for KGC 2027? (§1.1 — decides the schema)
2. How many reviewers, roughly? Three per submission at 200 submissions is 600
   reviews; that number changes whether assignment can be manual.
3. Does an accepted speaker get a free ticket, a discounted one, or neither?
   (§1.3 — decides whether `ticketTypes` needs a speaker audience)
4. Is there a separate poster call, or one call with a session-type field?
