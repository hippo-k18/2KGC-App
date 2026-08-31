# Follow-ups handed back by implementation agents

Items an agent found but could not fix because another agent owned the file.
Pick these up in a later wave.

## From the website wave (3.2, 3.3, 4.2, 4.6)

**FU-1 · RESOLVED 2026-08-30.** Fixed while task 0.7 rewrote `ticket-form.tsx`
on the new form vocabulary; the preview now follows the selected currency.
Original report follows.

**The ticket editor's price preview is hard-coded to USD.**
`apps/organizer/src/app/(dash)/tickets/ticket-setup/1-1-create-tickets/ticket-form.tsx:88-92`
builds `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
with a literal `'USD'` — four lines below the `<select name="currency">` at
`:80-84`. Selecting EUR shows a dollar preview on a money screen.
Fix: lift the select into React state and pass it as `currency`.

**FU-2 · The dashboard half of 4.6 — the readiness screen still reports on a
page that does not render those speakers.**
`apps/organizer/src/lib/webpages.ts:95-107` counts Firestore speakers with no
photo / bio / company and files them under `path: '/speakers'`. The public page
renders the published 2026 roster instead, deliberately, now switched by
`apps/web/src/lib/site.ts:136` (`SPEAKERS_PAGE_SOURCE`).

The two apps are separate installs and neither may import the other, so
`webpages.ts` needs its own copy of the constant, kept in step by comment:

1. Add `SPEAKERS_PAGE_SOURCE` beside `origin()` (~`:41`), commented to point at
   `apps/web/src/lib/site.ts:136` for the argument.
2. While it is `'2026-roster'`: return `problems: []`, `published: 0`, and a
   one-line honest caption. `PageReadiness` has no slot for that — add a fourth
   optional `note?: string` rather than smuggling it into `problems`, which is
   rendered as a defect list.
3. **Do not delete the counting code.** It is correct and is what the screen
   needs the day the flag flips. Gate it, do not remove it.
4. `ROADMAP.md:203-206` defends the hardcoding in prose but predates the
   constant; it should now name `SPEAKERS_PAGE_SOURCE` as the switch.

## From the attendee-app wave (4.9, 4.10, 4.12)

**FU-3 · `tests/rules` needs two counting cases the board now depends on.**
The Q&A board and the community board now count `upvotes` and `reactions`
subcollections client-side (`app/src/lib/data/counts.ts`). That an attendee is
*allowed* to do so was verified by an emulator probe, not pinned by a test —
unlike the reply count, which has one at `tests/rules/firestore.test.ts:885`.
Add the two `getCountFromServer` cases beside it. The board depends on those
permissions the same way it depends on the reply one.

**FU-4 · ★ Audit E's recommendation for 4.10 was wrong, and the correction is
worth keeping.** `E-linkage.md:480` says to port `apps/organizer/src/lib/
polls.ts:17-27` into the app by counting `votes` documents. **The app cannot.**
`firestore.rules:470` makes a ballot secret (`allow read: if isSelf(uid) ||
isOrganizer()`), so a `list` or `count()` over `votes` is denied to an attendee
even for a poll they voted in. The dashboard gets the true number only because
the Admin SDK bypasses rules.

A copied aggregation would have passed `tsc`, passed locally, and rendered
every poll as though nobody had voted. The app therefore ports the dashboard's
*reasoning* — never print a frozen tally to a live audience — rather than its
mechanism, via `tallyState()` in `app/src/lib/data/qa-core.ts:115`.

**Why this matters beyond this one task:** it is the `AGENTS.md` defect class
("the app claims a capability it does not have") reappearing inside an audit
recommendation. Verify a proposed read against the rules before implementing it.

## From the functions-hardening wave (0.3, 0.4)

**FU-5 · The "14 trigger tests" figure is stale everywhere it appears.** The
functions suite baseline was **32** tests before any of this session's work
(now 40). `AGENTS.md`, `ROADMAP.md` and `BUILD-PLAN.md` all repeat 14. Correct
them in the Wave 6 documentation pass, and treat every other test count in the
docs as unverified until the suite prints it.

**FU-6 · RESOLVED 2026-08-31.** `RateLimitDoc` now carries `expiresAt`, and
the local `EmailRateLimitDoc` alias in `request-otp.ts` is gone. All four
workspaces typecheck. Original report follows.

**`RateLimitDoc` in `@kgc/shared` needs an `expiresAt` field.** The OTP
hardening added `expiresAt` to every `rateLimits` document so a Firestore TTL
policy can reap them, but the shared type was not widened — that file was
outside the agent's scope — so `request-otp.ts` declares the field locally.
Widen the shared type and drop the local declaration.

**FU-7 · A pre-existing crash was found and fixed, and it suggests a pattern to
check for.** `onAnnouncementCreate` threw `TypeError: Cannot read properties of
undefined (reading 'eventId')` twice per test run: `if (!snap) return` guards
the snapshot but **not** `snap.data()`, which is undefined on a delivery whose
document has since been deleted. Both fan-out triggers are now guarded. Worth
grepping the remaining triggers for the same shape.

## From the sponsor wave (2.5, 2.6)

**FU-8 · ⚠️ The website shadows uploaded sponsor logos.**
`apps/web/src/lib/data.ts:214-249` — `localLogo()` prefers a self-hosted
`/kgc/sponsors/{slug}.png` over whatever Firestore holds, for 18 whitelisted
slugs. So uploading a new logo for one of those eighteen changes the app and the
dashboard and **not** the public page. Removing a slug from `SELF_HOSTED_LOGOS`
is what hands control back to the form. Stated on-screen in the dashboard's gap
panel so nobody debugs it twice.

**FU-9 · The seed still writes Whova's CDN into `logoURL`.**
`scripts/src/lib/fixtures.ts:159-227` and `seed-demo.ts:192` write `logoRemote`
(18 URLs on `d1keuthy5s86c8.cloudfront.net`) straight into `logoURL`. Once real
logos are uploaded these should seed a blank `logoURL` — the dashboard already
flags "no logo" actionably — or point at self-hosted copies.

⚠️ **FU-8 and FU-9 are one commit, not two.** Retiring the whitelist without the
fixtures, or the reverse, leaves the public page and the app disagreeing about
what a sponsor's logo is.

**FU-10 · `SponsorDoc` has no status field, so a sponsor cannot be retired.**
The exhibitor pattern retires via `status: 'cancelled'`; `SponsorDoc` has no
equivalent, and neither `apps/web`'s `listSponsors()` nor the app's
`useSponsors()` filters one. A "Retire" button today would set a field nobody
reads, leave the sponsor on the public page and in the app, and report success —
so it was deliberately not built. The order is: add the field to `@kgc/shared`,
filter it in **both** readers, then add the control.

## From the ticketing wave (Wave 3, dashboard half) — the `apps/web` half

All six are also rendered in the gap panel on Tickets 1.1 behind
`SHOW_GAP_NOTES`, so they are visible to whoever opens that screen.

| # | File and line | Change |
|---|---|---|
| 3.4 | `apps/web/src/app/api/stripe/webhook/route.ts`, `charge.refunded` → `lib/registrations.ts:297+` | ⚠️ **The refund path should decrement `quantitySold`.** `FieldValue.increment(-n)` per `OrderLine.ticketTypeId`, guarded the way the `result.created` guard at `route.ts:406` guards the increment so a replay cannot double-decrement, and best-effort like `catalogue.ts:182-194` so a lost counter never fails a refund. **Full refunds only** — a partial refund leaves a valid ticket. |
| 3.5 | `apps/web/src/lib/registrations.ts:227-243` | Write `users/{uid}/entitlements` from `includesWorkshops` / `includesVideoLibrary` at fulfilment, and withdraw on refund so both move together. This is the *only* remaining half of 3.5. |
| 3.6 | `apps/web/src/app/tickets/page.tsx:93-94` | Select the two panels by `tier.featured` rather than the hard-coded `all-access` / `main-conference` slugs. Same file: render `tagline`, which already renders on the order rail and on `audience-page.tsx:119`. |
| 3.7 | `apps/web/src/app/api/stripe/webhook/route.ts:226-237` (`invoice.paid`) | Re-check capacity per seat before registering, as `tickets/invoice/actions.ts:121` does when the invoice is raised. Flag or refuse rather than registering silently. |

⚠️ 3.2 and 3.3 on this list were **already done** by the earlier website wave —
verify before redoing them.

**FU-11 · Audit A's `includesWorkshops` finding was wrong.** It claimed a tier
created from the dashboard could never include workshops. The form already
carries both entitlement checkboxes and `saveTicketTypeAction` already reads
them. The stale gap-note bullet has been deleted. Recorded here because it is
the second audit recommendation this session that did not survive contact with
the code — see FU-4. **Verify an audit claim against the source before building
on it.**

## From the unsubscribe / exhibitor wave (3.11, 4.4)

**FU-12 · The app half of the exhibitor listing.**
Add an Exhibitors segment to the People tab. Read `exhibitors` and `booths` with
two single-equality `where('eventId','==',EVENT_ID)` queries — **no composite
index exists for either**, so sort and join in memory. Filter
`status === 'confirmed'`; take the booth number from a `booths` doc whose
`exhibitorId` matches **and** whose `status === 'assigned'`
(`ExhibitorDoc.boothNumber` is unreconciled free text, and a `held` booth is
promised but unpaid). Group by `booths.zone`.

⚠️ **Both collections are Admin-SDK-only with no `firestore.rules` match block**,
so a client read is denied today. A rule — or a `directory`-style projection —
is a prerequisite, not an optional extra. `logoURL` is absent on every exhibitor;
do not render a Whova CDN URL if one appears.

When it ships, restore "in the app" to `apps/web/src/app/tickets/exhibitor/page.tsx:61`,
which was narrowed to describe only the listing that now exists.

**FU-13 · ⚠️ `tickets/exhibitor/page.tsx:44` still sells lead scanning** into
"your exhibitor portal". There is no scanner, no writer for
`sponsors/{id}/leads`, and no portal. Still false. It belongs to task 5.4
(capability-token self-service), so it was flagged rather than fixed.

**FU-14 · ★ A compliance-grade bug found by exercising rather than asserting.**
The `List-Unsubscribe` header pointed at `/u/{token}`, the *page* route. Gmail
POSTs to whatever that header names, and a POST to the page returned **HTTP 200
and did nothing** — Gmail would have shown the recipient "Unsubscribed" while
they stayed on the list. Now fixed (header → the RFC 8058 API route, body link →
the page). Recorded because the failure was completely invisible to typecheck,
to the build, and to reading the code.

## From the app-surfaces wave (4.3, 4.4-app, FU-3)

**FU-15 · ⚠️ Nothing writes `exhibitorListings` on the live project except the
seed.** The app now reads a projection — `exhibitorListings/{exhibitorId}`, to
`exhibitors` what `directory/{uid}` is to `users` — because `ExhibitorDoc`
carries contact names, pass allocations and a `provisional` status that names a
booth nobody has paid for, and rules filter documents rather than fields.

The production writer is a trigger on `exhibitors/{id}` shaped like
`mirrorDirectory`, and it does not exist yet. `scripts/src/seed-demo.ts:416`
projects only `status === 'confirmed'` exhibitors so the surface has data
locally. The screen's empty state says the list is published separately rather
than implying no exhibitors are booked.

**FU-16 · RESOLVED 2026-08-31 — the third instance of the thread-id claim.**
`packages/shared/src/collections.ts`, the `threadIdFor` docblock, still asserted
that the rules prove membership from the path and that "Firebase uids are
alphanumeric". Both false, and `AGENTS.md` says a third instance is a bug. The
docblock now records the actual guarantee and the history.

## From the OTP-delivery wave (1.2)

**FU-17 · ★ A latent bug in the shared email sender, fixed.** `send()` in
`@kgc/scripts/src/lib/email.ts` spread four optional correlation fields into
every `emailLog` entry as `undefined`, which Firestore rejects — and `log()`
catches its own errors by design, so it failed **silently**. It only ever worked
because both existing callers run `settings({ ignoreUndefinedProperties: true })`.
`functions/` does not, so `requestOtp` was the first caller to expose it.

Fixed in the module (`defined()` strips undefined keys) rather than by enabling
that setting in `functions/` — the setting is store-wide and is also what makes
gotcha 9 possible. **Without this fix, delivery would have "worked" in
production while `emailLog` recorded nothing** — the exact record support needs
when an attendee says no code arrived.

**FU-18 · The sign-in email deliberately has no link.** Every other template has
a button. A sign-in mail with a clickable link is the shape of the phishing mail
an attacker would send, and teaching attendees ours has one makes theirs work
better. Do not "improve" it by adding one.

## From the settings wave (4.1, 5.6)

The dashboard half is done: `settings` now has a contract in `@kgc/shared`
(`packages/shared/src/settings.ts`) holding the key names, the value shapes, one
set of defaults and `SETTINGS_REGISTER` — a per-field record of which install
reads what. Five screens render that register rather than describing themselves
in prose, and `saveSettings` clears a field with `FieldValue.delete()` rather
than leaving it in place (AGENTS.md gotcha 9, proven against the emulator, not
assumed).

The two items below are the halves this agent could not touch. **Both are
one-line changes in `SETTINGS_REGISTER` plus the reader**, which is the point of
the register existing: flip the entry and every screen that mentions the field
follows.

⚠️ **`SETTINGS_KEYS` lost three members.** `event-website`, `registration` and
`app-adoption` were never written *or* read by anything and are deleted. If a
grep of yours misses, that is why. Add a key back in the same commit as the
screen that writes it.

**FU-19 · The website half — `apps/web` reads `settings/branding`.**

`apps/web` is the achievable surface: it is server-rendered with the Admin SDK,
which bypasses `firestore.rules`, so it needs no rules change and no deploy —
unlike the app (FU-12). Four fields are `pending` on it.

1. **Add the reader** to `apps/web/src/lib/data.ts`, beside the other reads and
   through `safely()` (`:61`) — a settings document that cannot be fetched must
   degrade to the constants, not 500 the homepage:

   ```ts
   export async function brandingSettings(): Promise<BrandingSettings> {
     return safely('brandingSettings', async () => {
       const doc = await db().collection(COLLECTIONS.settings).doc(SETTINGS_KEYS.branding).get();
       const d = doc.data();
       if (!doc.exists || d?.eventId !== EVENT_ID) return SETTINGS_DEFAULTS.branding;
       return { ...SETTINGS_DEFAULTS.branding, ...(d.values ?? {}) };
     }, SETTINGS_DEFAULTS.branding);
   }
   ```

   ⚠️ Spread the defaults **under** the stored values and drop any stored value
   whose `typeof` does not match the default's. Documents written before
   2026-08-31 hold `null` for cleared fields, and a raw spread puts `null` where
   a `string` is declared — which is how a page ends up printing "null".
   `apps/organizer/src/lib/settings.ts` `usable()` is the four-line version.

2. **`tagline`** — `apps/web/src/app/layout.tsx:25` (`openGraph.description`)
   and `apps/web/src/lib/site.ts:33`. `metadata` is a static export today;
   reading Firestore means converting it to `generateMetadata()`. Keep
   `SITE.tagline` as the fallback rather than deleting it — an empty setting
   must not blank the OG description.

3. **`supportEmail`** — ⚠️ **do not** repoint `SITE.contactEmail`
   (`site.ts:34`). It has **13 call sites** and `site.ts`'s own docblock says
   client components read it; a Firestore read cannot go there. Wire the one
   server-rendered place first: `apps/web/src/components/site-footer.tsx:23`,
   passing the resolved address in as a prop from the layout. The other twelve
   stay on the constant until somebody decides they should not.

4. **`brandedSlug`** — create `apps/web/src/app/[slug]/page.tsx`. It reads the
   setting, compares it to the segment, and `notFound()`s otherwise. ⚠️ A
   catch-all at the root shadows nothing today but will collide with the next
   top-level route added, so match exactly and 404 on anything else. The
   dashboard screen (`content/branding-center/branded-event-url`) already tells
   the organizer this address does not resolve; that copy comes down when this
   lands.

5. **`hashtag`** — nothing prints one yet. Leave it `pending` until something
   does; a reader with no renderer is the defect this whole task is about.

6. **`brandColor` / `accentColor` are `recorded`, not `pending`. Leave them.**
   The website's palette is hand-tuned CSS whose contrast pairings were fixed
   deliberately (three of Whova's own fail WCAG AA). Re-skinning it from an
   organizer's hex is a decision somebody has to make, not a wiring gap, and the
   register says so on the screen.

**Then flip `SETTINGS_REGISTER.branding.<field>` in
`packages/shared/src/settings.ts` to `{ status: 'live', readers: ['web'] }`.**
The Branding Center's save message and its reach table are both generated from
it — no dashboard edit is needed, and none should be made.

**FU-20 · The app half — the emergency card on a phone.**

`settings/logistics` is written by Virtual & Hybrid › Logistics Management ›
Emergency Manager and read back by Content › Logistics Center. An attendee
cannot see it, and the emergency card is the one settings bag where that
actually matters.

⚠️ **This is blocked on `firestore.rules`, not on a hook.** `settings` has **no
`match` block at all**, so the client SDK is denied by the default-closed
posture — a hook written without the rule returns `permission-denied` and, given
`use-collection.ts`'s error handling, renders as an empty state rather than an
error. Order matters:

1. **The rule, first.** `firestore.rules`, beside `match /announcements/{id}`
   (`:515`) — same audience, same shape:

   ```
   match /settings/{key} {
     allow read: if isRegistered() && key == 'logistics';
     allow write: if false;   // Admin SDK only, like every other settings write
   }
   ```

   ⚠️ **Do not open the whole collection.** `settings/access` holds `eventCode`
   — a shared secret read out from the stage — and `staffNote`, which is
   internal. Rules filter documents, not fields, so a blanket
   `match /settings/{key}` hands both to every phone. If any *field* of
   `logistics` turns out to be internal (`incidentProcedure` is the candidate),
   project it the way `exhibitorListings` projects `exhibitors` rather than
   widening the rule.

2. **Deploy the rule.** `firebase deploy` is refused on this project
   (`serviceusage` 403); the path is `node scripts/ops/deploy-rules.mjs`. The
   emulator does not enforce the *absence* of a rule any more than it enforces
   an index, so a local pass proves nothing here.

3. **The hook.** `app/src/lib/data/logistics.ts`, modelled on
   `app/src/lib/data/announcements.ts:20` but using `useDocument`
   (`app/src/lib/data/use-document.ts:40`) — one document, not a query, so no
   composite index is involved. Import `SETTINGS_KEYS`, `SETTINGS_DEFAULTS` and
   `LogisticsSettings` from `@kgc/shared`; never spell `'logistics'` as a
   literal. Apply the same `typeof`-guard as FU-11 step 1.

4. **Gate on `planReady`.** The organizer's own assertion that the card is worth
   showing. A half-filled emergency card during an emergency is worse than none,
   which is why the field exists and why the dashboard refuses to set it with
   neither an assembly point nor a lead.

5. **The screen.** There is already a tile for it:
   `app/src/app/(tabs)/home/index.tsx:508-514`, `label: 'Logistics'`, whose
   `notBuilt` copy reads *"These live on an event document that does not exist
   yet — there is no events collection to read it from."* **That copy is now
   wrong** — the bag exists and is written weekly. Route the tile at a real
   screen, or at minimum correct the sentence. It is the same stale-gap-copy
   defect the Surveys tile two entries below it already had fixed (`:524`).

6. **Colours are not part of this.** `useTheme()` resolves at build time from
   `app/src/constants/theme.ts` and `FORCE_LIGHT` is deliberate. A runtime theme
   needs a fetch, a first-paint fallback and a re-render of every screen — a
   change to how the app boots, not a settings read. `SETTINGS_REGISTER` marks
   both colour fields `recorded` for exactly this reason; **do not flip them.**

**Then flip the `logistics` entries to `{ status: 'live', readers: ['app'] }`.**

**FU-21 · Two unused imports found in passing, left alone.**
`apps/organizer/src/app/(dash)/attendees/check-in-and-checkout/check-in/page.tsx:14`
(`ROUTES`) and `apps/organizer/src/app/(dash)/tools/admin-control/actions.ts:3`
(`revalidatePath`) are both `no-unused-vars` warnings that predate this work.
Not removed, because other agents hold those files this session and a one-line
import deletion is a pointless merge conflict. Sweep them in the Wave 6 pass.

---

**FU-15 · RESOLVED 2026-08-31 — `exhibitorListings` now has a production
writer.** Two Firestore triggers, both in `functions/src/triggers/`, both
specified in `functions/SPEC.md` (rows #11-#12, decisions 18-19):

- **`mirrorExhibitorListing`** on `exhibitors/{exhibitorId}` — the `directory`
  mirror's twin. Publishes only `status === 'confirmed'` and **deletes** the
  listing on every other status and on the exhibitor's own deletion, so a
  company that pulled out or never paid stops being published on the next fetch
  and its record leaves the server rather than travelling with a flag on it.
  Projects exactly the six `ExhibitorListingDoc` fields, named one by one rather
  than spread, so a field added to `ExhibitorDoc` later cannot leak silently.
- **`onBoothAssignmentWrite`** on `booths/{boothId}` — re-projects the occupant
  before and after an occupancy change (`exhibitorId` / `status` / `number`
  only; a `note` or `zone` edit does nothing).

⚠️ **`boothNumber` is resolved from `booths`, not copied from
`ExhibitorDoc.boothNumber`.** That field is unvalidated free text, and
`assignBooth` writes it as a best-effort denormalisation *outside* its own
transaction — audit C's split-brain. Decisively, `assignBooth` writes it on a
**hold** too, so publishing it would advertise an unpaid space, which is the
booth-level twin of the `provisional` status this projection exists to suppress.
The number now comes from a booth whose `exhibitorId` matches **and** whose
`status === 'assigned'` — the rule `listExhibitorsByZone` in `apps/web` already
applied independently. That is what makes the second trigger necessary; the
alternative considered and rejected was publishing no number at all, which would
have cost the app the field it sorts the hall by.

**Not resolved by this, and worth knowing:** the free-text
`ExhibitorDoc.boothNumber` still exists and the console still writes it. Nothing
attendee-facing reads it any more, but the organizer's exhibitor manager and
`message-exhibitors` screens still print it, so the two can still disagree on a
dashboard screen. Reconciling or removing that field is a separate change and
belongs to whoever owns `apps/organizer`.

⚠️ **`docs/deploy-functions.md` is now stale, and one of its checks was already
wrong before this change.** It was left alone because another agent wrote it
today and it is outside this task's scope. Three corrections it needs before the
first deploy:

1. "Twelve deployable units" and its twelve-row table are now **fourteen**.
2. Step 7 says to expect "40 tests across 10 files". The real figure is now
   **55 tests across 11 files** (it was 46 across 10 immediately before this
   work — the 40 was already stale).
3. ★ Step 7's `grep -rln "TRIGGER\|SERIAL_FANOUT_TRIGGER\|PUBLIC_CALLABLE"`
   says "Expect exactly 12 files". **It never printed 12.** `request-otp.ts`
   carries `OTP_REQUEST_CALLABLE`, which that pattern does not match, so the
   grep printed 11 before this change and prints 13 now. Adding
   `\|OTP_REQUEST_CALLABLE` to the pattern makes it print **14**, which is the
   number the step is actually trying to assert. Fix the pattern, not just the
   expected count — a check that has never once printed its documented answer is
   a check nobody has run.

Verified: `npm run build --workspace=functions` clean, `npm run test:functions`
**55 passed (55), 11 files** — the 46 that were there before, plus nine new ones
in `tests/functions/mirrorExhibitorListing.test.ts`. Run twice, same result.
Nothing was deployed.

## From the website-CMS wave (FU-19, FU-8/FU-9, 4.7)

**FU-22 · ⚠️ OPS — the live project still holds the 18 CloudFront URLs.**
The code no longer produces them: the seed writes `logoURL: ''` and the website
drops any `FOREIGN_CDN` URL outright. But the documents already on the live
project keep their Whova CDN values until someone runs `npm run seed` against
it — and **the app renders `logoURL` directly**, so until that re-seed the
attendee app still shows Whova's CDN while the website does not.

★ The seed writes `''` rather than omitting the key, and that is the substance
of the fix: `commitAll` writes `{ merge: true }` with `ignoreUndefinedProperties`
(gotcha 9), so an omitted key would have left all 18 URLs in place forever while
the code claimed otherwise. `FieldValue.delete()` is barred there by gotcha 8.

**FU-23 · A rules test for `pageContent`.** The new page-content collection is
Admin-SDK-only and relies on default-deny; there is no test asserting a client
cannot read it. Add one beside the `ticketTypes` cases, which make the same
assertion for the same reason.

**FU-24 · The dashboard editor for page content.** Specified but not built —
`apps/organizer` was out of that agent's scope. A Content › Event Webpages child
screen per key: read via a `readPageContent(key)` mirroring `readSettings()`;
write only changed fields, `FieldValue.delete()` for a cleared one, never a
partial nested map; a repeater for `dates` / `committee`; one `appendAudit` per
save. ⚠️ **It must show the page's own constant as the placeholder for an unset
field** — "empty" here means "the site uses its built-in copy", not "the section
is gone". An empty list is deliberately *ignored* by the reader so a cleared
repeater cannot blank the code of conduct; a real "remove this section" needs
its own control.

**FU-25 · Prose pages deliberately left in React, and why.** `/about` (five
hand-measured bands with per-band colour; its content changes on the order of
never, and storing it as HTML makes an organizer's text box an injection point
on a public page), `/team` (every entry needs a headshot committed to `public/`,
so adding a person is a deploy regardless — a store that renames a role but
cannot add a colleague is the half-CMS to avoid), and the **code of conduct's
policy body** (changing it is a legal act with a named enforcement consequence
and should leave a reviewable history; there is no approval step behind a text
box). What *was* moved from the conduct page is the reporting route — the part
that goes stale and fails the one person the page exists for.
