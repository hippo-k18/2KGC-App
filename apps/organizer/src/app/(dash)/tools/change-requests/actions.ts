'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { CHANGE_REQUESTS_PATH, PUBLIC_LIST_TAG, isStatus } from '@/lib/change-requests-core';
import { saveChangeRequestNote, setChangeRequestPublic, setChangeRequestStatus } from '@/lib/change-requests';

/**
 * Tools › Change requests (T428). Three forms: move the status, show or
 * hide it on the public list (T433), save the note. Each answers by redirecting back with what happened in the address,
 * so a reload shows the same line and never posts again.
 */

const idOf = (formData: FormData) => {
  const id = String(formData.get('id') ?? '');
  return /^[A-Za-z0-9]{10,40}$/.test(id) ? id : null;
};

export async function setChangeRequestStatusAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = idOf(formData);
  const status = formData.get('status');
  if (!id || !isStatus(status)) redirect(CHANGE_REQUESTS_PATH);

  const result = await setChangeRequestStatus(id, status, actor);
  revalidatePath(CHANGE_REQUESTS_PATH);
  revalidateTag(PUBLIC_LIST_TAG);
  revalidatePath('/', 'layout');
  const q = new URLSearchParams();
  if (!result.ok) q.set('error', 'status');
  else {
    q.set('saved', 'status');
    if (result.email) q.set('mail', `${result.email.kind}-${result.email.outcome}`);
  }
  redirect(`${CHANGE_REQUESTS_PATH}/${id}?${q}`);
}

export async function saveChangeRequestNoteAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = idOf(formData);
  if (!id) redirect(CHANGE_REQUESTS_PATH);
  const ok = await saveChangeRequestNote(id, String(formData.get('notes') ?? ''), actor);
  revalidatePath(CHANGE_REQUESTS_PATH);
  redirect(`${CHANGE_REQUESTS_PATH}/${id}?${ok ? 'saved=note' : 'error=note'}`);
}

/** The "Show on public list" box (T433). Unticked hides the request from `/request`. */
export async function setChangeRequestPublicAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = idOf(formData);
  if (!id) redirect(CHANGE_REQUESTS_PATH);
  const show = formData.get('public') === 'on';
  const ok = await setChangeRequestPublic(id, show, actor);
  revalidatePath(CHANGE_REQUESTS_PATH);
  revalidateTag(PUBLIC_LIST_TAG);
  redirect(`${CHANGE_REQUESTS_PATH}/${id}?${ok ? `saved=${show ? 'shown' : 'hidden'}` : 'error=public'}`);
}
