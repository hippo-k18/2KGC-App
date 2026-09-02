/**
 * Puts the published KGC 2026 speaker roster into Firestore.
 *
 *   npm run import:speakers-2026                    # dry run — prints, writes nothing
 *   npm run import:speakers-2026 -- --confirm-live  # actually writes
 *
 * ## What this is for
 *
 * The public `/speakers` page rendered `lib/speakers-2026.ts` directly: 137 real
 * people, checked in as a TypeScript array, edited only by a deploy. That was
 * the right call while the `speakers` collection held nothing but the invented
 * names `npm run seed` writes — but it meant the one page an organizer most
 * wants to edit was the one page the dashboard could not touch.
 *
 * This moves those 137 into the collection, unchanged, so Speaker Manager owns
 * them. Flip `SPEAKERS_PAGE_SOURCE` in `@kgc/shared` afterwards and the page
 * renders the same markup from the database instead of from the bundle.
 *
 * ## Three fields exist because the page must not change
 *
 * `displayOrder` preserves Whova's `display_dict` order verbatim, quirks and
 * all — including the `(Phil) (Meredith)` row that sorts first and that any
 * honest surname sort would quietly move. `featured` carries Whova's
 * `design.highlight_speakers` five, which `SpeakerDoc` previously had no way to
 * express. `photoWidth`/`photoHeight` reserve the portrait box so 137 circular
 * images do not reflow the page as they arrive.
 *
 * ## What it deliberately does not do
 *
 * **It does not delete anything, and it does not call `pruneStale`.** The
 * `speakers` collection also holds the seeded demo speakers, and every one of
 * them is pointed at by a `SessionDoc.speakerIds`. Removing them is a separate
 * decision with a visible consequence on the agenda, so it is a separate
 * command — not a side effect of an import.
 *
 * **It does not touch `sessionIds`.** These 137 spoke at KGC 2026; the sessions
 * in the database are the invented 2027 demo programme. Attaching them would
 * put a real person's name on a talk they never gave, which is the exact harm
 * the whole `SPEAKERS_PAGE_SOURCE` switch was built to avoid. Every imported
 * speaker gets `sessionIds: []` and stays that way until a real programme
 * exists.
 *
 * ## Re-running it
 *
 * Ids come from `speakerId(name, company)`, so a second run updates the same
 * 137 documents rather than duplicating them. It writes with `merge: true`, so
 * a bio or a contact address an organizer added in the dashboard survives a
 * re-import — the roster has neither field and would otherwise erase both.
 * ⚠️ Correcting a name or an employer in the roster changes the id, which
 * orphans the old document rather than renaming it. `pruneStale` is what
 * normally cleans that up and is unusable here for the reason above, so a
 * correction means deleting the stale document by hand.
 */
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';

import { commitAll, targetDescription, type PendingWrite } from './lib/firestore.js';
import { speakerId } from './lib/ids.js';
import { SPEAKERS_2026 } from './lib/speakers-2026.js';

const args = process.argv.slice(2);
const live = args.includes('--confirm-live');

function main() {
  const writes: PendingWrite[] = [];
  const seen = new Map<string, string>();

  SPEAKERS_2026.forEach((s, i) => {
    const id = speakerId(s.name, s.company);

    /*
     * Two people on the roster share a name, which is why `SpeakerCard` keys on
     * `name-index` rather than on the name. Here the company disambiguates
     * them, so a collision means two rows are genuinely the same person listed
     * twice — worth saying out loud rather than silently overwriting.
     */
    const previous = seen.get(id);
    if (previous) {
      console.warn(`  ! duplicate id ${id}: "${previous}" and "${s.name}" — later row wins`);
    }
    seen.set(id, s.name);

    writes.push({
      collection: COLLECTIONS.speakers,
      id,
      data: {
        eventId: EVENT_ID,
        name: s.name,
        // The roster's `role` is the person's job title; `SpeakerDoc` calls it
        // `title`, and the card calls that slot `role` again. Same string.
        ...(s.role ? { title: s.role } : {}),
        ...(s.company ? { company: s.company } : {}),
        ...(s.photo ? { photoURL: s.photo } : {}),
        ...(s.width ? { photoWidth: s.width } : {}),
        ...(s.height ? { photoHeight: s.height } : {}),
        ...(s.featured ? { featured: true } : {}),
        displayOrder: i,
        sessionIds: [],
        /*
         * A native `Date`, not `FieldValue.serverTimestamp()`. Sentinels are
         * class instances validated with `instanceof`, and this package
         * resolves its own copy of `firebase-admin` — one built here and handed
         * to a store created in `apps/web` fails the entire write. AGENTS.md
         * gotcha 8; it took the purchase flow down once already.
         */
        updatedAt: new Date(),
      },
    });
  });

  const featured = SPEAKERS_2026.filter((s) => s.featured).length;
  const noPhoto = SPEAKERS_2026.filter((s) => !s.photo).length;

  console.log(`\nKGC 2026 speaker roster → ${targetDescription()}`);
  console.log(`  ${writes.length} speakers`);
  console.log(`  ${featured} featured (Whova's "Our First Speakers")`);
  console.log(`  ${noPhoto} without a portrait`);
  console.log(`  sessionIds: [] on every one — these are 2026 talks, not the 2027 programme`);
  console.log('  merge: true — bios and contact addresses added in the dashboard survive');

  if (!live) {
    console.log('\n  DRY RUN. Nothing was written. Re-run with --confirm-live to commit.\n');
    console.log('  First five:');
    for (const w of writes.slice(0, 5)) {
      console.log(`    ${w.id}  ${w.data.name} — ${w.data.company ?? 'no company'}`);
    }
    console.log('');
    return;
  }

  void commitAll(writes).then((n) => {
    console.log(`\n  Wrote ${n} speakers.`);
    console.log('  Next: set SPEAKERS_PAGE_SOURCE to \'firestore\' in packages/shared/src/speakers-page.ts');
    console.log('  ⚠️  Do not flip it while the seeded demo speakers are still in the collection —');
    console.log('     the public page would publish invented names.\n');
  });
}

main();
