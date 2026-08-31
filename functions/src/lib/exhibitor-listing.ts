import { COLLECTIONS } from '@kgc/shared';
import type { BoothDoc, ExhibitorDoc, ExhibitorListingDoc } from '@kgc/shared';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

import { isFirebaseStorageUrl, isWebUrl } from './storage-url.js';

/**
 * Bounds on the three free-text fields an organizer types into the console
 * form, which validates none of them for length.
 *
 * The same reasoning `mirrorDirectory` gives: `exhibitorListings` is fetched
 * whole by every attendee who opens the hall, and one pasted press release in a
 * description must not spend everybody else's bytes. Generous enough that no
 * real entry is touched — the longest seeded description is 52 characters.
 */
const NAME_MAX = 120;
const DESCRIPTION_MAX = 1_000;
const WEBSITE_MAX = 300;

/** The exact set of fields `ExhibitorListingDoc` publishes, minus `BaseDoc`. */
type ProjectedFields = Omit<ExhibitorListingDoc, 'createdAt' | 'updatedAt'>;

/**
 * The booth number an attendee can actually walk to, or nothing.
 *
 * ── Why this is not `ExhibitorDoc.boothNumber` ──────────────────────────────
 *
 * That field is unreconciled free text. `saveExhibitorAction` in the console
 * takes whatever an organizer types into a text input and stores it, and
 * `assignBooth` writes it again as a best-effort denormalisation *outside* the
 * transaction that actually allocates the space, inside its own `try/catch` —
 * so a failed write there leaves the label and the floor plan disagreeing with
 * nobody told. Audit C found that split-brain live in the seed: `Withdrawn
 * Systems` carries `boothNumber: 'E06'` while `booths/E06` is `available`.
 *
 * Worse for this projection specifically: `assignBooth` writes the label on a
 * **hold** as well as an assignment. A `held` booth is a space promised in a
 * sales conversation that has not been paid for — the exhibitor-level twin of
 * the `provisional` status this whole projection exists to keep off the wire.
 * Publishing the free-text field would therefore print an unpaid space on a
 * thousand phones, which is the precise failure the listing shape was built to
 * make impossible.
 *
 * So occupancy is read where `BoothDoc`'s own docblock says it lives: on the
 * space. `status === 'assigned'` and nothing else — `held`, `available` and
 * `blocked` all publish no number. This is the same authority rule
 * `listExhibitorsByZone` in `apps/web/src/lib/data.ts` already applies
 * independently.
 *
 * ── Why the query filters `status` in memory ────────────────────────────────
 *
 * One equality filter, not two, so this cannot become the deploy that fails on
 * a missing composite index. An exhibitor holds a handful of spaces at most (a
 * premium booth plus an overflow table is the realistic maximum), so the
 * difference is a few documents read, not a scan.
 *
 * An exhibitor holding several assigned booths publishes the lowest number,
 * matching how `listExhibitorsByZone` files them under the first of their
 * spaces rather than listing them twice. `ExhibitorListingDoc.boothNumber` is
 * singular by design; the app sorts the hall by it, which is the order somebody
 * walking the aisles is in.
 */
async function assignedBoothNumber(exhibitorId: string): Promise<string | undefined> {
  const held = await getFirestore()
    .collection(COLLECTIONS.booths)
    .where('exhibitorId', '==', exhibitorId)
    .get();

  return held.docs
    .map((d) => d.data() as BoothDoc)
    .filter((b) => b.status === 'assigned' && typeof b.number === 'string' && b.number !== '')
    .map((b) => b.number)
    .sort((a, b) => a.localeCompare(b))[0];
}

/** True when every projected field already stored matches what we would write. */
function alreadyPublished(stored: Record<string, unknown>, next: ProjectedFields): boolean {
  const keys = new Set([
    ...Object.keys(next),
    ...Object.keys(stored).filter((k) => k !== 'createdAt' && k !== 'updatedAt'),
  ]);
  for (const key of keys) {
    if (stored[key] !== (next as Record<string, unknown>)[key]) return false;
  }
  return true;
}

