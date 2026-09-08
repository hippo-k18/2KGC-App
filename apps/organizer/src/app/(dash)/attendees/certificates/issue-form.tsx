'use client';

import { useActionState } from 'react';
import { ImageField } from '@/components/image-field';
import { Field, FormActions, FormBanner, FormGrid, SubmitButton, Textarea } from '../../form';
import { issueCertificatesAction, type IssueState } from './actions';

/**
 * The wording, the signatory, and the button that freezes both onto a record.
 *
 * The statement is a textarea rather than a fixed sentence because an
 * accrediting body's required phrasing is not something this project can guess,
 * and a certificate whose wording cannot be changed is a certificate that gets
 * retyped in Word — at which point the record here stops matching the paper.
 *
 * It reads "Issue" and not "Save": pressing it writes one document per
 * qualifying attendee, and re-pressing it re-issues every one of them at the
 * current attendance. That is a real action with a visible effect, so the
 * button says what it does.
 */
export function IssueForm({
  statement,
  signatoryName,
  signatoryRole,
  logoUrl,
  qualifying,
}: {
  statement: string;
  signatoryName: string;
  signatoryRole: string;
  logoUrl?: string;
  qualifying: number;
}) {
  const [state, action] = useActionState<IssueState, FormData>(issueCertificatesAction, {});

  return (
    <form action={action}>
      <FormBanner state={state} successFallback="Issued." />

      <Textarea
        label="Wording"
        name="statement"
        rows={3}
        defaultValue={statement}
        required
        hint="Printed after the attendee's name. The hours and the sessions are added underneath."
      />

      <FormGrid>
        <Field
          label="Signed by"
          name="signatoryName"
          defaultValue={signatoryName}
          required
          autoComplete="off"
          placeholder="François Scharffe"
          hint="As it should print."
        />
        <Field
          label="Their role"
          name="signatoryRole"
          defaultValue={signatoryRole}
          autoComplete="off"
          placeholder="Conference Chair"
          hint="Optional: a blank prints one line instead of two."
        />
      </FormGrid>

      {/*
        The same `ImageField` the sponsor and speaker editors use, so the file
        arrives in this action's own FormData and "issue" stays one round trip
        rather than "upload, then hope the issue works". The URL already pinned
        rides along hidden, so a run that changes only the wording keeps the
        mark.
      */}
      <input type="hidden" name="currentLogoUrl" value={logoUrl ?? ''} />
      <ImageField
        name="logo"
        label="Certificate mark"
        currentUrl={logoUrl}
        help="Printed at the head of every certificate in this run, and stored on each one. Replacing it later does not redraw a certificate already handed over. Starts as the KGC mark; upload your own to override it, or Remove to print no mark at all."
      />

      <FormActions>
        <SubmitButton pendingLabel="Issuing…" disabled={qualifying === 0}>
          Issue {qualifying} {qualifying === 1 ? 'certificate' : 'certificates'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
