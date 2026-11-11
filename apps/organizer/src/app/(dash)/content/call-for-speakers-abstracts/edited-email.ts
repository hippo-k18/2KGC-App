/**
 * The subject and body the Accept dialog posts (T378), or undefined when it
 * posted none (bulk accept, an old tab): the standard email then goes.
 *
 * A plain module, not part of a `'use server'` file: see `routes.ts`.
 */
export function editedEmailFrom(formData: FormData): { subject: string; text: string } | undefined {
  const subject = formData.get('e2Subject');
  const text = formData.get('e2Text');
  if (typeof subject !== 'string' || typeof text !== 'string') return undefined;
  if (!subject.trim() || !text.trim()) return undefined;
  return { subject: subject.slice(0, 300), text: text.slice(0, 20_000) };
}
