'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

export interface AdminSettingsState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Attendee admin settings, written into the `access` bag.
 *
 * Not a bag of its own: settings are grouped by feature area rather than by
 * screen, and who may administer the event, what the invitation code is, and
 * what attendees may see of each other are all one area. `saveSettings` merges,
 * so writing three keys here cannot blank the `eventCode` that Tools › Admin
 * Control › Code Access Control owns in the same document — which is exactly
 * the failure the merge exists to prevent.
 */
export async function saveAdminSettingsAction(
  _prev: AdminSettingsState,
  formData: FormData,
): Promise<AdminSettingsState> {
  const actor = await requireOrganizer();

  const staffNote = String(formData.get('staffNote') ?? '').trim();
  if (staffNote.length > 300) {
    return { error: 'Keep the check-in staff note under 300 characters.' };
  }

  const res = await saveSettings(
    SETTINGS_KEYS.access,
    {
      attendeeListVisible: formData.get('attendeeListVisible') === 'on',
      contactSharingEnabled: formData.get('contactSharingEnabled') === 'on',
      staffNote: staffNote || null,
    },
    actor,
  );

  if (!res.ok) return { error: res.error };

  revalidatePath('/attendees/admin-settings');
  return {
    ok: true,
    // Deliberately not "applied". The document is written and audited; nothing
    // reads it but this screen, and claiming otherwise is the defect class
    // AGENTS.md says this codebase keeps repeating.
    message: 'Saved. Recorded and audited — no client enforces these yet.',
  };
}
