# Audit C — Agenda & Sponsors: can an organizer actually edit them, and does it propagate?

Date: 2026-08-30. Scope: `apps/organizer` (dashboard) → Firestore → `apps/web` (public site) → `app/` (Expo attendee app).
Method: every file below was opened. Nothing here is inferred from `AGENTS.md` prose alone; where a doc comment and the code disagree, that is called out.

## Headline

**No.** One thing on the agenda side is genuinely editable — a single session's title, time, room, status and description — and it is done correctly. Everything else in scope (create a session, delete a session, session speakers, session tracks, tags, format, capacity, every speaker field, every track field, every room field, every sponsor field) is **read-only in the dashboard**. Sponsors and speakers exist in Firestore only because `scripts/src/seed-demo.ts` put them there; there is no dashboard path, no CSV import path and no upload path to change them.

The one exception on the commercial side is **exhibitors and booths**, which do have real create/edit server actions — a different product from sponsors in this data model.

Propagation, where an edit exists, is sound: both downstream readers hit live Firestore (`force-dynamic` on the website, `onSnapshot` in the app), so the dashboard→app hop is the strong part of the chain. The weak part is upstream: there is almost nothing to propagate.

---

# SECTION 1 — AGENDA

## 1.1 Which dashboard routes own what

| Entity | Route | File |
|---|---|---|
| Sessions (list) | `/content/agenda-center/session-manager` | `apps/organizer/src/app/(dash)/content/agenda-center/session-manager/page.tsx` |
| Session (edit) | `/content/agenda-center/session-manager/[id]` | `.../session-manager/[id]/page.tsx`, `.../[id]/session-form.tsx`, `.../[id]/actions.ts` |
| Session Q&A / polls toggles | `/content/agenda-center/session-qanda-manager` | `.../session-qanda-manager/actions.ts` |
| Conflict check (read-only) | `/content/agenda-center/conflict-check` | `.../conflict-check/page.tsx` + `apps/organizer/src/lib/conflicts.ts` |
| Tracks | `/content/agenda-center/track-manager` | `.../track-manager/page.tsx` |
| Speakers | `/content/speaker-center/speaker-manager` | `.../speaker-center/speaker-manager/page.tsx` |
| Rooms | **no route exists** | rooms are only *read*: `apps/organizer/src/lib/data.ts:90` (`listRooms`), `lib/conflicts.ts:58`, `lib/cohorts.ts:68`. `/content/logistics-center` (`.../logistics-center/page.tsx:33`) displays a room count and states on-screen that "Editable fields: 0". |
| Session capacity view | `/attendees/session-cap` | `.../attendees/session-cap/page.tsx` — comparison only, no write |

Authoritative proof of the read-only claim: a grep for every write handle across the whole dashboard source returns **only reads** for three of the five collections.

```
COLLECTIONS.rooms    → lib/data.ts:91, lib/conflicts.ts:58, lib/cohorts.ts:68        (all .get())
COLLECTIONS.tracks   → lib/data.ts:152, content/basics/page.tsx:45                  (all .get()/count())
COLLECTIONS.speakers → lib/data.ts:191, lib/conflicts.ts:57, lib/images.ts:111,
                       lib/messaging.ts:110, lib/webpages.ts:65, layout.tsx:67      (all .get()/count())
COLLECTIONS.sessions → only session-manager/[id]/actions.ts and
                       session-qanda-manager/actions.ts hold a write
```

## 1.2 CRUD matrix — agenda

| Entity | CREATE | EDIT | DELETE | Where |
|---|---|---|---|---|
| **Session** | ❌ — the "Add session ▾" button is hard-`disabled` with `title="Not built — see below"` (`session-manager/page.tsx:291-293`); the gap is documented at `session-manager/page.tsx:319-323` | ✅ **partial** — `saveSessionAction()` in `session-manager/[id]/actions.ts:59`, 6 fields only (see 1.3) | ❌ by design — `firestore.rules:388` is `allow delete: if false`; the form says so at `session-form.tsx:140-143`. There is no soft-delete UI either: **nothing anywhere writes `deletedAt`** (grep across `app/`, `apps/`, `scripts/`, `functions/` finds only *readers* of it — `apps/web/src/lib/data.ts:145`, `apps/organizer/src/lib/webpages.ts:71`, `lib/polls.ts:83`, `lib/moderation.ts:180`, `lib/conflicts-core.ts:96`, `lib/surveys.ts:215`). Retiring a session = `status: 'cancelled'`. |
| **Session Q&A/poll flags** | n/a | ✅ `setQaSettingsAction()` — `session-qanda-manager/actions.ts:22` (writes `qaEnabled` / `pollsEnabled` only) | n/a |
| **Speaker** | ❌ | ❌ — the row menu items `Edit speaker` / `Email speaker` / `Remove speaker` are all `disabled: true` (`speaker-manager/page.tsx:209-215`); gap text at `:227-233` says "Speakers are created by the importer today." | ❌ | read-only screen |
| **Track** | ❌ | ❌ | ❌ | `track-manager/page.tsx:11-13` — "Read-only, and honestly so." Gap panel `:112-124` explains the blocker is precisely the `primaryTrackName`/`primaryTrackColor` fan-out. |
| **Room** | ❌ | ❌ | ❌ | no screen at all; `logistics-center/page.tsx:48-53` states no form exists |

