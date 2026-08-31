import { COLLECTIONS } from '@kgc/shared';
import type { ExhibitorDoc } from '@kgc/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { publishExhibitorListing } from '../lib/exhibitor-listing.js';
import { TRIGGER } from '../runtime-options.js';

/**
 * `exhibitors/{exhibitorId}` — see functions/SPEC.md #11.
 *
 * The production writer of `exhibitorListings/{exhibitorId}`, which is to
 * `exhibitors` exactly what `directory/{uid}` is to `users`: a projection that
 * exists because `ExhibitorDoc` carries three things a thousand attendees must
 * not receive — `contactName`/`contactEmail` (a readable exhibitor list is a
 * harvestable address list), `passesAllocated`/`passesUsed` (the commercial
 * terms of the package bought), and a `status` where `provisional` names a
 * space promised in a sales conversation nobody has paid for. Firestore rules
 * decide whether a whole document may be read; they cannot withhold a field, so
 * no predicate on `exhibitors` hands over the company name and keeps the rest.
 *
 * Until this existed, `npm run seed` was the only writer of the collection
 * (`scripts/src/seed-demo.ts`), which meant the app's exhibitor hall was as
 * fresh as the last seed locally and permanently empty on the live project.
 *
 * ── Absent rather than filtered ─────────────────────────────────────────────
 *
 * Only `status === 'confirmed'` publishes, and anything else **deletes** the
 * listing rather than flagging it — the same answer `mirrorDirectory` gives an
 * attendee who opts out mid-conference. An exhibitor who withdraws in March
 * must stop appearing on the next fetch, not on the next write, and the record
 * must leave the server rather than travel with a flag on it. The publish rule
 * is stated identically and independently in two other places —
 * `scripts/src/seed-demo.ts` and `listExhibitorsByZone` in
 * `apps/web/src/lib/data.ts` — and all three must stay in agreement.
 *
 * ⚠️ NEVER ADD A TRIGGER ON `exhibitorListings/{id}` THAT WRITES BACK TO
 * `exhibitors/{id}`. This function writes the listing on every write to the
 * exhibitor; a trigger going the other way closes the circuit, and the result
 * is an unbounded loop between two documents running at whatever rate Eventarc
 * will deliver, billing every hop. Nothing guards against it — v2 triggers
 * match an exact path, which is the only reason none of the functions in this
 * codebase can loop, and that property protects you only until somebody
 * registers the second half. The identical warning is on `mirrorDirectory`,
 * and it is the same hazard.
 *
 * `firestore.rules` already refuses every client write on
 * `exhibitorListings/{id}`, so this trigger and the seed are the only writers
 * and no organizer edit can race them.
 */
export const mirrorExhibitorListing = onDocumentWritten(
  { document: `${COLLECTIONS.exhibitors}/{exhibitorId}`, ...TRIGGER },
  async (event) => {
    const { exhibitorId } = event.params;

    /*
     * `.data()` is guarded, not just the snapshot.
     *
     * `after.exists` and `after.data()` are not the same question: a delivery
     * for a document that has since been deleted arrives with a snapshot whose
     * payload is `undefined`, and reading a field off it throws. That exact
     * crash was found in `onAnnouncementCreate` and is not being reintroduced
     * here — `publishExhibitorListing` takes `ExhibitorDoc | undefined` and
     * treats undefined the same way it treats `cancelled`: delete the listing.
     */
    const after = event.data?.after;
    const exhibitor = after?.exists ? (after.data() as ExhibitorDoc | undefined) : undefined;

    await publishExhibitorListing(exhibitorId, exhibitor);
  },
);
