'use client';

import { startTransition, useRef, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useStaleGuard, type StaleGuard } from './stale-guard';

/**
 * A form that keeps what was typed when the server says no (T280 B#2).
 *
 * React 19 resets every uncontrolled field once a form `action` finishes, so
 * a refused save (a bad phone number, a description ten words short) emptied
 * a 300-word description along with everything else. Here the submit is
 * caught and the same action is called inside a transition instead, which
 * React does not follow with a reset. A redirect from the action still
 * navigates as before.
 *
 * It also survives a deploy (T379): an action posted from a page an older
 * build served fails with "Server action not found", and `useStaleGuard`
 * keeps the text, reloads once and fills it back in. Any other failure keeps
 * the text and says it did not send, rather than leaving a page that looks
 * like it ignored the press.
 *
 * `action` stays on the element, so without JavaScript the form still posts.
 * The browser's own checks run first, exactly as before: the submit event
 * only fires once they pass, or when the button says `formNoValidate`.
 *
 * A form whose action comes from `useActionState` runs the guard itself, on
 * the action before `useActionState` wraps it (that is the only place its
 * error can be caught), and passes it here as `guard` with the same `formRef`.
 */
export function KeepTypedForm({
  action,
  className,
  style,
  children,
  again,
  guard,
  formRef,
  name,
}: {
  action: (formData: FormData) => unknown;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** How the notice ends, e.g. "please press I agree again". */
  again?: string;
  guard?: StaleGuard;
  formRef?: RefObject<HTMLFormElement | null>;
  /** Keeps this form's saved text apart from another form's on the same page. */
  name?: string;
}) {
  const ownRef = useRef<HTMLFormElement>(null);
  const ref = formRef ?? ownRef;
  const own = useStaleGuard(ref, again, !guard, name);
  const g = guard ?? own;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null;
    const data = new FormData(e.currentTarget);
    // The pressed button's own name and value, as a native post would send.
    if (submitter?.name) data.set(submitter.name, submitter.value);
    const send = g.guardAction(action);
    startTransition(() => {
      // As before T379, nothing left over is thrown into the page: only
      // Next's own redirect signals get past the guard, and the router has
      // already acted on those.
      send(data).catch(() => {});
    });
  };

  return (
    <form ref={ref} action={action as (formData: FormData) => void} className={className} style={style} onSubmit={onSubmit}>
      {g.notice}
      {children}
    </form>
  );
}