**Import-only path:** `scripts/src/import-whova.ts` (CLI, `npm run import:whova`) is the only writer for speakers, tracks and rooms — `import-whova.ts:127` (speakers), `:204` (sessions), `:226` (tracks), `:229` (rooms). It is a **command-line script, not a dashboard screen**. The dashboard's own CSV importer (`apps/organizer/src/lib/csv-import.ts`) is wired to exactly two consumers — attendees (`attendees/manage-attendees/attendees/import-actions.ts`) and campaign contacts (`tickets/ticket-marketing/campaign-contact-list/actions.ts`). No agenda entity has a dashboard import.

**Export exists but is one-way:** `apps/organizer/src/lib/exports.ts:30` registers `speakers | sessions | sponsors` CSV exports (`:135`, `:152`, `:171`). There is no round-trip back in.

## 1.3 Every `SessionDoc` field vs. UI editability

Model: `packages/shared/src/models.ts:307-377`. Form: `session-form.tsx`. Writer: `actions.ts:97-113`.

| Field | models.ts | Editable from dashboard? | Notes |
|---|---|---|---|
| `eventId` | :38 (BaseDoc) | ❌ | constant, never rewritten by the save |
| `createdAt` | :39 | ❌ | seed/importer only |
| `updatedAt` | :40 | ⚙️ auto | `actions.ts:106` `serverTimestamp()` |
| `title` | :308 | ✅ | `session-form.tsx:60-67`; empty rejected `actions.ts:73` |
| `description` | :309 | ✅ | `session-form.tsx:150-157`; cleared via `FieldValue.delete()` `actions.ts:99` |
| `timeZone` | :316 | ❌ | read from the existing doc (`actions.ts:89`) and reused; shown as static text `session-form.tsx:85` |
| `startsAtLocal` | :318 | ✅ | `datetime-local` `session-form.tsx:76-84` |
| `endsAtLocal` | :319 | ✅ | `session-form.tsx:93-101` |
| `startsAt` | :321 | ⚙️ derived | `actions.ts:103` from `deriveTimes()` |
| `endsAt` | :322 | ⚙️ derived | `actions.ts:104` |
| `day` | :329 | ⚙️ derived | `actions.ts:107` |
| `roomId` | :330 | ✅ | select `session-form.tsx:109-122`; validated `actions.ts:79` |
| `roomName` | :332 | ⚙️ derived cache | `actions.ts:101` — the **one** cache the console maintains |
| `trackIds` | :334 | ❌ | no control; `actions.ts` never writes it |
| `primaryTrackName` | :336 | ❌ | importer/seed only |
| `primaryTrackColor` | :337 | ❌ | importer/seed only — and the importer **doesn't write it either** (see hazard H4) |
| `format` | :338 | ❌ | no control anywhere |
| `skillLevel` | :339 | ❌ | no control anywhere |
| `speakerIds` | :340 | ❌ | **no way to add or remove a speaker from a session** |
| `speakerNames` | :342 | ❌ | importer/seed only |
| `tags` | :343 | ❌ | no control |
| `slidesUrl` | :344 | ❌ | no control; no upload path |
| `status` | :345 | ✅ | `session-form.tsx:129-139`, validated against `STATUSES` `actions.ts:33`/`:74` |
| `deletedAt` | :347 | ❌ | nothing writes it — see 1.2 |
| `seriesId` | :349 | ❌ | no control |
| `sequence` | :354 | ⚙️ auto | bumped only on reschedule, `actions.ts:116` |
| `stableGuid` | :355 | ❌ | seed/importer (`seed-demo.ts:158`) |
| `qaEnabled` | :357 | ✅ | separate screen — `session-qanda-manager/actions.ts:31` |
| `pollsEnabled` | :358 | ✅ | same |
| `capacity` | :376 | ❌ | despite the model doc calling it "a number an organizer can write" (`session-cap/page.tsx:15`), **nothing writes it**. Seed sets 60 for workshops (`seed-demo.ts:160`). |

