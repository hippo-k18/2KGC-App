'use client';

import { useContext, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { FormSending } from './keep-typed-form';

/**
 * A submit button that says "Sending..." and cannot be pressed again while its
 * form is sending (T405). Reads `KeepTypedForm`'s own flag, and `useFormStatus`
 * for a form that posts the ordinary way.
 */
export function SendButton({ children, className = 'btn btn-primary' }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const sending = useContext(FormSending) || pending;
  return (
    <button type="submit" className={className} disabled={sending} aria-disabled={sending}>
      {sending ? 'Sending...' : children}
    </button>
  );
}
