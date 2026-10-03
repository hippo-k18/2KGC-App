'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

/**
 * Show or hide the agenda or the speakers, open or close ticket sales, or
 * switch the buyer fee on or off, on the public website.
 *
 * All four live in `settings/branding` beside the other things the website reads
 * about how the event presents itself. `saveSettings` merges, so flipping one
 * leaves the logo, colours and the other switches alone.
 */
export async function setSiteVisibilityAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const field = String(formData.get('field') ?? '');
  const show = formData.get('show') === '1';
  if (
    field !== 'showAgenda' &&
    field !== 'showSpeakers' &&
    field !== 'showTickets' &&
    field !== 'chargeBuyerFee'
  ) {
    return;
  }

  await saveSettings(SETTINGS_KEYS.branding, { [field]: show }, actor);
  revalidatePath('/marketing/event-website');
  revalidatePath('/tickets/publish-tickets');
}