**Score: 6 of 28 fields editable through the session form, +2 through the Q&A screen, 5 derived. 15 fields have no write path from any UI.**

## 1.4 Time correctness — this part is right

`saveSessionAction` (`session-manager/[id]/actions.ts:59-176`) is the strongest code in scope:

- It never accepts `startsAt` / `endsAt` / `day` from the form. It re-derives all three server-side inside the transaction: `actions.ts:89` `const times = deriveTimes(startsAtLocal, endsAtLocal, before.timeZone)`, written at `:103-107`.
- `deriveTimes` is a thin wrapper (`apps/organizer/src/lib/time.ts:37-51`) over the **single** implementation in `scripts/src/lib/time.ts:26`, the same one the seed and the Whova importer call. `time.ts:53-56` derives `day` from `startsAtLocal.slice(0,10)` — off the wall clock, not the instant — which is exactly the 21:00-reception rule `AGENTS.md:408-411` describes. The wrapper's only job is re-wrapping the `Timestamp` across two `firebase-admin` module instances (`lib/time.ts:22-26`).
- `scripts/src/lib/time.ts:31-38` rejects any value that is not `YYYY-MM-DDTHH:mm` (so an ISO instant with a `Z` cannot sneak in), and `:44` rejects `end <= start`. Pinned by `scripts/src/lib/time.test.ts`.
- The `<input type="datetime-local">` value format is byte-identical to the stored wall clock, so nothing parses or reformats on either leg (`session-form.tsx:37-43`).
- Single `tx.update()` (`actions.ts:118`) so a listening phone sees one snapshot, not a flicker.
- `sequence` bumped only on an actual reschedule (`actions.ts:116`) for RFC 5545 SEQUENCE.

**Verdict: the time derivation is correct and there is exactly one implementation of it.**

## 1.5 Correctness hazards — AGENDA

**H1 — `speakerNames`, `primaryTrackName`, `primaryTrackColor` have no maintainer once the importer stops running.**
`actions.ts:53-56` states plainly that the console does not own them and "they belong to the importer". That is honest, and it is also the hazard: `import-whova.ts` rewrites a session wholesale, so it self-heals — but there is no other writer. Today nothing in the dashboard can rename a speaker or a track, so the caches cannot *currently* go stale from the dashboard. The moment anyone adds the speaker/track editors that four separate gap panels promise, **every one of those edits leaves stale data on every session** unless a fan-out is written first. `track-manager/page.tsx:114-123` names this explicitly and is the only place that does.

**H2 — `roomName` is not merely a display cache; it is the app's *only* source for the room.**
`firestore.rules` has **no `match /rooms/{...}` block at all** (grep for `rooms` in `firestore.rules` returns nothing), so rules default-deny and the attendee app cannot read `rooms`. `app/src/app/(tabs)/agenda/[id].tsx:257` and `app/src/lib/data/sessions.ts:107` (room is a search key) read `session.roomName` and nothing else. So the model comment "Never decided from" (`models.ts:331`) is true only in the narrow sense that no *logic* branches on it — an attendee physically walks to the room named by this cache. The console does maintain it correctly on a room *change* (`actions.ts:101`), but a room **rename** (no UI, but reachable via console/script) would leave every session pointing at the old name with no detection and no repair path.

**H3 — session speakers and tracks cannot be changed at all.**
`actions.ts` never writes `speakerIds` or `trackIds`. A speaker drop-out two days before the conference — the single commonest late agenda change at a real event — has no dashboard remedy. The workaround is re-running the CLI importer over the whole agenda.

**H4 — `primaryTrackColor` is never written by the importer.**
`seed-demo.ts:152` writes it; `import-whova.ts:204-215` writes `primaryTrackName` (`:213`) but **not** `primaryTrackColor`, and `:226` writes tracks with only `{ name }` — no `color`. So a real Whova import produces sessions with no track colour and tracks with no colour, and both the web agenda (`apps/web/src/lib/data.ts:157` reads `s.primaryTrackColor`) and the app (`app/src/app/(tabs)/agenda/[id].tsx:237`) silently fall back. The seeded demo hides this because the seed does write colours.

