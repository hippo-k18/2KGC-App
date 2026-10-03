# Security review
Reviewed the full uncommitted diff (86 tracked files + 49 untracked) against HEAD `b0f96c7`. Verified where I could: ran the whole rules suite (`tests/rules`, 308 passed) and `npm test` (871 passed) against the running emulator on 127.0.0.1:8080 using an isolated per-pid project id — no live project touched, no server started or stopped, nothing fixed. One finding below is backed by a throwaway emulator probe I wrote, ran and deleted.

## Findings, most severe first

**1. `resource.data.get(field, default)` in a rule silently permits the whole unfiltered query — hidden community replies are readable by any ticket holder.**
`firestore.rules:1316-1320`
The new reply read rule is `isRegistered() && (resource == null || isOrganizer() || resource.data.get('status','visible') == 'visible' || resource.data.authorId == request.auth.uid)`. I probed the emulator directly: an unfiltered `getDocs(collection('communityPosts/p1/replies'))` as a non-author, non-organizer attendee returned `rHidden,rOk` — the hidden reply came back. The contrast is `threads` at `firestore.rules:1433`, whose branch is a bare `resource.data.participantIds`; the same unfiltered list is denied with `evaluation error at L1433:22 for 'list'`. So on a list `resource` is not null and `resource.data` has no properties: a bare dereference throws and denies, while `.get(…, default)` returns the default and allows. Failure scenario: a moderator hides an abusive or doxxing reply on the community board; the text is still returned to every attendee by any client that does not apply `replyIsVisible` — the dashboard, a script, a stale app build, or `curl` against the REST API with a signed-in token. The docblock at `firestore.rules:1290-1314` and the test at `tests/rules/firestore.test.ts` (`is still returned by an unfiltered query`) describe this accurately, so it shipped knowingly, but "hide" is currently a client-side courtesy, not a control. The same idiom is used on the create rule (`request.resource`, safe) and `pages` uses the bare form (`resource.data.published == true`, correctly denies an unfiltered list).

**2. Revoking a speaker's portal link does not stop the holder from writing.**
`apps/web/src/app/speaker/[token]/actions.ts:37`, `apps/web/src/lib/speaker-portal.ts:189-232`
`loadPortal` checks revocation (`linkIsLive(payload.iat, edit?.linksValidFrom)`, `speaker-portal.ts:96`). The server action re-verifies the HMAC with `readSpeakerToken` and then calls `recordDraft(payload.sid, input)` — which reads the speaker doc and writes the draft without ever consulting `linksValidFrom`. Failure scenario: a speaker's mailbox is compromised, the organizer presses "Revoke link" (`apps/organizer/src/lib/speaker-portal.ts:520`). The page now 404s, but the attacker POSTs `saveSpeakerProfileAction` with the old token and keeps replacing that speaker's bio, company, photo link and per-session slides links for the remaining 180 days of the token's TTL. Each submission resets the tracker to `submitted` and presents attacker-controlled text and URLs to an organizer for one-click publication to the public site and the app. Revocation is the only control the 180-day TTL leaves, and it covers the read half only.

**3. The erasure audit entry can carry the address the erasure exists to remove.**
`apps/organizer/src/lib/person-data.ts:405`, with `:127`
The comment above it says the address is deliberately not carried into the entry, then writes `before: { name: identity.name, … }`. `identity.name` is `reg?.name || user?.name || email` (`:127`). Failure scenario: an account created by the OTP flow with no profile name, or a registration imported without a name, asks for erasure. Every document is deleted, and `auditLog` — which survives by design and is matched on `targetId` — keeps their email address in `before.name` forever. The walk itself also anonymises `auditLog` entries (`person-data-core.ts:481-484`) *before* this entry is appended, so nothing later removes it.

**4. Publishing a consent form fires an unbounded, unconfirmed mass mail synchronously inside the server action.**
`apps/organizer/src/app/(dash)/attendees/release-and-consent-forms/actions.ts:97-99`, `apps/organizer/src/lib/consents.ts:436-467`
`Save` with status `published` (first publication, or any body change that bumps the version) calls `sendSigningLinks`, which builds the whole register and mails every unsigned person in serial batches of 20. There is no preview, no "send now / send later", no confirmation dialog, and no record of how far it got. Failure scenario on the live deployment with `RESEND_API_KEY` set: an organizer fixes a sentence in the photo release for a 1,000-attendee event; 50 sequential rounds of 20 Resend calls run inside one Netlify function invocation, the request times out at 26s, ~300 people have been mailed, the organizer sees a generic error, presses Save again, and the first 300 get a second copy. Each mail carries a bearer link that lets whoever holds it sign a legal release in that person's name.

