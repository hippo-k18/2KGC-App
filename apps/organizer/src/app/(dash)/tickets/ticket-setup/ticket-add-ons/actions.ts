'use server';

import { revalidatePath } from 'next/cache';
import { MERCH_SIZES, merchSlug, type MerchOption, type MerchSize } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { getMerchItem, saveMerchItem, seedMerch } from '@/lib/merch';
import { ROUTES } from '@/lib/nav';
import { uploadImage, UploadRejected, UploadUnavailable } from '@/lib/uploads';

export interface MerchState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const PATH = '/tickets/ticket-setup/ticket-add-ons';
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Create or edit one merch item. Designs are one per line; an existing
 * design keeps its id when its label is unchanged, because the id is what a
 * sold line records and the pickup list groups by.
 */
export async function saveMerchItemAction(_prev: MerchState, form: FormData): Promise<MerchState> {
  const actor = await requireOrganizer();

  const existingId = String(form.get('id') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();
  const priceRaw = String(form.get('price') ?? '').trim();
  const active = form.get('active') === 'on';
  const sort = Number(form.get('sort') ?? 0) || 0;
  const sizes = MERCH_SIZES.filter((s) => form.getAll('size').includes(s)) as MerchSize[];
  const labels = String(form.get('options') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (!name) return { error: 'Enter a name.' };
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' };
  const price = Number(priceRaw);
  if (!priceRaw || !Number.isFinite(price) || price <= 0) return { error: 'Enter a price above zero, in dollars.' };
  const priceCents = Math.round(price * 100);
  if (Math.abs(priceCents - price * 100) > 0.001) return { error: 'Use at most two decimal places.' };
  if (labels.length > 12) return { error: 'Up to 12 designs.' };
  if (labels.some((l) => l.length > 60)) return { error: 'Keep each design under 60 characters.' };

  const id = existingId || merchSlug(name);
  if (!ID.test(id)) return { error: 'Use a name with at least one letter or digit.' };
  const before = await getMerchItem(id);
  if (!existingId && before) return { error: `An item called ${before.name} already exists. Edit it instead.` };

  const options: MerchOption[] = [];
  for (const label of labels) {
    const kept = before?.options?.find((o) => o.label === label);
    let oid = kept?.id ?? (merchSlug(label) || `design-${options.length + 1}`);
    while (options.some((o) => o.id === oid)) oid = `${oid}-${options.length + 1}`;
    options.push({ id: oid, label });
  }

  let imageUrl = String(form.get('imageUrl') ?? '').trim();
  if (imageUrl && !/^https:\/\//.test(imageUrl)) return { error: 'The image address must start with https://.' };
  const picked = form.get('image');
  const file = picked instanceof File && picked.size > 0 ? picked : null;
  try {
    if (file) imageUrl = (await uploadImage(file, { folder: `merch/${id}`, name: 'image' })).url;
  } catch (err) {
    recordError('merch.image', err);
    if (err instanceof UploadRejected || err instanceof UploadUnavailable) return { error: err.message };
    return { error: 'Could not store that image.' };
  }

  const after = { name, priceCents, currency: before?.currency ?? 'usd', imageUrl, options, sizes, active, sort };
  try {
    await saveMerchItem(id, after);
  } catch (err) {
    recordError('merch.save', err);
    return { error: 'Could not save. Nothing changed.' };
  }
  await appendAudit({
    actor,
    action: 'merch.save',
    targetPath: `merchItems/${id}`,
    targetId: id,
    before: before ? { name: before.name, priceCents: before.priceCents, active: before.active } : {},
    after: { name, priceCents, active, options: options.map((o) => o.label).join(' | '), sizes: sizes.join(' ') },
  });
  revalidatePath(PATH);
  revalidatePath(ROUTES.createTickets);
  return { ok: true, message: `${name} saved${active ? ' and on sale' : ', switched off'}.` };
}

/** Add socks and the T-shirt, switched off, if they are not there yet. */
export async function seedMerchAction(): Promise<void> {
  const actor = await requireOrganizer();
  const created = await seedMerch();
  if (created.length) {
    await appendAudit({
      actor,
      action: 'merch.save',
      targetPath: 'merchItems',
      targetId: created.join(','),
      before: {},
      after: { seeded: created.join(', '), active: false },
    });
  }
  revalidatePath(PATH);
}