**H5 — `import-whova.ts:14` claims to be the generic importer for "speakers, sponsors, rooms, booth assignments". Sponsors are not in it.** A grep for `sponsor` in that file returns only the doc comment. This is the `AGENTS.md:597` "app claims capabilities it does not have" defect class, in a doc comment.

**H6 — `apps/organizer/src/lib/images.ts:131` and `:139` set `editedAt: '/content/speaker-center/speaker-manager'` and `'/content/sponsor-center/sponsor-manager'` — "where an organizer changes them today" (`images.ts:56`).** Both screens are read-only. Any screen rendering the image census tells the organizer to go to a page that cannot change the thing. Same defect class.

**H7 — the app does not filter `deletedAt`.** `app/src/lib/data/sessions.ts:26-30` filters on `eventId` + `status == 'published'` only. `apps/web/src/lib/data.ts:145` *does* filter `!s.deletedAt`. Latent rather than live (nothing writes the field), but the two readers disagree, and the app is the one that would be wrong.

**H8 — `capacity` is inert and one comment still overstates it.** `models.ts:361-375` now says so honestly; `session-cap/page.tsx:15` still describes it as "a number an organizer can write". It is not writable from any screen.

## 1.6 Propagation chain — AGENDA

| # | Hop | Mechanism | Status |
|---|---|---|---|
| A1 | Organizer form → server action | `session-form.tsx:50` `useActionState` → `saveSessionAction` | ✅ |
| A2 | Server action → Firestore | Admin SDK transaction, one `tx.update` — `actions.ts:82-136` | ✅ |
| A3 | Derived fields recomputed server-side | `deriveTimes()` `actions.ts:89` | ✅ |
| A4 | Dashboard re-render | `revalidatePath` ×3 — `actions.ts:167-169` | ✅ |
| A5 | Firestore → **website** `/agenda` | `apps/web/src/app/agenda/page.tsx:20` `export const dynamic = 'force-dynamic'` → `:23` `listAgenda()` → `apps/web/src/lib/data.ts:139-180` (`.where('eventId','==',EVENT_ID)`, filter `published && !deletedAt` in memory) | ✅ live, no cache |
| A6 | Firestore → **website** `/speakers`, `/` | `speakers/page.tsx:40`, `page.tsx:20` both `force-dynamic`; `lib/data.ts:80`, `:301` | ✅ |
| A7 | Firestore → **app** agenda list | `app/src/lib/data/sessions.ts:23` `useSessions()` → `useCollection` → `onSnapshot` (`use-collection.ts:2`), query `eventId + status=='published'` (`sessions.ts:26-30`); consumed at `app/src/app/(tabs)/agenda/index.tsx:141` | ✅ live subscription |
| A8 | Firestore → **app** session detail | direct `onSnapshot(doc(getDb(), COLLECTIONS.sessions, id))` — `app/src/app/(tabs)/agenda/[id].tsx:98-99` | ✅ live |
| A9 | Firestore → **app** track filter chips | `app/src/lib/data/tracks.ts:17` `useTracks()`, live | ✅ |
| A10 | Firestore → **app** room name | ⚠️ **only via the `roomName` cache** — no `rooms` rules block, app never reads `rooms` | ⚠️ H2 |
| A11 | Push to attendees who saved the session | `roomChangePush()` — `actions.ts:157-163`, `apps/organizer/src/lib/push.ts` | ⚠️ seam exists; `AGENTS.md:583-586` records push as unimplemented (`fcmTokens` written by nothing) — the action surfaces the intent as `pushNote` text (`session-form.tsx:164`) rather than sending |
| A12 | Firestore → app: **speaker bios on a session** | `agenda/[id].tsx:150-165` per-id `getDoc` cache-then-server, falling back to `speakerNames` | ✅ (but the underlying data is uneditable — H3) |
| A13 | **Create a session** | — | ❌ **BROKEN HOP — no path exists** |
| A14 | **Edit a speaker / track / room** | — | ❌ **BROKEN HOP — no path exists from the dashboard; CLI importer only** |
| A15 | **Cache refresh after a speaker/track/room rename** | — | ❌ **BROKEN HOP — no fan-out exists** (currently unreachable; becomes live the day A14 is built) |

---

# SECTION 2 — SPONSORS / EXHIBITORS / BOOTHS

## 2.1 Which routes own what

