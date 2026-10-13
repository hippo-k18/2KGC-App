import 'server-only';

import * as people from '@kgc/scripts/src/lib/blog-people';
import type { BlogPerson, BlogResult, BlogRole } from '@kgc/scripts/src/lib/blog-people';
import { db } from '@/lib/firestore';
import { canManagePeople, type Viewer } from './access';

/**
 * The People screen in the blog editor. Editors only.
 *
 * Every rule, the invitation email and the audit entry are in
 * `@kgc/scripts/src/lib/blog-people.ts`, shared with the dashboard's
 * Attendees › Admin Settings › Blog panel, so the two screens manage one list
 * the same way. This file only adds the check that the viewer is an editor,
 * made here on the server for every call rather than by hiding a link.
 */

export type { BlogPerson, BlogResult, BlogRole };

export const NOT_AN_EDITOR = 'Only editors can manage who writes for the blog.';

const actorOf = (v: Viewer) => ({ email: v.email, source: 'blog' as const });

async function asEditor(v: Viewer, fn: () => Promise<BlogResult>): Promise<BlogResult> {
  if (!canManagePeople(v)) return { ok: false, error: NOT_AN_EDITOR };
  try {
    return await fn();
  } catch (err) {
    console.error('[blog] people action failed', err);
    return { ok: false, error: 'Something went wrong on the server. Nothing was changed.' };
  }
}

export async function listPeople(v: Viewer): Promise<BlogPerson[]> {
  if (!canManagePeople(v)) throw new Error(NOT_AN_EDITOR);
  return people.listBlogPeople(db(), { includeRemoved: true });
}

export const invitePerson = (v: Viewer, input: { email: string; name: string; role: BlogRole }) =>
  asEditor(v, () => people.inviteBlogPerson(db(), input, actorOf(v)));

export const setPersonRole = (v: Viewer, email: string, role: BlogRole) =>
  asEditor(v, () => people.setBlogRole(db(), { email, role }, actorOf(v)));

export const removePerson = (v: Viewer, email: string) =>
  asEditor(v, () => people.removeBlogPerson(db(), { email }, actorOf(v)));

export const resendInvitation = (v: Viewer, email: string) =>
  asEditor(v, () => people.resendBlogInvitation(db(), { email }, actorOf(v)));

/** Admin Settings on the dashboard, where the same list is managed. */
export const DASHBOARD_BLOG_SETTINGS = 'https://dashboard.knowledgegraph.tech/attendees/admin-settings';
