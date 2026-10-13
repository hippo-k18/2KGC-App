'use server';

import { revalidatePath } from 'next/cache';
import { reauthenticate, requireOrganizer } from '@/lib/auth';
import {
  saveCfpSettings,
  saveDeclineReason,
  sendCloseDecisions,
  sendStillOpen,
} from '@/lib/cfp';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { CFA_BASE } from '../routes';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');

function refresh() {
  revalidatePath(`${CFA_BASE}/rolling-review`);
  revalidatePath(`${CFA_BASE}/review`);
  revalidatePath(`${CFA_BASE}/submissions`);
}

export async function saveCfpSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  try {
    const r = await saveCfpSettings(
      s(fd, 'callId'),
      {
        closeDate: s(fd, 'closeDate'),
        decisionDate: s(fd, 'decisionDate'),
        sessionNoticeDate: s(fd, 'sessionNoticeDate'),
        acceptNoticeEmail: s(fd, 'acceptNoticeEmail'),
        reviewerReminderEmail: s(fd, 'reviewerReminderEmail'),
        abstractMinWords: s(fd, 'abstractMinWords'),
        abstractMaxWords: s(fd, 'abstractMaxWords'),
        talkMinutes: s(fd, 'talkMinutes'),
      },
      actor,
    );
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: r.message };
  } catch (err) {
    recordError('cfp.settings', err);
    return { error: 'Could not save the settings. Reload the page to see what is stored, then try again.' };
  }
}

export async function saveDeclineReasonAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const r = await saveDeclineReason(s(fd, 'submissionId'), s(fd, 'reason'), actor);
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: true, message: r.message };
}

/**
 * The two bulk sends. Each needs the box ticked, because each mails many
 * authors at once and an email cannot be recalled.
 */
export async function sendCloseDecisionsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  if (fd.get('confirm') !== 'on') return { error: 'Tick the box to confirm the send.' };
  // A fresh emailed code, like every other mass send (AGENTS.md, T252).
  if (!(await reauthenticate(String(fd.get('passphrase') ?? '')))) {
    return { error: 'That confirmation code is not right, or it has expired. Nothing has been sent.' };
  }
  try {
    const r = await sendCloseDecisions({ callId: s(fd, 'callId'), actor });
    refresh();
    return r.ok ? { ok: true, message: r.message } : { error: r.error };
  } catch (err) {
    recordError('cfp.closeDecisions', err);
    return { error: 'The send stopped part way. Reload: what went is marked, and pressing Send again sends only the rest.' };
  }
}

export async function sendStillOpenAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  if (fd.get('confirm') !== 'on') return { error: 'Tick the box to confirm the send.' };
  if (!(await reauthenticate(String(fd.get('passphrase') ?? '')))) {
    return { error: 'That confirmation code is not right, or it has expired. Nothing has been sent.' };
  }
  try {
    const r = await sendStillOpen({ callId: s(fd, 'callId'), actor });
    refresh();
    return r.ok ? { ok: true, message: r.message } : { error: r.error };
  } catch (err) {
    recordError('cfp.stillOpen', err);
    return { error: 'The send stopped part way. Reload: what went is marked, and pressing Send again sends only the rest.' };
  }
}
