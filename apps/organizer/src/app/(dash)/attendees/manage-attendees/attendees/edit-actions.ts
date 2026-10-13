'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import {
  cancelAttendee,
  changeTicketType,
  reinstateAttendee,
  resendConfirmation,
  transferAttendee,
  updateAttendee,
  type AttendeeActionResult,
} from '@/lib/attendee-admin';
import { validateAttendeeDetails } from '@/lib/attendees-core';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import type { FormState } from '../../../form';

/**
 * The write side of the edit panel on Attendees.
 *
 * Thin on purpose. Each action checks the session, validates what was posted
 * and hands over to `lib/attendee-admin.ts`, which holds the reasoning about
 * why an address change is a move and what a cancellation releases.
 *
 * `registrationId` comes back on success because a corrected address lands on a
 * new id, and the panel has to follow it rather than reload a registration that
 * now reads "transferred".
 */

export interface AttendeeEditState extends FormState {
  registrationId?: string;
}

function refresh() {
  revalidatePath(ROUTES.attendees);
  revalidatePath(ROUTES.checkIn);
  revalidatePath(ROUTES.analyticsExports);
}

async function run(label: string, work: () => Promise<AttendeeActionResult>): Promise<AttendeeEditState> {
  try {
    const result = await work();
    if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
    refresh();
    return { ok: true, message: result.message, registrationId: result.registrationId };
  } catch (err) {
    recordError(label, err);
    return { error: 'That did not save. Try again.' };
  }
}

const idOf = (formData: FormData) => String(formData.get('registrationId') ?? '');

export async function updateAttendeeAction(
  _prev: AttendeeEditState,
  formData: FormData,
): Promise<AttendeeEditState> {
  const actor = await requireOrganizer();
  const checked = validateAttendeeDetails({
    name: formData.get('name'),
    email: formData.get('email'),
    title: formData.get('title'),
    company: formData.get('company'),
  });
  if (!checked.ok) return { error: 'Check the highlighted fields.', fieldErrors: checked.fieldErrors };
  return run('attendee.update', () => updateAttendee(idOf(formData), checked.values, actor));
}

export async function transferAttendeeAction(
  _prev: AttendeeEditState,
  formData: FormData,
): Promise<AttendeeEditState> {
  const actor = await requireOrganizer();
  const checked = validateAttendeeDetails({
    name: formData.get('name'),
    email: formData.get('email'),
    title: formData.get('title'),
    company: formData.get('company'),
  });
  if (!checked.ok) return { error: 'Check the highlighted fields.', fieldErrors: checked.fieldErrors };
  return run('attendee.transfer', () => transferAttendee(idOf(formData), checked.values, actor));
}

export async function changeTicketTypeAction(
  _prev: AttendeeEditState,
  formData: FormData,
): Promise<AttendeeEditState> {
  const actor = await requireOrganizer();
  const ticketType = String(formData.get('ticketType') ?? '');
  return run('attendee.ticketType', () => changeTicketType(idOf(formData), ticketType, actor));
}

export async function cancelAttendeeAction(
  _prev: AttendeeEditState,
  formData: FormData,
): Promise<AttendeeEditState> {
  const actor = await requireOrganizer();
  return run('attendee.cancel', () => cancelAttendee(idOf(formData), actor));
}

export async function reinstateAttendeeAction(
  _prev: AttendeeEditState,
  formData: FormData,
): Promise<AttendeeEditState> {
  const actor = await requireOrganizer();
  return run('attendee.reinstate', () => reinstateAttendee(idOf(formData), actor));
}

export async function resendConfirmationAction(
  _prev: AttendeeEditState,
  formData: FormData,
): Promise<AttendeeEditState> {
  const actor = await requireOrganizer();
  return run('attendee.confirmation', () => resendConfirmation(idOf(formData), actor));
}
