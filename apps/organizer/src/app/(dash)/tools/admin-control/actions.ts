'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

export interface AccessState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Post-event access and code access, both in the `access` settings bag.
 *
 * One action for two screens because they write the same document — settings
 * are grouped by feature area, not by screen, and `saveSettings` merges, so a
 * screen that renders half the bag cannot blank the other half.
 */
export async function saveAccessSettingsAction(
  _prev: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const actor = await requireOrganizer();
  const which = String(formData.get('which') ?? '');

  if (which === 'post-event') {
    const days = Number(formData.get('postEventDays') ?? 0);
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      return { error: 'Enter a whole number of days between 0 and 3650.' };
    }
    const res = await saveSettings(
      SETTINGS_KEYS.access,
      {
        postEventDays: days,
        postEventReadOnly: formData.get('postEventReadOnly') === 'on',
      },
      actor,
    );
    return res.ok
      ? {
          ok: true,
          message:
            days === 0
              ? 'Saved. Access ends when the event does.'
              : `Saved — attendees keep access for ${days} days after the event.`,
        }
      : { error: res.error };
  }

  if (which === 'code') {
    const code = String(formData.get('eventCode') ?? '').trim();
    const required = formData.get('codeRequired') === 'on';

    /**
     * A required code with no code set would lock every attendee out of the
     * event, silently, from the moment it saved. Refusing the combination is
     * cheaper than the support morning that follows it.
     */
    if (required && code.length < 4) {
      return { error: 'Set a code of at least 4 characters, or untick “require a code”.' };
    }
    if (code && !/^[A-Za-z0-9-]{4,32}$/.test(code)) {
      return { error: 'Codes are 4–32 letters, digits or hyphens — they get read out loud.' };
    }

    const res = await saveSettings(
      SETTINGS_KEYS.access,
      { eventCode: code.toUpperCase() || null, codeRequired: required },
      actor,
    );
    return res.ok ? { ok: true, message: 'Saved.' } : { error: res.error };
  }

  return { error: 'Unknown form.' };
}