**5. Erasure joins on a lower-cased address while several collections store the address as typed.**
`apps/organizer/src/lib/person-data-core.ts:463` (and `:381`, `:387`, `:399`, `:421`, `:432`), `scripts/src/lib/email.ts:146`
`personKeys` normalises to `email.trim().toLowerCase()` (`ids.ts:86`) and every `match: { field: 'email' }` place compares with `==`. `send()` writes `to: input.to` verbatim, and its callers pass `registration.email` / row addresses straight through; the volunteer, certificate and `pendingAnswers` writers are the same shape. Failure scenario: an attendee registered as `Ada.Okonkwo@Example.com`. `erasePerson` reports "Emails we sent them — 0 found, anonymised", "Volunteer shifts — deleted", and the organizer is told the erasure completed; the `emailLog` rows with their address, name and template still exist and are returned by the next `emailLog` read. The subject-access export (`personExport`) misses the same documents, so the copy handed to the person is incomplete in exactly the places the deletion is.

**6. Erasure destroys the marketing opt-out record.**
`apps/organizer/src/lib/person-data-core.ts:391-394`
`marketingContact` is `erase: { do: 'delete' }` on `contacts/{contactId}`, and `unsubscribedAt` lives on that document. AGENTS.md records that an import never clears `unsubscribedAt` precisely because mailing an opted-out person takes the ticket receipts down with the newsletter. Failure scenario: somebody unsubscribes, then asks to be erased. The suppression row is deleted. The next CSV import of an older list recreates `contacts/{same id}` with no `unsubscribedAt`, and the next campaign mails a person who opted out and then asked to be forgotten — the worst possible recipient for a deliverability complaint.

**7. The only irreversible destroy in the dashboard has no step-up authentication.**
`apps/organizer/src/lib/person-data.ts:341-348`, `apps/organizer/src/app/(dash)/attendees/manage-attendees/attendees/person-data-actions.ts:24-37`
Refunds call `reauthenticate()` (`lib/auth.ts:418`) on the stated grounds that an unattended laptop at a registration desk is the normal state of a conference. `erasePersonAction` calls only `requireOrganizer()`, and the confirmation is typing an address that is printed on the same screen. Failure scenario: an eight-hour session cookie on an unattended machine; a passer-by opens an attendee, copies the address shown above the box, types it in, and permanently deletes that person's ticket, profile, messages, posts and Firebase Auth account. A refund is recoverable and this is not.

**8. `settings/appAccess` is readable by anyone who can create a Firebase account, and it carries the event join code.**
`firestore.rules:913-916`
`|| (signedIn() && key == 'appAccess')` — not `isRegistered()`, deliberately, so a closed app can still read the document that says it is closed. The projection includes `joinCode` and `joinCodeRequired` (`packages/shared/src/app-access.ts:47-50`). Failure scenario: anyone signs up with any email through the app's email/password box, reads `settings/appAccess`, and has the code the organizer reads out from the stage. Everything in the code and the copy is honest that this is a prompt and not a lock (`settings.ts:390-400`, `access-gate.tsx:78-94`), and the code is checked entirely client-side at `access-gate.tsx:108`, so nothing is bypassed that was ever enforced — but the dashboard screen is titled "Code Access Control" and its `info` panel should not be read as a gate. Worth confirming the organizer-facing copy on `tools/admin-control/code-access-control` says what it is.

**9. A speaker's self-supplied photo URL is published unvalidated onto the public site.**
`scripts/src/lib/speaker-portal-core.ts:77-86`, applied at `apps/organizer/src/lib/speaker-portal.ts:386-392`
`cleanUrl` accepts any `http:`/`https:` URL. On approve, `photoURL` is written to `speakers/{id}` and rendered on `/speakers` and in the app. Compare `firestore.rules:384-386`, where an attendee editing their own `photoURL` must supply a Firebase Storage URL. Failure scenario: a speaker (or whoever holds their link — see finding 2) sets `photoURL` to a server they control; every visitor to the public speakers page sends that host their IP and `Referer`, and the image can be swapped for anything after approval, with no further organizer action. Also likely to render broken if `next/image` has a remote-host allowlist.

