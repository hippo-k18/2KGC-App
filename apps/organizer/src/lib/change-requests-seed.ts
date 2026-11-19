/**
 * The first two entries on the public list at `/request` (T433): changes the
 * owner asked for before the form existed, already live. Run once on live by
 * `scripts/ops/seed-change-requests.ts`, never at build time.
 *
 * Owner, 2026-11-19: "for now just put the sponsor tick box and how did you
 * hear about the conference".
 *
 * Fixed ids, so a second run finds them and changes nothing. Both carry
 * `emailed.built` and `emailed.live`, so no status move can ever email
 * anyone about them. Nothing here imports the mailer.
 */
import type { ChangeRequestDoc } from '@kgc/shared';

export const SEED_SENDER = 'contact@knowledgegraph.tech';

export const CHANGE_REQUEST_SEED: readonly { id: string; description: string }[] = [
  { id: 'seedSponsorOffersTickBox', description: 'Add a sponsor offers tick box to the ticket checkout' },
  { id: 'seedHowDidYouHearQuestion', description: "Add 'How did you hear about the conference?' to the ticket checkout" },
];

/** The smallest Firestore surface the seed needs, so a test can hand it a fake. */
export interface SeedStore {
  exists(id: string): Promise<boolean>;
  create(id: string, doc: ChangeRequestDoc): Promise<void>;
}

export interface SeedLine {
  id: string;
  action: 'exists' | 'would-create' | 'created';
}

/**
 * Create each seed request that is missing, as Live. One that is already
 * there is left exactly as it is, whatever an owner has done to it since.
 * `stampFor(i)` is the time to write for the ith seed, a Firestore Timestamp
 * in real runs: the first is the newest, so the list shows them in this order.
 */
export async function seedChangeRequests<T>(
  store: SeedStore,
  opts: { apply: boolean; stampFor: (index: number) => T },
): Promise<SeedLine[]> {
  const out: SeedLine[] = [];
  for (const [index, { id, description }] of CHANGE_REQUEST_SEED.entries()) {
    if (await store.exists(id)) {
      out.push({ id, action: 'exists' });
      continue;
    }
    if (!opts.apply) {
      out.push({ id, action: 'would-create' });
      continue;
    }
    const at = opts.stampFor(index) as unknown as ChangeRequestDoc['createdAt'];
    await store.create(id, {
      email: SEED_SENDER,
      description,
      screenshots: [],
      status: 'live',
      emailed: { built: at, live: at },
      updatedBy: 'seed (T433)',
      createdAt: at,
      updatedAt: at,
    });
    out.push({ id, action: 'created' });
  }
  return out;
}
