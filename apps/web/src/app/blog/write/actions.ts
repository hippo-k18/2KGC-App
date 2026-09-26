'use server';

import type { BlogRole } from '@/lib/blog/access';
import { currentViewer, requestCode, signOut, verifyCode } from '@/lib/blog/auth';
import { actionRedirect as go } from '@/lib/blog/paths';
import * as people from '@/lib/blog/people';
import * as store from '@/lib/blog/store';
import { BlogError, type DraftInput } from '@/lib/blog/store';

/**
 * The blog editor's server actions.
 *
 * None of them calls `redirect()`. Next serves an action's redirect inside the
 * same request without running middleware, so on the blog host `/write` would
 * be looked up as an app route and 404. They return `go`, a URL, and the page
 * navigates to it.
 * Each one establishes who is asking from the
 * session cookie and hands the rest to `lib/blog`, which applies the rules.
 * Arguments from the browser are content and ids only.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: (viewer: NonNullable<Awaited<ReturnType<typeof currentViewer>>>) => Promise<T>): Promise<Result<T>> {
  const viewer = await currentViewer();
  if (!viewer) return { ok: false, error: 'You have been signed out. Sign in again to keep working.' };
  try {
    return { ok: true, ...(await fn(viewer)) };
  } catch (err) {
    if (err instanceof BlogError) return { ok: false, error: err.message };
    console.error('[blog] action failed', err);
    return { ok: false, error: 'Something went wrong on the server. Your last change was not saved.' };
  }
}

// ── Signing in ──────────────────────────────────────────────────────────────

export interface SignInState {
  step: 'email' | 'code' | 'done';
  go?: string;
  email?: string;
  error?: string;
}

export async function signInAction(prev: SignInState, form: FormData): Promise<SignInState> {
  if (form.get('intent') === 'restart') return { step: 'email', email: prev.email };
  if (prev.step === 'email' || form.get('intent') === 'resend') {
    const res = await requestCode(String(form.get('email') ?? prev.email ?? ''));
    return res.ok ? { step: 'code', email: res.email } : { step: 'email', email: String(form.get('email') ?? ''), error: res.error };
  }
  const res = await verifyCode(prev.email ?? '', String(form.get('code') ?? ''));
  if (!res.ok) return { ...prev, error: res.error };
  return { step: 'done', email: prev.email, go: await go('/write') };
}

export async function signOutAction(): Promise<{ go: string }> {
  await signOut();
  return { go: await go('/write/sign-in') };
}

// ── Posts ───────────────────────────────────────────────────────────────────

export async function newPostAction(): Promise<{ go: string }> {
  const viewer = await currentViewer();
  if (!viewer) return { go: await go('/write/sign-in') };
  const id = await store.createPost(viewer);
  return { go: await go(`/write/${id}`) };
}

export async function saveDraftAction(id: string, input: DraftInput) {
  return run(async (v) => store.saveDraft(v, id, input));
}

export async function submitAction(id: string) {
  return run(async (v) => (await store.submitForReview(v, id), {}));
}

export async function withdrawAction(id: string) {
  return run(async (v) => (await store.withdraw(v, id), {}));
}

export async function publishAction(id: string) {
  return run(async (v) => store.publish(v, id));
}

export async function requestChangesAction(id: string, note: string) {
  return run(async (v) => (await store.requestChanges(v, id, note), {}));
}

export async function unpublishAction(id: string) {
  return run(async (v) => (await store.unpublish(v, id), {}));
}

export async function discardDraftAction(id: string) {
  return run(async (v) => (await store.discardDraft(v, id), {}));
}

export async function deletePostAction(id: string) {
  const path = await go('/write');
  return run(async (v) => (await store.deletePost(v, id), { go: path }));
}

// ── People ──────────────────────────────────────────────────────────────────

export async function inviteAction(input: { email: string; name: string; role: BlogRole }) {
  return run(async (v) => people.invite(v, input));
}

export async function resendInviteAction(email: string) {
  return run(async (v) => ({ sent: await people.resendInvite(v, email) }));
}

export async function setRoleAction(email: string, role: BlogRole) {
  return run(async (v) => (await people.setRole(v, email, role), {}));
}

export async function removeMemberAction(email: string) {
  return run(async (v) => (await people.removeMember(v, email), {}));
}

export async function updateProfileAction(input: { name: string; bio: string; avatar: string | null }) {
  return run(async (v) => (await people.updateProfile(v, input), {}));
}
