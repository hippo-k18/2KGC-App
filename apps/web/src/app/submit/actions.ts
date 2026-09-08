'use server';

import { redirect } from 'next/navigation';
import type { SubmissionCoAuthor } from '@kgc/shared';
import { readSubmissionToken } from '@kgc/scripts/src/lib/submission-token';
import { loadOwnSubmission, saveSubmission } from '@/lib/submissions';

export interface SubmitState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Submitting an abstract, or editing one.
 *
 * ── A server action is a public endpoint ───────────────────────────────────
 *
 * The page having verified a token says nothing about who invoked this, so the
 * token is re-read here from scratch. That is the same rule `consent/actions.ts`
 * follows and for the same reason.
 *
 * ── Which submission is being written comes out of the HMAC ────────────────
 *
 * Never out of a form field. There is no account here — possession of the link
 * *is* the authorisation — so a field naming a submission id would be a way to
 * edit somebody else's abstract by typing theirs. The only ids this action
 * trusts are the `callId` on the create path, which is public anyway, and the
 * `sid` inside a verified token on the edit path.
 *
 * ── The deadline is refused inside `saveSubmission` ────────────────────────
 *
 * Not here, and not on the page. `CFA-PLAN.md` §4: enforcement is server-side or
 * it is nothing, and the check belongs next to the write, on the call document
 * the write is about to be made against.
 */
export async function submitAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const token = String(formData.get('token') ?? '');
  const finish = String(formData.get('finish') ?? '') === '1';

  let submissionId: string | undefined;
  let callId = String(formData.get('callId') ?? '');

  if (token) {
    const payload = readSubmissionToken(token);
    /*
     * A forged or expired token is refused without saying which. Distinguishing
     * them would tell somebody holding a guessed link whether it was ever real.
     */
    if (!payload) return { error: 'That link is not valid any more. Ask the organizers to send you a new one.' };

    submissionId = payload.sid;
    const own = await loadOwnSubmission(payload.sid);
    if (!own) return { error: 'That submission no longer exists.' };
    // The call comes from the submission, not from the form: the token names one
    // submission, and that submission names exactly one call.
    callId = own.call.id;
  }

  if (!callId) return { error: 'No call was named.' };

  const result = await saveSubmission(
    callId,
    {
      title: String(formData.get('title') ?? ''),
      abstract: String(formData.get('abstract') ?? ''),
      trackId: String(formData.get('trackId') ?? '') || undefined,
      sessionType: String(formData.get('sessionType') ?? '') || undefined,
      answers: readAnswers(formData),
      authorName: String(formData.get('authorName') ?? ''),
      authorEmail: String(formData.get('authorEmail') ?? ''),
      affiliation: String(formData.get('affiliation') ?? '') || undefined,
      bio: String(formData.get('bio') ?? '') || undefined,
      coAuthors: readCoAuthors(String(formData.get('coAuthors') ?? '')),
      finish,
    },
    submissionId,
  );

  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  /*
   * Straight to the token page, which is the author's permanent address for
   * this submission. Redirecting rather than rendering a success message is what
   * puts the link in their browser history and in the address bar, where
   * somebody who loses the email can still find it.
   */
  redirect(`/submit/token/${result.token}?r=${result.status === 'submitted' ? 'submitted' : 'saved'}`);
}

/**
 * Withdraw, from the author's own page.
 *
 * A status change and never a delete — Firestore does not cascade, so deleting
 * the submission would leave the author's name, affiliation and address orphaned
 * under a path nothing lists.
 */
export async function withdrawAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const payload = readSubmissionToken(token);
  if (!payload) redirect('/');

  const { withdrawSubmission } = await import('@/lib/submissions');
  const ok = await withdrawSubmission(payload.sid);
  redirect(`/submit/token/${token}?r=${ok ? 'withdrawn' : 'error'}`);
}

/**
 * Every `q_`-prefixed value the POST carried, keyed by field id.
 *
 * The prefix exists so a question can never collide with `title`, `abstract` or
 * any other field on the form — a call whose form asked "Title" slugs to the
 * field id `title`, and without the prefix the answer would overwrite the
 * submission's own title.
 *
 * Handed over as raw arrays rather than shaped here: whether an answer is a
 * string or an array is a property of the field *definition*, and only the call
 * document knows that. `saveSubmission` does the shaping, against the fields it
 * just read.
 */
function readAnswers(formData: FormData): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of new Set(formData.keys())) {
    if (!key.startsWith('q_')) continue;
    out[key.slice(2)] = formData.getAll(key).map(String);
  }
  return out;
}

/**
 * `Name (Affiliation)` per line.
 *
 * Nothing here is verified and nothing pretends to be — `SubmissionCoAuthor`
 * says so. A co-author is a name the submitter typed, and the committee treats
 * it as such.
 */
function readCoAuthors(raw: string): SubmissionCoAuthor[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      const match = /^(.+?)\s*\((.+)\)\s*$/.exec(line);
      return match
        ? { name: match[1].trim(), affiliation: match[2].trim() }
        : { name: line };
    });
}