| Entity | Route | File | Writes? |
|---|---|---|---|
| Sponsors | `/content/sponsor-center/sponsor-manager` | `.../sponsor-manager/page.tsx` | none |
| Sponsor tiering | `/content/sponsor-center/sponsor-tiering` | `.../sponsor-tiering/page.tsx` | none (`:88`, `:156` say so) |
| Sponsor banners | `/content/sponsor-center/advanced-banners` | `.../advanced-banners/page.tsx` | none |
| Message sponsors | `/content/sponsor-center/message-sponsors` | `.../message-sponsors/page.tsx` + `lib/messaging.ts:155` | reads `contactEmail` |
| Exhibitors | `/content/exhibitor-center/exhibitor-manager` | `page.tsx`, `exhibitor-form.tsx`, `actions.ts` | ✅ **real writes** |
| Booths | `/tickets/exhibitor-ticket-setup/2-3-booth-selection` | `.../2-3-booth-selection/actions.ts` + `apps/organizer/src/lib/booths.ts` | ✅ **real writes** |

## 2.2 CRUD matrix — sponsors / exhibitors / booths

| Entity | CREATE | EDIT | DELETE | Server action |
|---|---|---|---|---|
| **Sponsor** | ❌ — "Add Sponsor" button `disabled` (`sponsor-manager/page.tsx:187-189`), "Import from Excel" `disabled` (`:184-186`), "Settings" `disabled` (`:190-192`) | ❌ — no form, no action file in the directory at all | ❌ | **none exists** |
| **Sponsor tier (as a taxonomy)** | ❌ | ❌ — `Edit tier` / `Delete tier` both `disabled: true` (`sponsor-manager/page.tsx:54-55`) | ❌ | `SponsorTier` is a hard-coded union, `models.ts:53` |
| **Sponsor leads** | attendee-side only (`firestore.rules:505` `allow create: if isSelf(uid)`) | ❌ `rules:507` `allow update, delete: if false` | ❌ | subcollection is **modelled and empty**; "Export lead lists" is `disabled` (`sponsor-manager/page.tsx:199-200`) |
| **Exhibitor** | ✅ `saveExhibitorAction` — `exhibitor-manager/actions.ts:32` (id from `slugify(name)` `:21`, collision-checked `:66`) | ✅ same action, `{merge:true}` `actions.ts:72-93` | ❌ by design — `setExhibitorStatusAction` `actions.ts:125` sets `cancelled`; rationale at `:117-123` | ✅ |
| **Booth** | ✅ `addBoothAction` → `upsertBooth` — `2-3-booth-selection/actions.ts:75`, `lib/booths.ts:339` | ✅ `assignBoothAction`/`releaseBoothAction`/`toggleBoothBlockedAction` — `actions.ts:23,52,60`; `lib/booths.ts:129,235,287` | ❌ none | ✅ |

Assignment is a real transaction that refuses a double-sell (`lib/booths.ts:129-233`, refusal at `:166`) — the model's stated invariant (`models.ts:1236-1237`) actually holds in code.

## 2.3 Every `SponsorDoc` field vs. UI editability

Model `packages/shared/src/models.ts:619-645`. Written **only** by `scripts/src/seed-demo.ts:178-194`.

| Field | models.ts | Editable from any UI? | Where the value comes from |
|---|---|---|---|
| `eventId` | :38 | ❌ | `seed-demo.ts` `base()` |
| `createdAt` / `updatedAt` | :39-40 | ❌ | seed |
| `name` | :620 | ❌ | `fixtures.ts:157` SPONSORS |
| `tier` | :621 | ❌ | `fixtures.ts` — and moving a sponsor between tiers is explicitly not built (`sponsor-tiering/page.tsx:156`) |
| `logoURL` | :622 | ❌ | `seed-demo.ts:192` `logoURL: s.logoRemote` — see 2.4 |
| `description` | :623 | ❌ | `seed-demo.ts:187`; 5 of 18 are absent by design (`fixtures.ts:148-150`) |
| `website` | :624 | ❌ | `seed-demo.ts:188` |
| `boothLocation` | :625 | ❌ | `seed-demo.ts:181` — invented booth codes, stated at `fixtures.ts:150-152` |
| `offers[]` | :626 | ❌ | never written by anything; the app renders it if present (`app/src/app/(tabs)/people/sponsor/[id].tsx:152-157`) |
| `downloads[]` | :627 | ❌ | never written by anything; counted in the dashboard row (`lib/data.ts:265`) and always 0 |
| `contactName` | :643 | ❌ | `seed-demo.ts:183` — synthetic "X events team" |
| `contactEmail` | :644 | ❌ | `seed-demo.ts:184` — synthetic `@…example.invalid` |
| `leads/{uid}` subcoll | :648-655 | ❌ organizer-side | attendee-created only; nothing in the app creates one either |

