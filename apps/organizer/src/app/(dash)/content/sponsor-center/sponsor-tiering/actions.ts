'use server';

import { revalidatePath } from 'next/cache';
import { applyTierEdit, type TierEdit } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors } from '@/lib/data';
import { sponsorTiers } from '@/lib/event';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';
import type { FormState } from '../../../form';

/**
 * One action for every edit to the tier list: add, rename, move, remove.
 *
 * The list is one array in `settings/sponsorTiers`, so each edit reads it,
 * applies the change with `applyTierEdit` (pure, tested in `@kgc/shared`) and
 * writes the whole array back. `saveSettings` audits the before and after.
 *
 * A tier id never changes after it is minted: `SponsorDoc.tier` stores it, so a
 * rename touches no sponsor. Removing a tier that still has sponsors is refused
 * rather than reassigning them, because which tier they move to is a commercial
 * decision.
 */
export async function editSponsorTiersAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOrganizer();

  const op = String(formData.get('op') ?? '');
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '');
  const size = Number(formData.get('size') ?? 1);

  let edit: TierEdit;
  if (op === 'add') edit = { op, name, size };
  else if (op === 'rename') edit = { op, id, name, size };
  else if (op === 'up' || op === 'down') edit = { op: 'move', id, dir: op };
  else if (op === 'remove') {
    const inUse = (await listSponsors()).filter((s) => s.tier === id).length;
    edit = { op, id, inUse };
  } else return { error: 'Unknown action.' };

  const res = applyTierEdit(await sponsorTiers(), edit);
  if (!res.ok) return { error: res.error };

  const saved = await saveSettings(SETTINGS_KEYS.sponsorTiers, { tiers: res.tiers }, actor);
  if (!saved.ok) return { error: saved.error };

  revalidatePath('/content/sponsor-center', 'layout');
  return {
    ok: true,
    message:
      op === 'add'
        ? `${name.trim()} added. It shows on the website and in the app once a sponsor is in it.`
        : op === 'remove'
          ? 'Tier removed.'
          : 'Saved. The website and the app follow this order.',
  };
}