**10. `isSafeHref` treats `/\host` as a relative link.**
`packages/shared/src/rich-text-core.ts:73-74`
`//host` is rejected, then `trimmed.startsWith('/')` returns true — so `/\evil.example` passes. The WHATWG URL parser treats `\` as `/` for special schemes, so a browser resolves `<a href="/\evil.example">` to `https://evil.example`. `apps/web/src/components/rich-text.tsx:34` then classifies it as our own page and omits `rel="noreferrer noopener"` and `target`. Low impact because page bodies are Admin-SDK-only and organizer-authored, but it defeats the stated purpose of the `//` check two lines above. The rest of this parser is sound: no HTML branch, no `dangerouslySetInnerHTML` in any of the three renderers, `javascript:` correctly rejected by the scheme allowlist (and `java\nscript:` cannot reach it because the inline regex excludes whitespace in the href).

**11. The erasure walk has no entry for `speakers` or `speakerProfileEdits`.**
`apps/organizer/src/lib/person-data-core.ts:183-490`
Failure scenario: a speaker who also bought a ticket asks to be erased. Their registration, profile, messages and posts go; their name, bio, photo, company and social links stay on the public `/speakers` page and in the app, and their submitted draft stays in `speakerProfileEdits`. The screen's "what survives" list (`person-data.ts:331-339`) names three things and this is not one of them, so the organizer is told the erasure is complete. Same class: `reviewers`, `submissions` and `teamMembers` are also absent from `PLACES`.

**12. `personKeys` now trusts a caller-supplied registration id.**
`apps/organizer/src/lib/person-data-core.ts:85`
This changed from always deriving `reg_` + sha256(email) to `input.registrationId ?? derived`, and the removed comment said the derivation existed so a stale id could not walk somebody else's ticket. Today the only caller passes an id it read from a document it fetched (`person-data.ts:126`), so nothing is exploitable — but the guarantee is now a property of one call site rather than of the function, and the `parsePersonRef('reg:<anything>')` path (`:118`) feeds arbitrary ids into `resolvePerson`. If a future caller passes an id and an email that disagree, the walk deletes across two people.

**13. `users/{uid}/notifications` is outside the access window.**
`firestore.rules:436-442`
`allow read: if isSelf(uid)` — no `isRegistered()`, so no `appOpen()`. Failure scenario: after the window closes, every other read is refused and the phone shows the "event has ended" screen, but the notification documents (titles and bodies of agenda changes) remain readable by that account indefinitely. Inconsistent with the rest of the window rather than dangerous; worth a deliberate decision either way.

**14. Every unknown single-segment URL on the public site reads the whole `pages` collection.**
`apps/web/src/lib/data.ts:745-767` (and `listPublicPages` at `:710`)
`getPublicPage` is `force-dynamic` and fetches `pages where eventId == EVENT_ID` with no slug filter, then scans in memory — and `generateMetadata` plus the page body each call it, so two full scans per request. `[slug]` is the root catch-all, so `GET /xyzzy` does this before 404ing. Failure scenario: a crawler or a trivial script walking `/aaa`, `/aab`, … turns every 404 into two full-collection reads against Firestore, billed, with no cache and no rate limit in front of it.

## Areas checked and found sound