**Score: 0 of 13 sponsor fields editable from the dashboard.**

### `ExhibitorDoc` (`models.ts:1049-1061`) — the contrast

| Field | Editable? | Where |
|---|---|---|
| `name` | ✅ | `exhibitor-form.tsx:34` → `actions.ts:39`,`:75` |
| `boothNumber` | ✅ (free text) | `exhibitor-form.tsx:57-62` → `actions.ts:40`,`:76` — ⚠️ see S3 |
| `logoURL` | ❌ | **the action never writes it** (`actions.ts:72-93`); gap stated at `exhibitor-manager/page.tsx:266-269` |
| `description` | ✅ | `exhibitor-form.tsx:124-127` → `actions.ts:44` |
| `website` | ✅ | `exhibitor-form.tsx:117-120` → `actions.ts:43` |
| `contactName` | ✅ | `exhibitor-form.tsx:94-97` → `actions.ts:41` |
| `contactEmail` | ✅ + validated | `exhibitor-form.tsx:101-106` → `actions.ts:42`, regex `:17`/`:49` |
| `passesAllocated` | ✅ + validated | `exhibitor-form.tsx:70-75` → `actions.ts:46`,`:56-59` |
| `passesUsed` | ⚙️ create-only | `actions.ts:88` — deliberately never rewritten on update, rationale `:83-87` |
| `status` | ✅ | `exhibitor-form.tsx:46` → `actions.ts:45`,`:52` |

### `BoothDoc` (`models.ts:1238-1272`)

`number`, `size`, `zone`, `ticketTypeId` editable via `addBoothAction` (`actions.ts:75-88` → `lib/booths.ts:339`). `exhibitorId`/`exhibitorName`/`orderId`/`assignedAt`/`assignedBy`/`status` are written only by `assignBooth`/`releaseBooth` (`lib/booths.ts:179-183`, `:244-248`). `note` via `setBoothBlocked` (`lib/booths.ts:310`).

## 2.4 Logos — confirmed, and there is no upload path

**Confirmed: 18 sponsor logos are hotlinked to Whova's CDN in the seed fixtures.**

- `scripts/src/lib/fixtures.ts:153-155` declares `SPONSORS` with two logo fields, `logo` (a website-local path) and `logoRemote` (the absolute original). The docblock at `:127-152` explains why.
- All 18 `logoRemote` values point at `https://d1keuthy5s86c8.cloudfront.net/...` — Whova's asset CDN, reached from the public endpoint named at `fixtures.ts:133-135`. Entries begin at `fixtures.ts:159` (Abbvie) and run through `:227` (Process Tempo). Count verified: 18 `logoRemote:` entries in the array (a 19th occurrence at `:140` is prose).
- `scripts/src/seed-demo.ts:192` writes `logoURL: s.logoRemote` into Firestore. So **Firestore holds the CloudFront URL**, and that is what both the dashboard and the Expo app render.
- The website is the only client that dodges it: `apps/web/src/lib/data.ts:214-221` `localLogo()` swaps in `/kgc/sponsors/{slug}.png` for the 18 slugs whitelisted at `:230-249`, self-hosted under `apps/web/public/kgc/sponsors/`. Rationale at `data.ts:208-217`.

**Upload path: confirmed absent.** `apps/organizer/src/lib/images.ts:19-22` — "nothing in this project uploads a file. Every image anywhere is a URL somebody typed or an importer copied, and `storage.rules` exists with nothing writing through it." The `uploaded` count is derived rather than hard-coded (`images.ts:158-172`) so it will self-correct the day one exists; today it is 0. `exhibitor-manager/page.tsx:266-269` says the same for exhibitor logos. There is no `<input type="file">` and no Storage write anywhere in `apps/organizer`.

**The dashboard's own alarm about this is live but unactionable:** `sponsor-manager/page.tsx:203-208` renders a danger banner counting sponsors with no `logoURL` — on a screen that cannot set one.

## 2.5 Correctness hazards — SPONSORS / EXHIBITORS

**S1 — the entire sponsor record is seed-only.** Not "import-only": there is no importer either (`import-whova.ts` handles agenda/speakers/tracks/rooms, and its claim to handle sponsors — `:14` — is false, H5). A sponsor tier change, a new sponsor signing in March, a logo swap, a description correction: none has any path short of editing `scripts/src/lib/fixtures.ts` and re-running the seed against production.

