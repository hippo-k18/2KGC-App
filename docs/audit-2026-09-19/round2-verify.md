# Security verification
## Verdicts

Verification only — I changed no source. Tree clean at `0dda7b5` (the fix commit; the task's `28128df` is its parent).

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | `resource.data.get(field,default)` lets an unfiltered query read hidden replies | **STILL OPEN** | Emulator probe, isolated project id. As attendee B (non-author, non-organizer): `where('eventId','==','kgc-2027')` returned `rHidden,rOk` with body `DOXXING TEXT`. `where('authorId','==',A)` returned A's hidden reply. `getCountFromServer` with the same filter counted 2. Only the *totally unconstrained* query is denied. |
| 2 | A revoked speaker link still writes | **FIXED** | Playwright against :3200 with a positive control. Live link → POST 303, `status: submitted`, draft written. Same submission with `linksValidFrom` stamped ahead of `iat` → POST 303, `status` stayed `opened`, `draft: null`. Reload of the revoked link 404s. |
| 3 | Erasure audit entry can carry the address | **FIXED** | Real erasure through the dashboard. Entry is `before: {"walked":16,"signedIn":false,"hadTicket":true}` — no name, no address. `targetId` is the derived `reg_…`. |
| 4 | Publishing fires an unbounded unconfirmed mass mail | **FIXED** | Code path read end to end: `saveConsentFormAction` now only calls `signingSendPlan` (a count) and prints a line pointing at the send. `sendSigningLinksAction` is the only caller of `sendSigningLinks`, behind `reauthenticate()`, a typed count re-read server-side, an 18s budget, and per-recipient `emailLog` rows under `consent_{formId}_v{version}`. `alreadyMailed` rethrows rather than returning an empty set. 13 tests in `tests/programme/consent-signing-send.test.ts`. |
| 5 | Erasure joins on a lower-cased address | **FIXED** | End-to-end probe. Seeded `Ada.Okonkwo.…@Example.COM` verbatim into `emailLog.to`, `volunteers`, `certificates`, `pendingAnswers`, `orders`, `contacts`. After the erasure: volunteers/certificates/pendingAnswers **gone**, emailLog `to:null`, orders `email:null buyerName:null`, contacts `email:null name:null source:null`. Banner: "Deleted 4 records. Took their name off 3 records that have to stay." |
| 6 | Erasure destroys the marketing opt-out record | **FIXED** | Same run: `contacts/{id}` survives with `unsubscribedAt` stamped (it was `null` before) and every personal field cleared. |
| 7 | No step-up on the only irreversible destroy | **FIXED** | Drove the real form. Passphrase field present; typed address + **wrong** passphrase → all 7 seeded documents still present, nothing deleted. Correct passphrase → completed. `tests/parity/step-up-guard.test.ts` pins the guard order (refuse before `resolvePerson`). |
| 8 | `settings/appAccess` carries the join code | **FIXED** | Rules probe: code moved to `settings/appJoinCode` behind `isRegistered()`; a signed-in account with no ticket is denied it and still reads `appAccess`, which no longer contains the key. Organizer copy on Code Access Control now says "Treat it as something you announce, not as a password." |
| 9 | Speaker's self-supplied photo URL published unvalidated | **FIXED** | Submitted `https://tracker.attacker.example/pixel.png` through the live portal; it lands in the draft and is shown to the organizer, and `approvalPlan` returns `speaker: {}` + `heldPhotoURL`, so the apply batch has nothing to write. Adversarial hosts all held: `…googleapis.com.attacker.example`, `…googleapis.com@attacker.example`, `http://`, upper-case, `https:\\`. |
| 10 | `isSafeHref` treats `/\host` as relative | **FIXED** | `/\evil.example`, `\\evil.example`, `\/evil.example`, `//evil.example`, `\evil.example`, `/\\evil.example` all false; `/ok/page`, `#anchor` still true. |
| 11 | No erasure entry for `speakers`/`speakerProfileEdits` | **FIXED** | `PLACES` now has `speakerProfile`, `speakerDraft`, `reviewerRecord`, `submissionAuthor`, `reviewerScores`, `dashboardAccount`. The live walk reported `walked: 16`. Screen copy rewritten to name all five survivors. |
| 12 | `personKeys` trusts a caller-supplied registration id | **FIXED (defence in depth)** | `personKeys` now takes `{id, email}` off the same document and throws `PersonKeyMismatch`. Note it is unreachable from today's caller: `resolvePerson` derives `email` from that same registration, and `parsePersonRef` returns only one of `reg:`/`uid:`, so the two can never disagree. It protects a future caller, which is what the finding asked for. |
| 13 | `users/{uid}/notifications` outside the access window | **FIXED** | Rules probe with the projection written as the dashboard writes it (`values` map): open → get/list/update succeed; `closesAtMs` in the past → get, list and "mark read" all denied. |
| 14 | Every unknown URL reads the whole `pages` collection | **FIXED** | `getPublicPage` is now `where('slug','==',wanted).limit(5)` wrapped in React `cache()`, so the metadata call and the body call share one read; event check moved in-memory. `/xyzzy`, `/aaa`, `/aab` → 404; `/flow-292397` → 200. |

## Finding 1 in detail

The new rule is:

```
|| (resource.data.keys().size() > 0 && resource.data.get('status','visible') == 'visible')
|| resource.data.status == 'visible'
```

`keys().size() > 0` does not tell a `get` from a `list`. On a query Firestore binds `resource.data` to **the fields the query constrains** — so any query with one equality filter on any field makes `keys().size()` non-zero, branch 3 runs, `.get('status','visible')` returns the *default*, and the whole hidden set comes back. The guard only distinguishes "zero filters" from "one or more filters".

The new rules test (`is not returned by an unfiltered query, which used to be the hole`) asserts only the zero-filter case, so the suite is green while the hole is open — and it is now worse than before, because the docblock, the test name and `app/src/lib/data/community.ts` all state that the server enforces it.

Files: `firestore.rules:1347-1353`, `tests/rules/firestore.test.ts` (the replies block), `app/src/lib/data/community.ts:156`.

## Check results

- `npx tsc --noEmit` — `apps/organizer` clean, `apps/web` clean, `app` clean
- `npm test` at the repo root — 51 files, **919 passed**
- `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules` — 3 files, **315 passed**
- Working tree clean; nothing committed; emulator restored (seeded probe rows and the two speaker documents put back).

## New problems the fixes introduced

1. **A throwaway probe was committed.** `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/tmp-probe/probe-f1.test.ts` is in commit `0dda7b5`. It is inert (no runner globs it) but it is a scratch file in the repo, and its assertions describe the hole as closed. I left it alone.
2. **Pre-`status` replies vanish from the board.** Moving the filter into the query means `where('status','==','visible')` cannot return a reply written before the field existed. Acknowledged in the code comment; the set is empty in this database, but it is a real trade and would bite any restored backup.
3. **A reply can still be created with no `status` field at all** — the create rule uses `.get('status','visible')` on `request.resource`. Such a reply is then invisible to every list and every count, readable only by direct `get`. Not a disclosure, but a way to write a reply nobody can moderate off the board.
4. **A residual race on the consent send.** `alreadyMailed` is read once at the start of each press, so two organizers pressing Send at the same moment can both mail the same people. The docblock claims this is covered; it is not. Low impact next to what was fixed.
5. **`tests/parity/step-up-guard.test.ts` is weaker than it reads.** It asserts only that the *file* contains `await reauthenticate(`, not that the named action does. `release-and-consent-forms/actions.ts` holds two exported actions; the test would pass if the guard moved to the wrong one.

## Must be deployed to the live project

- The whole of `firestore.rules` — the reply read rule (which still needs the real fix for finding 1), `settings/{key}` with `appJoinCode`, and the notifications window. Until `scripts/ops/deploy-rules.mjs` runs, none of findings 1, 8 or 13 is closed on the live database.
- `firestore.indexes.json` — two entries now: the existing `pages(eventId, published)` and the new `replies(status ASC, createdAt ASC)`, COLLECTION scope. **The app's reply query will fail with `failed-precondition` in production without it**; the emulator does not enforce indexes.
- **A one-time save of Tools › Admin Control › Code Access Control.** The `joinCode` key is removed from `settings/appAccess` only by `writeAppAccessProjection`. I confirmed on the emulator that a legacy `appAccess` still carrying `values.joinCode` is fully readable by any signed-in account. Until that screen is saved once against live, finding 8 is open there even after the rules deploy.

# Screens verification
All 14 verified live. I changed no files; the tree is still clean at `0dda7b5` (another agent has since committed the round-two fixes on top of `28128df`).

Screenshot root: `/private/tmp/claude-501/-Users-hartigan-Documents-Claude-Projects-KGC/ce473dc2-4864-489c-bc7b-43704d7578c0/scratchpad/audit/v3/`

| # | Problem | Verdict | png |
|---|---|---|---|
| 1 | Saved value not in the box; second Save reverts it | **Fixed** | `v3/p1-banner.png`, `v3/p1-code-second-save.png`, `v3/p1-postevent-banner.png`, `v3/p1-postevent-second-save.png` |
| 2 | Validation error wipes what was typed | **Fixed** | `v3/p2-banner.png`, `v3/p2-invite-refused.png`, `v3/p2-invite-accepted.png` |
| 3 | Two check-in panels disagree on the last scan | **Fixed** | `v3/p3-crop.png` |
| 4 | UTC slice puts tomorrow's date on footers | **Fixed** | `v3/p4-code-access-control.png`, `v3/p4-post-event-access-duration.png` |
| 5 | Duplicate DOM ids on three screens | **Fixed** | `v3/p5-attendees-edit.png`, `v3/p5-_content_call_for_speakers_abstracts_reviewers.png`, `v3/p5-_content_speaker_center_speaker_manager.png` |
| 6 | Table headers break mid-word at desktop | **Fixed** | `v3/crop-content_logistics_center-1280.png`, `v3/crop-content_sponsor_center_sponsor_tiering-1280.png` |
| 7 | Access forms leave the Whova form vocabulary | **Fixed** | `v3/crop-tools_admin_control_code_access_control-1280.png`, `v3/m390/tools_admin_control_code_access_control-390.png` |
| 8 | "Send link" does not preselect that speaker | **Fixed** | `v3/p8-preselect.png`, `v3/p8-after-send.png` |
| 9 | Smallest projector bar loses its percentage | **Fixed** | `v3/w1280/engagement_live_polling_room_a_graph_catalogue_for_machine_learning_features_7c558cc1_seed_poll_13-1280.png` |
| 10 | Developer wording reaching an organizer | **Fixed** (all three) | `v3/crop-content_logistics_center-1280.png`, `v3/crop-content_branding_center_customize_resources-1280.png`, `v3/p3-crop.png` |
| 11 | Content › Basics shows no current dates | **Fixed** | `v3/crop-content_basics-1280.png` |
| 12 | Row actions 14–17px on a phone | **Partly fixed** | `v3/crop-reviewers-actions.png`, `v3/crop-attendees_admin_settings-390.png` |
| 13 | ROUND-TWO §2 overstates Sponsor Tiering | **Fixed** | doc only; screen agrees in `v3/crop-content_sponsor_center_sponsor_tiering-1280.png` |
| 14 | `/privacy` ships bracketed placeholders | **Fixed** | `v3/web390/privacy-390.png` |

## What the driven flows actually did

**1 — saving twice no longer writes the old value back.** Typed `KGC-W661992`, pressed Save: banner "Saved. Attendees are asked for KGCW661992 once…", and the box read `KGC-W661992` with no reload. Pressed Save a second time untouched, reloaded: still `KGC-W661992`. Same on post-event days: was 40, typed 17, banner "Saved: attendees keep access for 17 days after the event. The app closes after 2027-05-24.", box read 17, second Save + reload still 17. The `key={...-${version}}` remount is in place on both forms.

**2 — a refusal keeps the fields.** Submitted `kept.661992@example.test` / "Kept Name" with no role ticked. Banner "Pick at least one role."; both boxes came back holding exactly what was typed. A successful invite still clears them.

**5 — no duplicate ids anywhere.** With the attendee edit panel and the transfer panel both open (9 forms on the page): zero duplicate ids, zero labels pointing at 0 or >1 elements, zero fields with two labels. Ids are now `edit-name` / `transfer-name`, `criterion-relevance-min`, `send-link-speakerId` etc. Reviewers and Speaker Manager likewise clean.

**8 — preselect works.** Opened the ⋮ on row 3 (Anton Moreau): menu is `Edit speaker, Email speaker, Send profile link`. Clicking it goes to `?send=anton-moreau-e1d19ad9#speaker-self-service`, the Send-to select reads `anton-moreau-e1d19ad9` / "Anton Moreau", and pressing Send link fires no browser validation dialog — banner "Email is not switched on yet, so nothing was sent to anton.moreau@example.invalid."

**4 — proved rather than inferred.** New York and UTC share a date right now, so I pinned `settings/access.updatedAt` to `2026-09-21T02:30Z` (22:30 on the 20th in New York), read both Admin Control footers — "Last changed by demo@knowledgegraph.tech on **2026-09-20**" — and restored the original value.

## The 20 screens at 390, judged as a person holding a phone

Metrics: `v3/m390/metrics-390-b1.json`, `metrics-390-b2.json`. Zero horizontal page scroll, zero overflowing elements, zero clipped text nodes on all 20. No em dash in prose on any of them — every `—` on screen is the lone empty-cell marker. No developer wording beyond the two noted below.

Three things a person would hit:

**a. The inline criterion editor does not fit 390.** `/content/call-for-speakers-abstracts/reviewers` → open a criterion's **Edit**. The form renders 394px wide starting at x=44, so its right edge is at 438 on a 390 screen: the Name, Lowest score, Highest score and description boxes and the Save button all run off the right and cannot be reached. It sits in `.whova-table-cell cell-md` (302px) with `overflow-x: visible`, so nothing scrolls to it. `v3/p12-criterion-open-390.png`. This is in a file round two rewrote (`criteria-forms.tsx`).

**b. Problem 12 is fixed for links and buttons but not for `<summary>`.** The new globals.css rule covers `a` and `button` inside `.whova-table-cell`, and every `Edit` / `Manage` / `Screen ↗` / `Move up` I measured is now 32px tall. `<summary>` is not covered, so:
- `/content/call-for-speakers-abstracts/reviewers`: `Edit` **21×16**, `Review link` 60×16, `Remove` 44×16 — nine of them. Worse, `Edit` at 16px sits beside `Move up`/`Move down` at 32px, so the row is visibly misaligned (`v3/crop-reviewers-actions.png`).
- `/attendees/admin-settings`: `Change roles`, `New passphrase link`, `Remove` — twelve at 111×16.

**c. Two tiny-width tap targets.** `/attendees/categories` prints the attendee count as a one-character link: **8×32** (`v3/crop-attendees_categories-390.png`). `/engagement/session-feedback` has a `12` link at 16×32. Height fixed, width not.

Also worth knowing, all minor:
- `/attendees/categories` draws a solid red **Delete** at the same weight as the blue **Save** in every card — two heavy buttons per card, with the destructive one as prominent as the safe one. Sponsor Tiering does the same thing correctly, with a lighter Remove.
- Same defect class as problem 7, on a screen the review did not name: `/tickets/ticket-setup/1-2-question-forms` has a bare `input#required` at **13×13** instead of `.whova-checkbox-input`.
- Same defect class as problem 10, on two screens the review did not name: `/content/basics` prints `kgc-2027` in monospace under "Event ID", and `/tickets/ticket-setup/1-2-question-forms` prints field slugs (`dietary-requirements`, `which-vegetarian-option-would-you-like`) in monospace.
- `/content/logistics-center`, `/content/speaker-center/speaker-manager`, `/attendees/release-and-consent-forms` and `/tickets/ticket-setup/1-2-question-forms` use the sideways-scrolling `.whova-table-wrapper` at 390 rather than `stackSm`, so the ⋮ menu — including the new "Send profile link" — is only reachable after scrolling the table sideways. House pattern, not new, but it is where the problem 8 fix lives.

## Environment notes

- The emulator still carries stray test data: `settings/event.shortName` is `KGC870092` (so every footer reads "KGC870092 EMS"), pages `/audit-737784` and `/flow-292397`, categories "Volunteer 737784" / "Flow 360875", and team rows `audit.737784@`, `flow.467369@`, `keepme@`. My own runs added `keepme.341605@example.test` and `kept.661992@example.test` to the team list and left `settings/access.eventCode` at `KGC-W661992` with `postEventDays` 17 — the access forms had to be saved to test them. `settings/access.updatedAt` was restored to its original value.
- Nothing needs deploying for this verification. The deploy list for the round-two work is unchanged: `firestore.rules`, the `pages(eventId, published)` index, and `WEB_PUBLIC_ORIGIN`, which is still unset on the running dashboard so minted speaker links point at `https://www.knowledgegraph.tech/…`.