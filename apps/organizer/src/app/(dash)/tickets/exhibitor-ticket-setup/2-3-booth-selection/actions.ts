'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { assignBooth, releaseBooth, setBoothBlocked, upsertBooth } from '@/lib/booths';

/**
 * Floor-plan writes.
 *
 * All four are `POST`-only server actions rather than links, because every one
 * of them changes who is standing where. A GET that allocates a booth is one
 * link prefetch away from moving an exhibitor nobody touched.
 */

const PATH = '/tickets/exhibitor-ticket-setup/2-3-booth-selection';

export interface BoothState {
  ok?: boolean;
  message?: string;
  error?: string;
}

export async function assignBoothAction(
  _prev: BoothState,
  form: FormData,
): Promise<BoothState> {
  const actor = await requireOrganizer();

  const boothId = String(form.get('boothId') ?? '').trim();
  const exhibitorId = String(form.get('exhibitorId') ?? '').trim();
  const exhibitorName = String(form.get('exhibitorName') ?? '').trim();
  const orderId = String(form.get('orderId') ?? '').trim();
  const hold = form.get('hold') === 'on';

  if (!boothId) return { error: 'Choose a booth.' };
  if (!exhibitorId) return { error: 'Choose an exhibitor.' };

  const result = await assignBooth({
    boothId,
    exhibitorId,
    exhibitorName,
    orderId: orderId || undefined,
    hold,
    actor,
  });

  revalidatePath(PATH);
  revalidatePath('/content/exhibitor-center/exhibitor-manager');
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function releaseBoothAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const boothId = String(form.get('boothId') ?? '').trim();
  if (boothId) await releaseBooth(boothId, actor);
  revalidatePath(PATH);
  revalidatePath('/content/exhibitor-center/exhibitor-manager');
}

export async function toggleBoothBlockedAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const boothId = String(form.get('boothId') ?? '').trim();
  const blocked = form.get('blocked') === '1';
  if (boothId) {
    await setBoothBlocked({
      boothId,
      blocked,
      note: String(form.get('note') ?? '').trim(),
      actor,
    });
  }
  revalidatePath(PATH);
}

export async function addBoothAction(_prev: BoothState, form: FormData): Promise<BoothState> {
  const actor = await requireOrganizer();

  const result = await upsertBooth({
    number: String(form.get('number') ?? ''),
    size: String(form.get('size') ?? ''),
    zone: String(form.get('zone') ?? ''),
    ticketTypeId: String(form.get('ticketTypeId') ?? '').trim() || undefined,
    actor,
  });

  revalidatePath(PATH);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}
