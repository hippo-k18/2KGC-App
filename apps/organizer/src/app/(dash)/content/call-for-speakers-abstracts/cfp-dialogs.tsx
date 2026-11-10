'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  ActionForm,
  Field,
  FormBanner,
  Modal,
  SubmitButton,
  Textarea,
  useFormAction,
  type ButtonVariant,
  type FormState,
} from '../../form';
import { acceptPreviewAction } from './review/actions';
import { contactAuthorAction, contactDraftAction } from './submissions/actions';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Accept, with the acceptance email in front of the organizer first (T378).
 *
 * The button opens a dialog holding E2 exactly as it would go, subject and
 * body, the CEU line for a workshop included, both editable. Send accepts and
 * sends those words; Cancel closes and nothing is recorded. When the call has
 * closed the email waits for the decision send, so there is nothing to edit
 * and the dialog only confirms.
 *
 * `action` is the caller's: the weekly review's (no revalidate, see its
 * note) or the submission page's. Both read `submissionId`, `verdict`,
 * `e2Subject` and `e2Text`.
 */
export function AcceptWithEmail({
  submissionId,
  action,
  label = 'Accept',
  small,
  onAccepted,
}: {
  submissionId: string;
  action: Action;
  label?: string;
  small?: boolean;
  onAccepted?: (state: FormState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof acceptPreviewAction>> | null>(null);
  const [state, run] = useFormAction(action, {}, {
    onSuccess: (s) => {
      setOpen(false);
      onAccepted?.(s);
    },
  });
  const ids = useId();

  const openDialog = async () => {
    setOpen(true);
    setLoading(true);
    setPreview(null);
    try {
      setPreview(await acceptPreviewAction(submissionId));
    } catch {
      setPreview({ ok: false, error: 'Could not reach the server. Check your connection and try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`whova-btn-main primary${small ? ' small' : ''}`}
        onClick={openDialog}
        aria-haspopup="dialog"
        data-action="accept"
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Accept and send the acceptance email" width={680}>
        {loading || !preview ? (
          <p className="body-2">Preparing the email…</p>
        ) : !preview.ok ? (
          <>
            <div className="whova-banner danger" role="alert">
              <div>{preview.error}</div>
            </div>
            <DialogButtons onCancel={() => setOpen(false)} />
          </>
        ) : (
          <ActionForm run={run}>
            <input type="hidden" name="submissionId" value={submissionId} />
            <FormBanner state={state} />
            {preview.held || !preview.to ? (
              <>
                <p className="body-2">
                  {!preview.to
                    ? 'There is no author on file for this submission, so nobody will be emailed.'
                    : 'The call has closed, so the acceptance email waits until you press Send on Dates and emails.'}
                </p>
                <DialogButtons
                  onCancel={() => setOpen(false)}
                  submit={
                    <SubmitButton name="verdict" value="accept" pendingLabel="Accepting…">
                      Accept
                    </SubmitButton>
                  }
                />
              </>
            ) : (
              <>
                <Field id={`${ids}-to`} name="to" label="To" value={preview.to} readOnly width="xl" />
                <Field
                  id={`${ids}-subject`}
                  name="e2Subject"
                  label="Subject"
                  defaultValue={preview.subject}
                  required
                  maxLength={300}
                />
                <Textarea
                  id={`${ids}-text`}
                  name="e2Text"
                  label="Email"
                  defaultValue={preview.text}
                  rows={18}
                  required
                  hint="Change anything you like. The button to their details page becomes a plain link if you edit the text."
                />
                <DialogButtons
                  onCancel={() => setOpen(false)}
                  submit={
                    <SubmitButton name="verdict" value="accept" pendingLabel="Sending…">
                      Accept and send
                    </SubmitButton>
                  }
                />
              </>
            )}
          </ActionForm>
        )}
      </Modal>
    </>
  );
}

/**
 * "Contact the author" (T378): one email to the submitter, from contact@ with
 * replies to contact@, logged in the Email Log and listed under "Messages
 * sent" on the submission page.
 */
export function ContactAuthor({
  submissionId,
  small,
  variant = 'secondary',
}: {
  submissionId: string;
  small?: boolean;
  variant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof contactDraftAction>> | null>(null);
  const [sent, setSent] = useState<FormState | null>(null);
  const [state, run] = useFormAction(contactAuthorAction, {}, { onSuccess: setSent });
  const ids = useId();

  const openDialog = async () => {
    setOpen(true);
    setSent(null);
    setDraft(null);
    try {
      setDraft(await contactDraftAction(submissionId));
    } catch {
      setDraft({ ok: false, error: 'Could not reach the server. Check your connection and try again.' });
    }
  };

  return (
    <>
      <button
        type="button"
        className={`whova-btn-main ${variant}${small ? ' small' : ''}`}
        onClick={openDialog}
        aria-haspopup="dialog"
        data-action="contact"
      >
        Contact the author
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Write to the author" width={640}>
        {!draft ? (
          <p className="body-2">Loading…</p>
        ) : !draft.ok ? (
          <>
            <div className="whova-banner danger" role="alert">
              <div>{draft.error}</div>
            </div>
            <DialogButtons onCancel={() => setOpen(false)} />
          </>
        ) : sent ? (
          <>
            <FormBanner state={sent} />
            <DialogButtons onCancel={() => setOpen(false)} cancelLabel="Close" />
          </>
        ) : (
          <ActionForm run={run}>
            <input type="hidden" name="submissionId" value={submissionId} />
            <FormBanner state={state.ok ? {} : state} />
            <Field id={`${ids}-to`} name="to" label="To" value={draft.to} readOnly width="xl" />
            <Field id={`${ids}-subject`} name="subject" label="Subject" defaultValue={draft.subject} required maxLength={200} />
            <Textarea id={`${ids}-text`} name="text" label="Message" defaultValue={draft.text} rows={12} required />
            <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
              Sent from contact@knowledgegraph.tech. Replies arrive in the contact@ inbox, not here.
            </p>
            <DialogButtons
              onCancel={() => setOpen(false)}
              submit={<SubmitButton pendingLabel="Sending…">Send</SubmitButton>}
            />
          </ActionForm>
        )}
      </Modal>
    </>
  );
}

function DialogButtons({
  onCancel,
  submit,
  cancelLabel = 'Cancel',
}: {
  onCancel: () => void;
  submit?: ReactNode;
  cancelLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      {submit}
      <button type="button" className="whova-btn-main secondary" onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  );
}