- **The team roles guard.** `requireAccess()` (`apps/organizer/src/lib/auth.ts:352-370`) checks session, path and — via the Next action manifest — which screens import the posted action id; `middleware.ts:25-28` uses `set` not `append`, so a browser-supplied `x-kgc-path` is overwritten, and a plain-form POST is marked `form` and refused to every non-owner. Every new server action in the diff starts with `requireOrganizer()` / `requireOwner()`: `savePageAction`, `erasePersonAction`, `sendSpeakerLinkAction`, `decideSpeakerProfileAction`, `revokeSpeakerLinkAction`, the consent and access actions. The new `/export/person` route is outside `(dash)` and does its own `exportAccess('person')`, which is unlisted in `EXPORT_ROLE` and therefore owner-only — correct, since that file contains one person's messages. The two other new export kinds (`survey-answers`, `registration-answers`) are likewise unlisted and owner-only; only `sponsor-report` was added to `EXPORT_ROLE` (`team-core.ts:184`), and it is counts, not lead PII. Worth knowing rather than fixing: the `agenda` role covers all of `content`, which now includes publishing arbitrary pages to the public website and approving speaker profile text onto it.
- **Capability tokens.** `speaker-token.ts` follows the established scheme: length-checked `timingSafeEqual`, strict `t: 'spk'` discriminator, opaque payload with no address, 180-day TTL, stateless revocation via `linksValidFrom`. Cross-family replay under a shared `WEB_ORDER_SECRET` is blocked in both directions by payload shape (`order` requires `rid`, `consent` requires `fid`/`sub`, `speaker` requires `t === 'spk'`). Neither the link nor the token is written to `emailLog` — `send()` logs only `to`, `subject`, `template`, `actor` (`email.ts:145-152`). No secret is logged anywhere in the diff; `WEB_SPEAKER_SECRET` is only read, and the error message names the variable without printing it.
- **Passphrase handling.** `hashPassphrase`/`verifyPassphrase` are scrypt + `timingSafeEqual`, and `checkMemberPassphrase` hashes against a module-level `DECOY_HASH` when no member exists so the form does not answer "is this address on the team" by timing (`team.ts:100-113`). The setup link is a one-shot nonce whose hash is stored, expires in 3 days, rotates `sessionEpoch` on issue, and is signed with `CONSOLE_SESSION_SECRET` — not the shared passphrase.
- **`qrSecret` / `claimCode`.** Nothing in the diff writes either outside `ensureRegistration`; `grep` over the whole diff for both names returns no additions. `person-data.ts` only *reads* `qrSecret` as a lookup key for `scanEvents`, and both names are in `NEVER_EXPORTED` (`person-data-core.ts:534-543`), so the subject-access file omits them and says so. Note the omission is top-level only — `exportDocument` does not recurse — which is fine for the current document shapes but would miss a nested `token`.
- **Seats and waitlists.** Untouched by this diff; the fifth access call and the transactional seat path are all from HEAD. `tests/rules/session-seats.test.ts` still passes with the new sixth access call added to `isRegistered()`, so the 10-call limit is not breached.
- **Live project and test email.** No new script writes outside the dashboard actions; `writeAppAccessProjection` is only called from two organizer actions; `seed-demo.ts:640-660` gates the new `PAGES` fixtures behind `if (!live)` and prunes nothing from `pages`; sends are all behind `emailEnabled()` and land in `emailLog` as `skipped` with `RESEND_API_KEY` unset.
- **Markdown rendering.** No HTML path on any of the three surfaces; the parser returns blocks, all three renderers put span text in text nodes, and the dashboard preview has no `dangerouslySetInnerHTML`. Only the `/\` gap in finding 10.
- **Deploy prerequisites for the live project**, if this branch ships: the whole of `firestore.rules` (the access window, `messagingOn`, the `pages` block, the reply read/create rules, `joinedAt` on the `users` allowlist) and the one new composite index `pages(eventId ASC, published ASC)` in `firestore.indexes.json:511-524`. Until `scripts/ops/deploy-rules.mjs` runs, the app honours the access window and the live database does not — which `post-event-access-duration/page.tsx` already says.

# Screens and flows
Audit complete. No code was changed, so `tsc`/`npm test` were not run (nothing to break).

## Fit and layout: clean

34 pages measured (26 dashboard screens at 390, 8 website pages at 375). **Zero horizontal scroll, zero overflowing elements, zero clipped text nodes** on any of them. The phone shell and `Table stackSm` are doing their job. Metrics: `.../scratchpad/audit/r2a/metrics-390-b1.json`, `metrics-390-b2.json`, `.../r2w/metrics-375.json`.

All em dashes found on screen (28 on Attendees, 25 on Categories, 22 on Speaker Manager) are the bare `—` empty-cell marker in tables, not prose. Not a copy problem.

## Flows that worked end to end

| Flow | Proof |
|---|---|
| **Custom content page** | Created "Flow page 292397" on Customize Resources → `/flow-292397` on the website returns 200 and renders the Markdown body. `flows/pages-web.png` |
| **Join code / app access** | Typed `KGC-292397` → `settings/access.eventCode` written **and** the projection `settings/appAccess.joinCode = "KGC292397"` with `joinCodeRequired: true`, `closesAtMs: 1811217540000`. `joinCodeMatches` normalises both sides, so the hyphen is genuinely harmless. |
| **Post-event window** | Saved 23 days → banner "The app closes after 2027-05-30", `postEventDays` persisted. |
| **Attendee category** | Created "Flow 360875" → appears in the category list and as a filter chip on the attendee list. |
| **Team invite** | `flow.467369@example.test` + Check-in only → row appears with an `Invited` tag, and the passphrase link is shown to copy ("Email is not switched on yet, so nothing was sent… It works once and expires in 3 days."). |
| **Speaker self-service portal** | Submitted a bio at `/speaker/{token}` → portal says "Thank you, that is with the organizers. Nothing has changed on the website yet." → Speaker Manager now reads "1 waiting for you". |
| **Session cap** | Set 42 on one session → the row reads "0 of 42" after reload, and Tickets › Session RSVP agrees. |
| **Reports** | `/export/survey-answers` 41 rows, one per answer. `/export/registration-answers` 57 rows, one per person. `/export/sponsor-report` 18 rows with tracked links and clicks. `/export/attendees` 57 rows. The role gate (`exportAccess`) is on the route. |
| **Room sign** | `/rooms/bloomberg-165` renders now/next correctly at both widths. |
| **Live poll room view** | Real tallies, "Updated 22:02:14" in local time. |

## Problems

**1. A saved value does not appear in the box that saved it — and saving twice reverts it**
`apps/organizer/src/app/(dash)/tools/admin-control/access-form.tsx` (both `CodeAccessForm` and `PostEventForm`).
Typed `KGC-STALE1`, pressed Save. Banner: "Saved. Attendees are asked for KGCSTALE1 once…". The input reverted to the *previous* value `KGC-292397`. Only a page reload shows the new one. Same on `postEventDays`: typed 23, banner confirms 23 days, box still reads 17. An organizer who presses Save a second time writes the old value back. `session-form.tsx` already solves this with `key={`capacity-${values.version}`}`; these two forms lack it.
png: `.../scratchpad/audit/flows/access-code.png`

**2. A validation error wipes what the organizer typed**
`apps/organizer/src/app/(dash)/attendees/admin-settings/team.tsx` `InviteForm`.
Typed `keepme@example.test` / `Keep Me`, submitted with no role ticked. Correct message ("Pick at least one role.") but both fields come back empty — verified by reading `#email` and `#name` before and after.
png: `.../scratchpad/audit/flows/team-invite.png`