**S2 — third-party CDN dependency on the app and the dashboard.** Both render `logoURL` verbatim: `app/src/components/sponsor-logo.tsx` (used at `app/src/app/(tabs)/people/index.tsx:390-402` and `people/sponsor/[id].tsx:115`), and the dashboard `<img>` (eslint-disabled deliberately, `sponsor-manager/page.tsx:20-26`). If Whova rotates or expires those CloudFront keys, 18 sponsor logos vanish from the paid-for surfaces and the only remedy is a code change plus a reseed. The website is insulated; the app and the dashboard are not.

**S3 — `ExhibitorDoc.boothNumber` and `BoothDoc` can be driven out of sync, in one direction only.**
`assignBooth` correctly writes both sides — booth occupancy plus `exhibitors/{id}.boothNumber` (`lib/booths.ts:198-209`), and `releaseBooth` clears it (`:258`). But `saveExhibitorAction` accepts `boothNumber` as **free text** (`exhibitor-form.tsx:57-62`, `actions.ts:40`,`:76`) and writes it to the exhibitor **without touching `booths` at all**. So an organizer typing "E07" into the exhibitor form produces an exhibitor claiming a booth that `booths/E07` shows as available — and the floor-plan screen, which is the one the ops team works from, never learns. `models.ts:1226-1228` says `boothNumber` is "a denormalised label… nothing is ever decided from it", but the exhibitor list *is* what a person reads (`exhibitor-manager/page.tsx:152-153`).

**S4 — renaming an exhibitor leaves `BoothDoc.exhibitorName` stale.** `saveExhibitorAction` writes `name` (`actions.ts:75`) and never revisits `booths` where `exhibitorName` was copied at assignment time (`lib/booths.ts:179`). The floor plan then shows the old company name. Same shape as H1, but here it is **reachable today**, because the exhibitor editor actually ships.

**S5 — `sponsors/{id}/leads` is modelled, ruled and empty.** Rules allow the attendee create (`firestore.rules:505`) and the organizer read (`:506`), and nothing in `app/` writes one. The export is `disabled` (`sponsor-manager/page.tsx:199-200`). Correctly described as a gap at `sponsor-manager/page.tsx:242-246`.

**S6 — `offers` and `downloads` render in the app and are written by nothing.** `people/sponsor/[id].tsx:152-157` has a whole offers section; `apps/organizer/src/lib/data.ts:265-266` counts both. Every count is 0 and every section is hidden. Dead surface, not a bug — but it is capability the sponsor pack implies and no path delivers.

**S7 — `images.ts` points organizers at read-only screens** (see H6) — this hits sponsors specifically at `images.ts:139`.

## 2.6 Propagation chain — SPONSORS / EXHIBITORS

| # | Hop | Mechanism | Status |
|---|---|---|---|
| S-A | Dashboard → Firestore, **sponsors** | — | ❌ **BROKEN HOP — no writer exists** |
| S-B | Seed script → Firestore, sponsors | `scripts/src/seed-demo.ts:170-194` | ✅ (CLI, not a product surface) |
| S-C | Firestore → **website** `/sponsor` | `apps/web/src/app/sponsor/page.tsx:12` `force-dynamic` → `:56` `listSponsorsByTier()` → `apps/web/src/lib/data.ts:287` → `:260` `listSponsors()` (live `.get()`, wrapped in `safely()` `data.ts:59`) | ✅ live |
| S-D | Firestore → **website** homepage strip | `apps/web/src/app/page.tsx:20` `force-dynamic`, `:112` `listSponsorsByTier()` | ✅ live |
| S-E | Website logo resolution | `localLogo()` `apps/web/src/lib/data.ts:214`, whitelist `:230-249` | ⚠️ whitelist is a hand-maintained constant — a 19th sponsor needs a code commit or it falls back to the CloudFront URL |
| S-F | Firestore → **app** People ▸ Sponsors | `app/src/lib/data/directory.ts:94` `useSponsors()` → `onSnapshot`, tier-ordered `:99-102`; consumed `app/src/app/(tabs)/people/index.tsx:126`, rendered `:390-402` | ✅ live subscription |
| S-G | Firestore → **app** sponsor detail | `useDocument(doc(getDb(), COLLECTIONS.sponsors, id))` — `app/src/app/(tabs)/people/sponsor/[id].tsx:54-55` | ✅ live |
| S-H | Logo bytes → app | direct `<Image>` on the CloudFront URL, `app/src/components/sponsor-logo.tsx` | ⚠️ S2 |
| S-I | Dashboard → Firestore, **exhibitors** | `exhibitor-manager/actions.ts:32` / `:125` | ✅ |
| S-J | Dashboard → Firestore, **booths** | `2-3-booth-selection/actions.ts` → `lib/booths.ts` (transactional) | ✅ |
| S-K | Exhibitors → **website** | — | ❌ **BROKEN HOP — the site has no exhibitor listing.** `apps/web/src` mentions exhibitors only as a *ticket audience* (`tickets/exhibitor/page.tsx`, `tickets/audience-page.tsx`); nothing reads `COLLECTIONS.exhibitors` |
| S-L | Exhibitors / booths → **app** | — | ❌ **BROKEN HOP — no exhibitor surface in the app.** `COLLECTIONS.exhibitors` and `COLLECTIONS.booths` appear nowhere under `app/src` (only a passing word at `community/index.tsx:40`) |
| S-M | Sponsor leads → dashboard | `firestore.rules:504-507` permits it; no writer, no reader screen | ❌ **BROKEN HOP** |

