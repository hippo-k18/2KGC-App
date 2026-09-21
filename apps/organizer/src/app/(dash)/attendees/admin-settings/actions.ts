'use server';

import { revalidatePath } from 'next/cache';
import { writeAppAccessProjection } from '@/lib/app-access';
import { isAllowed, requireOrganizer, requireOwner } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';
import { inviteMember, removeMember, sendNewLink, setMemberRoles } from '@/lib/team';
import { parseRoles } from '@/lib/team-core';

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

  const messaging = formData.get('attendeeMessagingEnabled') === 'on';

  const res = await saveSettings(
    SETTINGS_KEYS.access,
    {
      attendeeListVisible: formData.get('attendeeListVisible') === 'on',
      contactSharingEnabled: formData.get('contactSharingEnabled') === 'on',
      attendeeMessagingEnabled: messaging,
      staffNote: staffNote || null,
    },
    actor,
  );

  if (!res.ok) return { error: res.error };

  /*
   * Only the messaging switch reaches a phone, and it reaches it through the
   * projection rather than through this document — so the save is not finished
   * until the projection is rewritten. The other two are still recorded and
   * nothing more, which is what the sentence below has to keep saying.
   */
  const projected = await writeAppAccessProjection();

  revalidatePath('/attendees/admin-settings');
  if (!projected.ok) {
    return { ok: true, message: 'Saved. The app has not picked up the messaging switch yet. Save again in a moment.' };
  }
  return {
    ok: true,
    message: messaging
      ? 'Saved. Attendees can message each other.'
      : 'Saved. Messaging is off: nobody can start a conversation or send a message, and what people have already said stays readable.',
  };
}

// ---------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------

export interface TeamState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** The set-passphrase link, shown once so an owner can pass it on by hand. */
  link?: string;
}

const PATH = '/attendees/admin-settings';

/**
 * `owner` is not on offer. Owners are the addresses configured on the server,
 * which is what keeps a way back in if this list is ever emptied or wrong, and
 * an invited owner could remove the person who invited them.
 */
const grantable = (formData: FormData) =>
  parseRoles(formData.getAll('roles')).filter((r) => r !== 'owner');

export async function inviteMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireOwner();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (isAllowed(email)) return { error: `${email} is already an owner.` };

  const res = await inviteMember({
    email,
    name: String(formData.get('name') ?? ''),
    roles: grantable(formData),
    actor,
  });
  revalidatePath(PATH);
  return res.ok ? { ok: true, message: res.message, link: res.link } : { error: res.error };
}

export async function setRolesAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireOwner();
  const res = await setMemberRoles({
    memberId: String(formData.get('memberId') ?? ''),
    roles: grantable(formData),
    actor,
  });
  revalidatePath(PATH);
  return res.ok ? { ok: true, message: res.message } : { error: res.error };
}

export async function newLinkAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireOwner();
  const res = await sendNewLink({ memberId: String(formData.get('memberId') ?? ''), actor });
  revalidatePath(PATH);
  return res.ok ? { ok: true, message: res.message, link: res.link } : { error: res.error };
}

export async function removeMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireOwner();
  const res = await removeMember({ memberId: String(formData.get('memberId') ?? ''), actor });
  revalidatePath(PATH);
  return res.ok ? { ok: true, message: res.message } : { error: res.error };
}