/**
 * Bring `exhibitorListings/{exhibitorId}` in line with the exhibitor record and
 * the floor plan. Called by both triggers that can change either.
 *
 * ⚠️ **The deletion branch is the security property, not a tidy-up.** A
 * `provisional` exhibitor is a space promised in a sales conversation nobody
 * has paid for; a `cancelled` one pulled out. Neither may have a listing
 * document *at all* — not a listing with a flag on it — because rules filter
 * documents rather than fields, and because a record that never leaves the
 * server cannot be recovered from a client that ignored the flag. That is the
 * identical guarantee opting out of `directory` gets, and it is why
 * `ExhibitorListingDoc` deliberately carries no `status` field to filter on.
 *
 * A `delete()` on a document that does not exist succeeds and writes nothing,
 * so the branch is safe to run on every write of an exhibitor who was never
 * published in the first place.
 *
 * ⚠️ **This function must never write `exhibitors` or `booths`.** It is called
 * from triggers on both of those collections; writing back to either closes the
 * circuit and produces an unbounded loop billed per hop. See the warning in
 * `mirror-directory.ts` — audit F traced every trigger in this codebase and
 * found no loop, and that stays true only for as long as nobody adds one.
 */
export async function publishExhibitorListing(
  exhibitorId: string,
  exhibitor: ExhibitorDoc | undefined,
): Promise<void> {
  const listingRef = getFirestore().collection(COLLECTIONS.exhibitorListings).doc(exhibitorId);

  if (!exhibitor || exhibitor.status !== 'confirmed') {
    await listingRef.delete();
    return;
  }

  const boothNumber = await assignedBoothNumber(exhibitorId);

  /*
   * Only the six fields `ExhibitorListingDoc` names, spelled out rather than
   * spread from the source. A spread would publish `contactEmail`,
   * `passesAllocated` and `status` the moment somebody adds a field to
   * `ExhibitorDoc`, and the failure would be silent — the projection would
   * simply start carrying more than it should.
   */
  const projected: ProjectedFields = {
    eventId: exhibitor.eventId,
    exhibitorId,
    name: (exhibitor.name ?? '').slice(0, NAME_MAX),
    ...(boothNumber ? { boothNumber } : {}),
    ...(isFirebaseStorageUrl(exhibitor.logoURL) ? { logoURL: exhibitor.logoURL } : {}),
    ...(exhibitor.description
      ? { description: exhibitor.description.slice(0, DESCRIPTION_MAX) }
      : {}),
    ...(isWebUrl(exhibitor.website) ? { website: exhibitor.website.slice(0, WEBSITE_MAX) } : {}),
  };

  const current = await listingRef.get();
  const stored = current.data();

  /*
   * A replay writes nothing at all.
   *
   * Eventarc delivers at least once, and the booth trigger re-projects an
   * exhibitor on every occupancy change, so the same payload arrives more than
   * once as a matter of course. Comparing before writing makes the duplicate
   * free rather than merely harmless, and — more usefully — stops it bumping
   * `updatedAt` on a document nothing changed about, which is what would make a
   * genuine change indistinguishable from a redelivery when reading the data.
   */
  if (stored && alreadyPublished(stored, projected)) return;

  await listingRef.set({
    ...projected,
    // Preserved across every republish: the listing was first published when it
    // was first published, and a status flip-flop must not rewrite that.
    createdAt: (stored?.createdAt as Timestamp | undefined) ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Read an exhibitor for the booth trigger, which only holds an id. */
export async function readExhibitor(exhibitorId: string): Promise<ExhibitorDoc | undefined> {
  const snap = await getFirestore().collection(COLLECTIONS.exhibitors).doc(exhibitorId).get();
  return snap.exists ? (snap.data() as ExhibitorDoc | undefined) : undefined;
}
