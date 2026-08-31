import { COLLECTIONS } from '@kgc/shared';
import type { BoothDoc } from '@kgc/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { publishExhibitorListing, readExhibitor } from '../lib/exhibitor-listing.js';
import { TRIGGER } from '../runtime-options.js';

/** The parts of a booth that decide whether a number may be published. */
function occupancy(booth: BoothDoc | undefined) {
  return {
    exhibitorId: booth?.exhibitorId,
    status: booth?.status,
    number: booth?.number,
  };
}

/**
 * `booths/{boothId}` — see functions/SPEC.md #12.
 *
 * The second half of the `exhibitorListings` projection, and the reason
 * `boothNumber` on a listing can be trusted.
 *
 * ── Why a booth write has to re-project ─────────────────────────────────────
 *
 * The authoritative booth number is on the space, not on the exhibitor
 * (`BoothDoc`'s own docblock argues this: a booth has one occupant, an
 * exhibitor may hold several, and "which spaces are free?" is unanswerable from
 * the exhibitor side). `publishExhibitorListing` therefore resolves it from
 * `booths`, and an allocation that changes without the exhibitor document
 * changing would otherwise never reach the app.
 *
 * That is not hypothetical. `assignBooth` in `apps/organizer/src/lib/booths.ts`
 * updates `exhibitors/{id}.boothNumber` as a best-effort denormalisation
 * *outside* its transaction and inside its own `try/catch`, logging and
 * carrying on when it fails; `releaseBooth` does the same. A seed, a Whova
 * import or a console edit touches `booths` and nothing else. Depending on a
 * co-write that is documented as allowed to fail is precisely the split-brain
 * audit C found, and the point of resolving the number here was to stop
 * inheriting it.
 *
 * ── Filtered to occupancy ───────────────────────────────────────────────────
 *
 * Re-projection runs only when `exhibitorId`, `status` or `number` moved. A
 * `note`, a `zone`, a `size` or a `ticketTypeId` edit changes nothing an
 * attendee can see and must not spend a read and a write on every affected
 * exhibitor — the same "only fields that change where/when/whether" rule
 * `onSessionAgendaChange` applies.
 *
 * ── Bounded fan-out ─────────────────────────────────────────────────────────
 *
 * At most two exhibitors per booth write: the occupant before and the occupant
 * after. A reassignment must re-project both, or the previous occupant keeps
 * advertising a space they no longer hold.
 *
 * ⚠️ This trigger writes `exhibitorListings` only. It must never write `booths`
 * — a trigger on a collection that writes back to it is a self-feeding loop
 * with no stopping point, billed per hop. See the warning in
 * `mirror-directory.ts`.
 */
export const onBoothAssignmentWrite = onDocumentWritten(
  { document: `${COLLECTIONS.booths}/{boothId}`, ...TRIGGER },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    // `.exists` and `.data()` are separate questions — see the same guard in
    // `mirror-exhibitor-listing.ts` for the crash this avoids.
    const wasBooth = before?.exists ? (before.data() as BoothDoc | undefined) : undefined;
    const nowBooth = after?.exists ? (after.data() as BoothDoc | undefined) : undefined;

    const was = occupancy(wasBooth);
    const now = occupancy(nowBooth);
    if (
      was.exhibitorId === now.exhibitorId &&
      was.status === now.status &&
      was.number === now.number
    ) {
      return;
    }

    const affected = new Set<string>();
    if (was.exhibitorId) affected.add(was.exhibitorId);
    if (now.exhibitorId) affected.add(now.exhibitorId);

    for (const exhibitorId of affected) {
      await publishExhibitorListing(exhibitorId, await readExhibitor(exhibitorId));
    }
  },
);
