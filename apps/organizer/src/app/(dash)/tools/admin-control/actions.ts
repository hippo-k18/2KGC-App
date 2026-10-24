'use server';

import { revalidatePath } from 'next/cache';
import { accessWindowSummary, normaliseJoinCode } from '@kgc/shared';
import { writeAppAccessProjection } from '@/lib/app-access';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

export interface AccessState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * The line an organizer reads after a save, built from what the phone will
 * actually do rather than from what the form said.
 *
 * `writeAppAccessProjection` is what the app and `firestore.rules` read, so a
 * save that stored the setting and failed to project it has to say so: the
 * document is the record and the projection is the thing with the effect.
 */
async function applyToTheApp(saved: string): Promise<AccessState> {
  const projected = await writeAppAccessProjection();
  if (!projected.ok) {
    return {
      ok: true,
      message: `${saved} The app has not picked it up yet. Save again in a moment.`,
    };
  }
  return { ok: true, message: `${saved} ${accessWindowSummary(projected.window)}` };
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

  /**
   * Both screens read the same settings document, and neither was being
   * re-rendered after a save. A server action does not refresh the route on its
   * own, so the page carried on serving the values it was built with: the box
   * showed the previous code next to a banner naming the new one, and pressing
   * Save a second time posted that stale value back over what had just been
   * stored. The `key` on each control in `access-form.tsx` is the other half of
   * this — the refresh brings the new value down, the key puts it in the box.
   */
  const refresh = () => {
    revalidatePath('/tools/admin-control/code-access-control');
    revalidatePath('/tools/admin-control/post-event-access-duration');
  };

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
    if (!res.ok) return { error: res.error };
    refresh();

    return applyToTheApp(
      days === 0
        ? 'Saved. Access ends when the event does.'
        : `Saved: attendees keep access for ${days} days after the event.`,
    );
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
      return { error: 'Codes are 4–32 letters, digits or hyphens. They get read out loud.' };
    }

    const res = await saveSettings(
      SETTINGS_KEYS.access,
      { eventCode: code.toUpperCase() || null, codeRequired: required },
      actor,
    );
    if (!res.ok) return { error: res.error };
    refresh();

    /*
     * The code is compared without its punctuation, so an attendee reading a
     * hyphen off a slide and typing it is not refused. Saying so here is the
     * only place an organizer finds out before a thousand people try it.
     */
    const projected = await writeAppAccessProjection();
    if (!projected.ok) {
      return { ok: true, message: 'Saved. The app has not picked it up yet. Save again in a moment.' };
    }
    return {
      ok: true,
      message: required
        ? `Saved. Attendees are asked for ${normaliseJoinCode(code)} once, the first time they sign in. Spaces and hyphens do not matter.`
        : 'Saved. Nobody is asked for a code.',
    };
  }

  return { error: 'Unknown form.' };
}
