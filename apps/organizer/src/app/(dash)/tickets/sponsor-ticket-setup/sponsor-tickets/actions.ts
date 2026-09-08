'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import {
  correctCompPassName,
  issueCompPass,
  setComplimentaryPasses,
} from '@/lib/comp-passes';
import type { FormState } from '../../../form';

/**
 * Complimentary-pass writes.
 *
 * All three are `POST`-only server actions rather than links, for the reason
 * the floor plan's are: issuing a pass mints a real attendee registration, and
 * a GET that does that is one link prefetch away from spending a sponsor's
 * seat on nobody.
 */

const CATALOGUE = '/tickets/sponsor-ticket-setup/sponsor-tickets';

function seatsPath(orderId: string): string {
  return `${CATALOGUE}/${encodeURIComponent(orderId)}`;
}

export async function setPassCountAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const ticketTypeId = String(form.get('ticketTypeId') ?? '').trim();
  if (!ticketTypeId) return { error: 'Choose a package.' };

  const raw = String(form.get('passes') ?? '').trim();
  const passes = raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(passes)) {
    return { error: 'Passes must be a whole number, or blank for none.' };
  }

  const result = await setComplimentaryPasses({ ticketTypeId, passes, actor });

  revalidatePath(CATALOGUE);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function issuePassAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const orderId = String(form.get('orderId') ?? '').trim();
  if (!orderId) return { error: 'Missing the sponsorship this pass belongs to.' };

  const result = await issueCompPass({
    orderId,
    name: String(form.get('name') ?? ''),
    email: String(form.get('email') ?? ''),
    // Ticked means "send it", so `silent` is the absence of the box — matching
    // the manual-order path, where the default is that the attendee is told.
    silent: form.get('notify') !== 'on',
    actor,
  });

  revalidatePath(seatsPath(orderId));
  revalidatePath(CATALOGUE);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function renamePassAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const orderId = String(form.get('orderId') ?? '').trim();
  const seat = Number(form.get('seat') ?? 0);
  if (!orderId || !Number.isInteger(seat) || seat < 1) {
    return { error: 'Missing the pass to correct.' };
  }

  const result = await correctCompPassName({
    orderId,
    seat,
    name: String(form.get('name') ?? ''),
    actor,
  });

  revalidatePath(seatsPath(orderId));
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}
