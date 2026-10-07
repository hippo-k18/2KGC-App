'use server';

import { revalidatePath } from 'next/cache';
import {
  recordLead,
  scanBadge,
  setLeadNote,
  type ScanOutcome,
} from '@/lib/exhibitor-leads';

/**
 * The three things a stand does, each of them taking the raw token.
 *
 * ⚠️ None of these takes an exhibitor id. Whose desk this is comes out of the
 * HMAC in the token, inside `openLeadDesk`, on every call — so there is no
 * field on any of these forms that could name another company's list. It is the
 * same shape the speaker portal settled on after "Revoke link" was found to
 * stop the page and not the writes.
 *
 * `scanAction` deliberately writes nothing. It answers "who is this, and what
 * would be shared", the attendee reads it, and `agreeAction` is the one that
 * stores. Splitting them is what makes the consent a choice rather than a
 * notice under something that already happened.
 */

export async function scanAction(rawToken: string, code: string): Promise<ScanOutcome> {
  return scanBadge(rawToken, code);
}

export interface AgreeResult {
  ok: boolean;
  message: string;
}

export async function agreeAction(
  rawToken: string,
  code: string,
  note: string,
): Promise<AgreeResult> {
  const result = await recordLead({ rawToken, code, note });
  revalidatePath(`/exhibitor/${rawToken}`);

  switch (result.outcome) {
    case 'saved':
      return { ok: true, message: `${result.name} is on your list.` };
    case 'already':
      return { ok: true, message: `${result.name} was already on your list.` };
    case 'not-active':
      return { ok: false, message: 'That ticket is not active. Send them to the registration desk.' };
    case 'unknown':
      return { ok: false, message: 'No badge matches that code.' };
    case 'unreadable':
      return { ok: false, message: 'That is not a badge. Try the six characters printed under the code.' };
    case 'closed':
      return { ok: false, message: 'This link has stopped working. Ask the organizers for a new one.' };
    default:
      return { ok: false, message: 'Nothing was saved. Try again.' };
  }
}

export async function noteAction(formData: FormData): Promise<void> {
  const rawToken = String(formData.get('token') ?? '');
  const registrationId = String(formData.get('registrationId') ?? '');
  const note = String(formData.get('note') ?? '');
  if (!rawToken || !registrationId) return;

  await setLeadNote({ rawToken, registrationId, note });
  revalidatePath(`/exhibitor/${rawToken}`);
}