**3. Two panels on the check-in screen disagree about when the last scan happened**
`apps/organizer/src/app/(dash)/attendees/check-in-and-checkout/check-in/desk-table.tsx:162`.
The Arrivals panel footer reads "Last arrival 20 Sept, 21:20. Hours are New York time." The Recent check-ins table directly beneath it shows the same scan as "2026-09-21 01:20" — the UTC ISO string sliced. Machine clock at capture: Sun 20 Sep 21:45 EDT.
png: `.../scratchpad/audit/r2a/checkin-arrivals.png`

**4. Same UTC slice puts tomorrow's date on every round-two footer**
`admin-settings/page.tsx:123,124,173`, `code-access-control/page.tsx:57`, `post-event-access-duration/page.tsx:63`, `content/basics/page.tsx:100`, `tickets/question-form-screen.tsx:321`, `tools/moderator-tools/community-board/page.tsx:81,147`, and the `Last click` column of the sponsor report export. All read "Last changed … on 2026-09-21" while it is the 20th in New York. It is a pre-existing house pattern, but every new screen this round copied it.
png: `.../scratchpad/audit/r2a/attendees_admin_settings-1280.png`

**5. Duplicate DOM ids break the label-to-field link on three new screens**
`apps/organizer/src/app/(dash)/form.tsx:188` defaults a field's `id` to its `name`, so two forms on one screen collide. Measured live:
- `/attendees/manage-attendees/attendees` (edit panel + transfer panel): `name`, `email`, `title`, `company` each ×2. Playwright reports the accessible name as "Title Title".
- `/content/call-for-speakers-abstracts/reviewers`: `label`, `min`, `max`, `description` each ×**4** (add-a-criterion plus one inline edit per criterion), `reviewerId` ×2.
- `/content/speaker-center/speaker-manager`: `note`, `speakerId` ×2.

Clicking any of those labels focuses the first matching box, not the one beside it.
png: `.../scratchpad/audit/r2a/content_call_for_speakers_abstracts_reviewers-1280.png`

**6. Table headers break mid-word at desktop width**
`/content/logistics-center` renders "Sessio ns" and "Publish ed"; `/content/sponsor-center/sponsor-tiering` renders "Sponso rs" twice. Fixed narrow header cells with no `white-space` handling.
pngs: `.../r2a/content_logistics_center-1280.png`, `.../r2a/content_sponsor_center_sponsor_tiering-1280.png`

**7. Two new screens leave the Whova form vocabulary**
`access-form.tsx` uses a bare `<input>` with a local `.access-input` class instead of `.whova-text-input`, and a bare `<input type="checkbox">` instead of `.whova-checkbox-input`. Result: a thin default browser border where the rest of the dashboard has the Whova box, and a **13×13** checkbox on a phone (every other dashboard checkbox is 16×16, shell minimum is 32).
pngs: `.../r2a/tools_admin_control_post_event_access_duration-1280.png`, `.../r2a/tools_admin_control_code_access_control-390.png`

