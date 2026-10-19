'use client';

import { startTransition, type FormEvent, type ReactNode } from 'react';

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
 * `action` stays on the element, so without JavaScript the form still posts.
 * The browser's own checks run first, exactly as before: the submit event
 * only fires once they pass, or when the button says `formNoValidate`.
 */
export function KeepTypedForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => unknown;
  className?: string;
  children: ReactNode;
}) {
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null;
    const data = new FormData(e.currentTarget);
    // The pressed button's own name and value, as a native post would send.
    if (submitter?.name) data.set(submitter.name, submitter.value);
    startTransition(() => {
      void action(data);
    });
  };

  return (
    <form action={action as (formData: FormData) => void} className={className} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
