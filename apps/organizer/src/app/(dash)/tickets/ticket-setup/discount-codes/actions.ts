'use server';

import { revalidatePath } from 'next/cache';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { createDiscountCode, setDiscountCodeActive } from '@/lib/discount-codes';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { stripeEnabled } from '@/lib/stripe';

/**
 * Creating and retiring discount codes.
 *
 * Both write to Stripe rather than Firestore, because Stripe is what actually
 * validates a code at checkout. A mirror here could only ever disagree with it.
 */

export interface CodeState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Stripe accepts more than this; letters and digits are what people can dictate on a call. */
const CODE = /^[A-Za-z0-9_-]{3,40}$/;

export async function createDiscountCodeAction(
  _prev: CodeState,
  formData: FormData,
): Promise<CodeState> {
  const actor = await requireOrganizer();

  if (!stripeEnabled()) {
    return { error: 'No Stripe key is configured, so codes cannot be created from here.' };
  }

  const code = String(formData.get('code') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'percent');
  const valueRaw = String(formData.get('value') ?? '').trim();
  const maxRaw = String(formData.get('maxRedemptions') ?? '').trim();
  const expiresRaw = String(formData.get('expiresAt') ?? '').trim();

  if (!CODE.test(code)) {
    return { error: 'Use 3–40 letters, digits, hyphens or underscores — no spaces.' };
  }

  const value = Number(valueRaw);
  if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a discount amount.' };

  if (kind === 'percent' && (value > 100 || !Number.isInteger(value))) {
    return { error: 'A percentage must be a whole number up to 100.' };
  }

  const maxRedemptions = maxRaw === '' ? undefined : Number(maxRaw);
  if (maxRedemptions !== undefined && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    return { error: 'Redemption limit must be a whole number, or blank for unlimited.' };
  }

  let expiresAt: Date | undefined;
  if (expiresRaw) {
    expiresAt = new Date(expiresRaw);
    if (Number.isNaN(expiresAt.getTime())) return { error: 'That expiry date is not valid.' };
    if (expiresAt.getTime() < Date.now()) return { error: 'That expiry date is in the past.' };
  }

  try {
    const created = await createDiscountCode({
      code,
      percentOff: kind === 'percent' ? value : undefined,
      // Entered in whole dollars, stored in cents — the same rule the ticket
      // price field follows, and for the same reason.
      amountOffCents: kind === 'amount' ? Math.round(value * 100) : undefined,
      currency: 'usd',
      maxRedemptions,
      expiresAt,
    });

    await appendAudit({
      actor,
      action: 'discountCode.create',
      targetPath: `stripe/promotionCodes/${created}`,
      targetId: created,
      before: {},
      after: { code: created, kind, value, maxRedemptions, expiresAt: expiresRaw || null },
    });

    revalidatePath(ROUTES.discountCodes);
    return { ok: true, message: `Created ${created}. It works at checkout immediately.` };
  } catch (err) {
    recordError('discountCode.create', err);
    // Stripe's own message is the useful one here — "code already exists" is
    // the common failure and only Stripe knows it.
    return { error: err instanceof Error ? err.message : 'Stripe refused that code.' };
  }
}

export async function toggleDiscountCodeAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '').trim();
  const active = String(formData.get('active') ?? '') === 'true';
  if (!id || !stripeEnabled()) return;

  try {
    await setDiscountCodeActive(id, !active);
    await appendAudit({
      actor,
      action: 'discountCode.update',
      targetPath: `stripe/promotionCodes/${id}`,
      targetId: id,
      before: { active },
      after: { active: !active },
    });
  } catch (err) {
    recordError('discountCode.toggle', err);
  }

  revalidatePath(ROUTES.discountCodes);
}
