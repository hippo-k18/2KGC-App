import 'server-only';

import * as people from '@kgc/scripts/src/lib/blog-people';
import type { BlogResult, BlogRole } from '@kgc/scripts/src/lib/blog-people';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Who can write for the blog, as managed from Attendees › Admin Settings.
 *
 * The rules, the invitation email and the audit entry live in
 * `@kgc/scripts/src/lib/blog-people.ts`, which the blog editor's own People
 * page (`/blog/write/people`, editors only) calls too. A change made in either
 * place is in the same `blogMembers` documents, so the other screen shows it on
 * its next load.
 */

export type { BlogPerson, BlogResult, BlogRole } from '@kgc/scripts/src/lib/blog-people';
export const fixedBlogEditors = people.fixedBlogEditors;
export const blogPeopleUrl = people.blogPeopleUrl;

const actorOf = (email: string) => ({ email, source: 'dashboard' as const });

async function guarded(what: string, fallback: string, fn: () => Promise<BlogResult>): Promise<BlogResult> {
  try {
    return await fn();
  } catch (err) {
    recordError(what, err);
    return { ok: false, error: fallback };
  }
}

export const listBlogPeople = () => people.listBlogPeople(db());

export const inviteBlogPerson = (input: { email: string; name: string; role: BlogRole; actor: string }) =>
  guarded('blog.invite', 'Could not add them.', () => people.inviteBlogPerson(db(), input, actorOf(input.actor)));

export const setBlogRole = (input: { email: string; role: BlogRole; actor: string }) =>
  guarded('blog.role', 'Could not change their role.', () => people.setBlogRole(db(), input, actorOf(input.actor)));

/** Ends blog access at once. Their posts stay, and editors can still publish or remove them. */
export const removeBlogPerson = (input: { email: string; actor: string }) =>
  guarded('blog.remove', 'Could not remove them.', () => people.removeBlogPerson(db(), input, actorOf(input.actor)));

export const resendBlogInvitation = (input: { email: string; actor: string }) =>
  guarded('blog.resendInvitation', 'Could not send the invitation.', () =>
    people.resendBlogInvitation(db(), input, actorOf(input.actor)),
  );
