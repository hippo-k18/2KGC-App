import type { User } from 'firebase/auth';

import { SITE_ORIGIN } from '@/config/event';

/**
 * Ask the website to delete the signed-in account (`/api/account/delete`).
 *
 * The app cannot do this itself: the rules forbid deleting `users/{uid}`, and
 * anonymising other people's threads and posts needs the Admin SDK. The ID
 * token is the only proof sent; the server takes the uid from it.
 */
export type DeleteResult = { ok: true } | { ok: false; message: string };

export async function deleteMyAccount(user: User): Promise<DeleteResult> {
  let res: Response;
  try {
    const token = await user.getIdToken();
    res = await fetch(`${SITE_ORIGIN}/api/account/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uid: user.uid }),
    });
  } catch {
    return { ok: false, message: 'Could not reach the server, so nothing was deleted. Check your connection and try again.' };
  }
  if (res.ok) return { ok: true };

  const body = (await res.json().catch(() => ({}))) as { message?: unknown };
  return {
    ok: false,
    message: typeof body.message === 'string' ? body.message : 'Your account could not be deleted. Try again in a moment.',
  };
}
