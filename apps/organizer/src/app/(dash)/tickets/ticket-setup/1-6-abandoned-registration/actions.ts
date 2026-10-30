'use server';

import { revalidatePath } from 'next/cache';
import { COLLECTIONS } from '@kgc/shared';
import { requireOwner } from '@/lib/auth';
import { appendAudit, diff } from '@/lib/audit';
import { saveReminderSettings, sendReminderTest } from '@/lib/checkout-reminder';
import { REMINDER_SETTINGS_DOC, checkSettings, parseSkipList } from '@/lib/checkout-reminder-core';
import { recordError } from '@/lib/errors';

/**
 * The checkout reminder's panel on 1.6 Abandoned Registration (T363).
 *
 * Owners only: switching it on starts mail to people who never bought, so
 * every action starts with `requireOwner()` and every change is audited.
 * One form, two buttons: Save, and Send me a test, which sends the words on
 * the form (saved or not) to the signed-in owner.
 */

const PATH = '/tickets/ticket-setup/1-6-abandoned-registration';
const TARGET = {
  targetPath: `${COLLECTIONS.settings}/${REMINDER_SETTINGS_DOC}`,
  targetId: REMINDER_SETTINGS_DOC,
  subject: 'Checkout reminder',
};

export interface ReminderFormState {
  ok?: boolean;
  message?: string;
  error?: string;
  problems?: string[];
}

function read(formData: FormData) {
  return {
    enabled: formData.get('enabled') === 'on',
    delayHours: Number(String(formData.get('delayHours') ?? '').trim()),
    subject: String(formData.get('subject') ?? '').trim(),
    body: String(formData.get('body') ?? '').replace(/\r\n/g, '\n').trim(),
    replyTo: String(formData.get('replyTo') ?? '').trim().toLowerCase(),
    skipList: parseSkipList(String(formData.get('skipList') ?? '')),
  };
}

export async function reminderFormAction(_prev: ReminderFormState, formData: FormData): Promise<ReminderFormState> {
  const actor = await requireOwner();
  const input = read(formData);
  const problems = checkSettings(input);
  if (problems.length) return { error: 'Nothing was saved or sent. Fix these first:', problems };

  if (formData.get('intent') === 'test') {
    const outcome = await sendReminderTest(actor, input, actor);
    await appendAudit({ actor, action: 'checkoutReminder.test', ...TARGET, before: {}, after: { to: actor, outcome } });
    if (outcome === 'sent') return { ok: true, message: `Test sent to ${actor}. The subject starts with [Test]. Nothing was saved.` };
    if (outcome === 'skipped') return { error: 'Email is not switched on for the dashboard, so the test was not sent. It is in the Email Log.' };
    return { error: 'The test was not sent. The Email Log says why.' };
  }

  let result: Awaited<ReturnType<typeof saveReminderSettings>>;
  try {
    result = await saveReminderSettings(input, actor);
  } catch (err) {
    recordError('checkout-reminder.save', err);
    return { error: 'Could not save. Try again in a minute.' };
  }
  const { before, switchedOn } = result;
  const d = diff(
    { enabled: before.enabled, delayHours: before.delayHours, subject: before.subject, body: before.body, replyTo: before.replyTo, skipList: before.skipList },
    input,
  );
  if (d.changed.length) {
    await appendAudit({ actor, action: 'checkoutReminder.settings', ...TARGET, before: d.before, after: { ...d.after, ...(switchedOn ? { enabledAt: 'now' } : {}) } });
  }
  revalidatePath(PATH);
  if (switchedOn) {
    return {
      ok: true,
      message: `Saved. The reminder is on. Checkouts that close from now on get it ${input.delayHours} hours later. Older ones never do.`,
    };
  }
  return { ok: true, message: input.enabled ? 'Saved. The reminder is on.' : 'Saved. The reminder is off. Nothing is sent.' };
}