**8. "Send link" on a speaker row does not preselect that speaker**
Opening a speaker's `⋮` menu and choosing Send link jumps to the Speaker self-service panel and fires the browser's own "Please select an item in the list." on an empty `Send to` dropdown. The organizer has to find the same person again in a 45-entry select.
png: `.../scratchpad/audit/r2a/speaker-sendlink.png`

**9. The smallest bar on the projector screen loses its percentage**
`/engagement/live-polling/room/{sessionId}/{pollId}`: "We have stopped counting — 2 votes" is the only option with no `%` label, because the label sits inside the bar and the bar is too narrow. On a projector it reads as no data.
png: `.../scratchpad/audit/r2b/engagement_live_polling_room_a_graph_catalogue_for_machine_learning_features_7c558cc1_seed_poll_13-1280.png`

**10. Developer wording reaching an organizer**
- `/content/logistics-center`: every room row prints its slug in monospace under the name (`bloomberg-165`, `veec-classroom-1`).
- `/attendees/check-in-and-checkout/check-in`: the Recent check-ins table has a `Registration` column of raw ids (`reg_f36950d41bacf1d0a61c613c`).
- `/content/branding-center/customize-resources`: a `Length` column with a bare number (48, 386) and no unit.

**11. Content › Basics shows no current value for the two date fields**
Every other field on that form falls back to a grey placeholder showing the value in force. `Start Date` and `End Date` are empty `mm/dd/yyyy` boxes, so the one instruction in the ROUND-TWO deploy list ("save Basics once after the deploy") is performed against two blank dates with nothing saying what the event dates currently are.
png: `.../scratchpad/audit/r2a/content_basics-1280.png`

**12. Row actions are 14–17px tall on a phone**
Not shell-level — these are inline text links inside page bodies, which shell-notes leaves to each screen. Measured at 390: `Edit` 21×14 (live-polling), `Edit` 21×16 (logistics-center, customize-resources, consent forms, session-feedback), `Manage` 51×16 (session-rsvp), `Screen ↗` 53×16 (logistics-center), `Move up`/`Move down` 47–63×16 (reviewers), `Edit tiers` 43×12 (sponsor-manager). The `⋮` dropdown trigger is correctly 40px; these are not.

**13. ROUND-TWO.md §2 overstates what Sponsor Tiering does**
The doc says a tier carries "name, price, order, what is included and how many passes come with it". The screen has name, logo size and order only, and the source is honest about it: `sponsor-tiering/page.tsx:123` carries a gap note reading "Nothing models what a tier includes, so nothing can…" (hidden because `SHOW_GAP_NOTES` is off). The doc, not the screen, is the thing that is wrong.

**14. `/privacy` ships bracketed placeholders to the public**
`apps/web/src/app/privacy/page.tsx:43,46` render "[Legal entity name], [Registered postal address]". The page discloses this a line earlier ("The registered name and postal address are not filled in yet"), so it is honest rather than misleading, but it is a public legal page with fill-in-the-blank markers on it.
png: `.../scratchpad/audit/r2w/privacy-375.png`

## Environment notes, not defects

- `WEB_PUBLIC_ORIGIN` is unset on the running dashboard, so every minted reviewer and speaker link points at `https://www.knowledgegraph.tech/…`. I substituted `localhost:3200` to test. This is already item 5/10 on the ROUND-TWO deploy list.
- The emulator carries stray test data from earlier agents that reaches the public site: `settings/event.shortName` is **`KGC870092`**, so every website page title reads "… · KGC870092 2027" and the dashboard footer and rail say "KGC870092 EMS". Also a published page `/audit-737784`, a category "Volunteer 737784", attendees named "Aec Tester-Edited", and an announcement "Room 271 has moved to Classroom 4 (19:17:05)". Worth clearing before the next demo. Incidentally this is the strongest proof that editable event basics reach the website.
- The black "N" circle at the bottom-left of every screenshot is the Next.js dev indicator, not product UI.

## Things I did not reach

Transfer ticket, cancel registration, delete-a-person, consent-form signing, conditional registration questions, and the reviewer scoring submit were not driven end to end — the twelve features plus both widths plus the website set used the time. Their screens all render, fit 390 and carry plausible empty states; the writes behind them are unverified by me.