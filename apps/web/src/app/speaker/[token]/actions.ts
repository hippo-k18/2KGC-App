'use server';

import { redirect } from 'next/navigation';
import type { DraftInput } from '@kgc/scripts/src/lib/speaker-portal-core';
import { recordDraft } from '@/lib/speaker-portal';

/**
 * Saving a speaker's own profile, as a draft.
 *
 * A server action, which is a `POST`, and that is not incidental: a write on
 * `GET` would be performed by every corporate mail scanner that follows the
 * links in a message. Outlook Safe Links would submit an empty profile for
 * every speaker the moment the invitation arrived, which under the clearing
 * rules below means proposing that every bio be deleted.
 *
 * The token is re-checked here rather than trusted from the page. A server
 * action is a public endpoint like any other, and the page having verified it
 * says nothing about who invoked this.
 *
 * ⚠️ Re-checking means `openPortal`, inside `recordDraft`, and not a bare
 * signature check. Verifying the HMAC alone is what this action did, and it
 * left "Revoke link" stopping the page while the writes carried on for the
 * rest of the token's 180 days. The token is handed straight to `recordDraft`
 * so there is no speaker id in this file to write on behalf of.
 *
 * ── Whose profile comes from the token and never from the form ──────────────
 *
 * The only things read out of `formData` are the values typed into the boxes.
 * Which speaker they belong to is inside the HMAC, so a request naming somebody
 * else changes nothing about whose record is written.
 *
 * ── A missing field and an empty one are different ──────────────────────────
 *
 * `formData.has(name)` decides whether the key reaches the draft at all, and
 * the value decides whether it is a change or a clearance. Collapsing the two
 * is AGENTS.md gotcha 9 — the form that says "Saved" and changes nothing — and
 * here it would mean a speaker could never remove a job title they no longer
 * hold.
 */
export async function saveSpeakerProfileAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');

  const field = (name: string): string | undefined =>
    formData.has(name) ? String(formData.get(name) ?? '') : undefined;

  const slides: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('slides:')) continue;
    slides[key.slice('slides:'.length)] = String(value ?? '');
  }

  const input: DraftInput = {
    title: field('title'),
    company: field('company'),
    bio: field('bio'),
    photoURL: field('photoURL'),
    linkedin: field('linkedin'),
    x: field('x'),
    website: field('website'),
    ...(Object.keys(slides).length ? { slides } : {}),
  };

  const { outcome, errors } = await recordDraft(token, input);

  /*
   * A forged, expired or revoked token redirects to the same page a valid one
   * does, which then 404s on its own check. Redirecting rather than throwing
   * keeps all four indistinguishable from outside — and keeps this action from
   * answering "is this person still speaking?" to whoever holds an old URL.
   */
  if (outcome === 'revoked') redirect(`/speaker/${encodeURIComponent(token)}`);

  /*
   * The problems travel in the query string rather than in a session, because
   * this page holds no session at all — there is no cookie, no account and
   * nothing to key a flash message to. They are the sentences the validator
   * wrote, and the page renders them as text.
   */
  const suffix =
    outcome === 'invalid' && errors.length
      ? `&e=${encodeURIComponent(errors.join('|'))}`
      : '';
  redirect(`/speaker/${encodeURIComponent(token)}?r=${outcome}${suffix}`);
}
