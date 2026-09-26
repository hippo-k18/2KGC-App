'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

/**
 * Show or hide the agenda or the speakers on the public website.
 *
 * Both live in `settings/branding` beside the other things the website reads
 * about how the event presents itself. `saveSettings` merges, so flipping one
 * leaves the logo, colours and the other switch alone.
 */
export async function setSiteVisibilityAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const field = String(formData.get('field') ?? '');
  const show = formData.get('show') === '1';
  if (field !== 'showAgenda' && field !== 'showSpeakers') return;

  await saveSettings(SETTINGS_KEYS.branding, { [field]: show }, actor);
  revalidatePath('/marketing/event-website');
}
