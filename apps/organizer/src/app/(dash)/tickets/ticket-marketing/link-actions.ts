'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { saveLink, setLinkActive } from '@/lib/campaigns';

/**
 * Creating and retiring tracked links.
 *
 * Shared by Campaign Link Tracking, Referral Contest and Social Sharing,
 * because all three are the same document with a different reason for existing
 * — a campaign link has no owner, a referral link does, and a social link has a
 * channel. Three save actions would be three places for the open-redirect check
 * to be forgotten in.
 */

const PATHS = [
  '/tickets/ticket-marketing/campaign-link-tracking',
  '/tickets/ticket-marketing/referral-contest',
  '/tickets/ticket-marketing/social-sharing',
];

export interface LinkState {
  ok?: boolean;
  message?: string;
  error?: string;
}

export async function saveLinkAction(_prev: LinkState, form: FormData): Promise<LinkState> {
  const actor = await requireOrganizer();

  const result = await saveLink({
    code: String(form.get('code') ?? ''),
    label: String(form.get('label') ?? ''),
    destination: String(form.get('destination') ?? '/tickets'),
    owner: String(form.get('owner') ?? '') || undefined,
    channel: String(form.get('channel') ?? '') || undefined,
    actor,
  });

  for (const p of PATHS) revalidatePath(p);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function toggleLinkAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const code = String(form.get('code') ?? '').trim();
  const active = form.get('active') === '1';
  if (code) await setLinkActive(code, active, actor);
  for (const p of PATHS) revalidatePath(p);
}