Net: exhibitor/booth editing is real but reaches **nobody outside the dashboard**. Sponsor data reaches everybody and can be **changed by nobody**. The two halves have exactly opposite defects.

---

# Prioritized TODO

**P0 — an event cannot run without these**

1. **Session create + speaker/track assignment on a session.** `speakerIds` and `trackIds` are unwritable (H3), and there is no create (A13). Build them into the existing `saveSessionAction` transaction — it already has the right shape. Any speaker-name change must write `speakerNames` in the *same* update, or H1 goes live on day one.
2. **Sponsor editor.** 0 of 13 fields writable (2.3, S-A). At minimum `name`, `tier`, `website`, `description`, `boothLocation`, `contactName`, `contactEmail` — everything except `logoURL`, which needs P1. Mirror `exhibitor-manager/actions.ts`: it is 150 lines and already does audit + validation + id collision + no-delete correctly.
3. **Fix the exhibitor↔booth split-brain (S3, S4).** Either make `boothNumber` on the exhibitor form a select backed by `listBooths()` that routes through `assignBooth`, or make it read-only there and force assignment through the floor plan. Additionally, have `saveExhibitorAction` fan a name change out to `booths` where `exhibitorId == id`. This one is live today, not hypothetical.

**P1 — needed before the caches or the logos can be trusted**

4. **File upload to Firebase Storage** — one path, reused by sponsor logos, exhibitor logos, speaker headshots and session slides. `storage.rules` exists and nothing writes through it (`images.ts:19-22`). This is `AGENTS.md:625`'s "binding constraint is now file upload, not screen count", and it is what un-hotlinks the 18 CloudFront logos (S2) and retires the whitelist in `apps/web/src/lib/data.ts:230`.
5. **Denormalisation fan-out helper**, before the speaker/track/room editors ship. One function: given a changed speaker/track/room, batch-update every session that references it (`speakerNames`, `primaryTrackName`, `primaryTrackColor`, `roomName`). `track-manager/page.tsx:114-123` already specifies it. Without it, P0#1 and any track editor create silent corruption (H1, H2).
6. **Speaker editor** (`speaker-manager/page.tsx:209-215` — three disabled menu items). Must preserve the `userId` join, as `:229-232` warns. Gated on #5.
7. **Track editor** (name, colour, description) — gated on #5. Fixes H4's downstream symptom too.

**P2 — correctness cleanups, cheap**

8. **Write `primaryTrackColor` and `TrackDoc.color` in `import-whova.ts`** (`:213`, `:226`) — H4. A real import currently produces a colourless agenda while the demo looks fine.
9. **Filter `deletedAt` in `app/src/lib/data/sessions.ts:26-30`** to match `apps/web/src/lib/data.ts:145` — H7.
10. **Correct three false doc comments** (the `AGENTS.md:597` defect class): `import-whova.ts:14` claims sponsor import that does not exist (H5); `images.ts:131` and `:139` name read-only screens as where images are edited (H6, S7); `session-cap/page.tsx:15` calls `capacity` organizer-writable (H8).
11. **A rooms screen**, even read-only-plus-rename — rooms are invisible in the dashboard (1.1) yet `roomName` is the only thing telling an attendee where to stand (H2). Gated on #5 for the rename half.

**P3 — commercial surfaces that are modelled and unreachable**

12. **Sponsor `offers` / `downloads` editors** — the app already renders both (S6).
13. **Lead retrieval** — `sponsors/{id}/leads` is ruled and empty; no scanner, no export (S5).
14. **An exhibitor surface on the website and/or the app** — exhibitor editing currently propagates nowhere (S-K, S-L). Either build the surface or stop selling the field.
