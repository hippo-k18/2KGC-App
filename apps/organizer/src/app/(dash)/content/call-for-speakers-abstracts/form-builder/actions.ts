'use server';

import { revalidatePath } from 'next/cache';
import type { CallFormFieldDef } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { deleteCallField, moveCallField, saveCallField } from '@/lib/calls';
import { recordError } from '@/lib/errors';
import type { FormState } from '../../../form';
import { CFA_BASE } from '../routes';

/**
 * The question builder's writes.
 *
 * ⚠️ **The id is never sent by the browser except to say "edit this one".** A
 * create posts no id and the server derives one from the prompt; an edit posts
 * the id it was rendered with and the server preserves it exactly. The id is
 * what an answer is stored under, so a regenerated one orphans every answer
 * already given — `lib/calls.ts` carries the same warning, because this is the
 * one rule in the feature that breaks silently.
 */

const KINDS: CallFormFieldDef['kind'][] = [
  'short-text',
  'long-text',
  'choice',
  'multi-choice',
  'checkbox',
  'consent',
  'description',
];

export async function saveFieldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const callId = String(formData.get('callId') ?? '');
  if (!callId) return { error: 'No call was named.' };

  const kind = String(formData.get('kind') ?? '') as CallFormFieldDef['kind'];
  if (!KINDS.includes(kind)) return { error: 'Choose a question type.' };

  /*
   * Options arrive as one textarea, one per line, rather than as a repeating
   * field group. A group needs client state to add a row, and the whole point
   * of these screens being Server Components is that they do not ship one.
   */
  const options = String(formData.get('options') ?? '')
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);

  const rawMax = String(formData.get('maxLength') ?? '').trim();
  const maxLength = rawMax ? Number(rawMax) : undefined;
  if (rawMax && (!Number.isInteger(maxLength) || (maxLength ?? 0) < 1)) {
    return { error: 'A character limit has to be a whole number of characters.' };
  }

  try {
    const result = await saveCallField({
      callId,
      id: String(formData.get('id') ?? '') || undefined,
      prompt: String(formData.get('prompt') ?? ''),
      kind,
      options,
      required: formData.get('required') === 'on',
      helpText: String(formData.get('helpText') ?? '') || undefined,
      maxLength,
      actor,
    });

    if (!result.ok) return { error: result.error };
    revalidatePath(`${CFA_BASE}/form-builder`);
    revalidatePath(CFA_BASE);
    return { ok: true, message: result.message };
  } catch (err) {
    recordError('callForm.saveField', err);
    return { error: err instanceof Error ? err.message : 'Could not save the question.' };
  }
}

export async function deleteFieldAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!callId || !id) return;

  const result = await deleteCallField({ callId, id, actor });
  if (!result.ok) recordError('callForm.deleteField', new Error(result.error));
  revalidatePath(`${CFA_BASE}/form-builder`);
}

export async function moveFieldAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const callId = String(formData.get('callId') ?? '');
  const id = String(formData.get('id') ?? '');
  const direction = String(formData.get('direction') ?? '');
  if (!callId || !id || (direction !== 'up' && direction !== 'down')) return;

  const result = await moveCallField({ callId, id, direction, actor });
  if (!result.ok) recordError('callForm.moveField', new Error(result.error));
  revalidatePath(`${CFA_BASE}/form-builder`);
}
