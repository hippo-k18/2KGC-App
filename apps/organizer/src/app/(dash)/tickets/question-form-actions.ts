'use server';

import { revalidatePath } from 'next/cache';
import type { QuestionFieldDef, TicketAudience } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { deleteField, moveField, saveField, setFormActive } from '@/lib/question-forms';

/**
 * Editing the registration questions.
 *
 * One set of actions for all three audiences, because the form is one document
 * per audience and the editor is one screen rendered three times. The audience
 * arrives as a hidden field and is validated here rather than trusted — it
 * chooses which document is written.
 */

const AUDIENCES: TicketAudience[] = ['attendee', 'exhibitor', 'sponsor'];

const SCREEN: Record<TicketAudience, string> = {
  attendee: '/tickets/ticket-setup/1-2-question-forms',
  exhibitor: '/tickets/exhibitor-ticket-setup/2-2-question-forms',
  sponsor: '/tickets/sponsor-ticket-setup/question-forms',
};

export interface QuestionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function audienceOf(form: FormData): TicketAudience | undefined {
  const raw = String(form.get('audience') ?? '');
  return AUDIENCES.includes(raw as TicketAudience) ? (raw as TicketAudience) : undefined;
}

const KINDS: QuestionFieldDef['kind'][] = [
  'short-text',
  'long-text',
  'choice',
  'multi-choice',
  'checkbox',
  'consent',
];

export async function saveQuestionAction(
  _prev: QuestionState,
  form: FormData,
): Promise<QuestionState> {
  const actor = await requireOrganizer();

  const audience = audienceOf(form);
  if (!audience) return { error: 'Unknown audience.' };

  const rawKind = String(form.get('kind') ?? '');
  const kind = KINDS.includes(rawKind as QuestionFieldDef['kind'])
    ? (rawKind as QuestionFieldDef['kind'])
    : 'short-text';

  const result = await saveField({
    audience,
    // Present only when editing, and passed through untouched. ⚠️ The id is
    // what answers are stored under — regenerating it here would orphan every
    // answer already given to the question.
    id: String(form.get('id') ?? '').trim() || undefined,
    prompt: String(form.get('prompt') ?? ''),
    kind,
    options: String(form.get('options') ?? '')
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean),
    required: form.get('required') === 'on',
    helpText: String(form.get('helpText') ?? ''),
    ticketTypeIds: form.getAll('ticketTypeIds').map((v) => String(v)),
    actor,
  });

  revalidatePath(SCREEN[audience]);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function deleteQuestionAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const audience = audienceOf(form);
  const id = String(form.get('id') ?? '').trim();
  if (audience && id) await deleteField({ audience, id, actor });
  if (audience) revalidatePath(SCREEN[audience]);
}

export async function moveQuestionAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const audience = audienceOf(form);
  const id = String(form.get('id') ?? '').trim();
  const direction = form.get('direction') === 'up' ? 'up' : 'down';
  if (audience && id) await moveField({ audience, id, direction, actor });
  if (audience) revalidatePath(SCREEN[audience]);
}

export async function toggleFormAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const audience = audienceOf(form);
  if (audience) await setFormActive({ audience, active: form.get('active') === '1', actor });
  if (audience) revalidatePath(SCREEN[audience]);
}
