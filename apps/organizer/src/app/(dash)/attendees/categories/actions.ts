'use server';

import { revalidatePath } from 'next/cache';
import type { CategoryEdit } from '@kgc/shared';
import { assignCategory, editCategory, saveTicketRule } from '@/lib/attendee-categories';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import type { FormState } from '../../form';

/**
 * Every write to do with categories, for the three screens that make one:
 * Attendees › Categories (the list), Attendees (one person or a selection) and
 * Tickets › Attendee Categories (the ticket rule).
 *
 * Thin on purpose, like `edit-actions.ts`: check the session, read the form,
 * hand over to `lib/attendee-categories.ts`.
 */

function refresh() {
  revalidatePath(ROUTES.attendees);
  revalidatePath('/attendees/categories');
  revalidatePath('/attendees/name-badges');
  revalidatePath('/tickets/attendee-customization/attendee-categories');
}

async function run(
  label: string,
  work: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>,
): Promise<FormState> {
  try {
    const result = await work();
    if (!result.ok) return { error: result.error };
    refresh();
    return { ok: true, message: result.message };
  } catch (err) {
    recordError(label, err);
    return { error: 'That did not save. Try again.' };
  }
}

/** Add, rename or remove a category. `op` names which. */
export async function editCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const op = String(formData.get('op') ?? '');
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '');
  const color = String(formData.get('color') ?? '');

  let edit: CategoryEdit;
  if (op === 'add') edit = { op, name, color };
  else if (op === 'rename') edit = { op, id, name, color };
  else if (op === 'remove') edit = { op, id };
  else return { error: 'Unknown action.' };

  return run('category.edit', () => editCategory(edit, actor));
}

/**
 * Put one person or a selection in a category. The list's checkboxes post as
 * repeated `rid` fields; the edit panel posts one. An empty `categoryId` clears.
 */
export async function assignCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const ids = formData.getAll('rid').map(String);
  const categoryId = String(formData.get('categoryId') ?? '');
  return run('category.assign', () => assignCategory(ids, categoryId, actor));
}

/** Set or clear the category one ticket type maps to. */
export async function saveTicketRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const ticketType = String(formData.get('ticketType') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '');
  return run('category.rule', () => saveTicketRule(ticketType, categoryId, actor));
}
