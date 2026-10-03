'use client';

import { useActionState } from 'react';
import {
  CheckboxField,
  Field,
  FieldSet,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  Textarea,
} from '../../../form';
import { saveDocumentAction, type DocumentState } from './actions';

export interface EditableDocument {
  id: string;
  title: string;
  description: string;
  url: string;
  kind: 'pdf' | 'slides' | 'video' | 'link';
  /**
   * `PublishStatus`, all three values. `cancelled` is not offered as a *new*
   * choice A document nobody should see is a draft… but an existing one that
   * carries it keeps it until somebody deliberately changes it, because
   * narrowing the control to two values would silently rewrite the third on the
   * next save.
   */
  status: 'draft' | 'published' | 'cancelled';
  order: number;
  /** The session whose page this handout appears on, or `''` for none. */
  sessionId: string;
  visibleToTicketTypes: string[];
}

/** One line in the session picker: enough to tell two identically-named talks apart. */
export interface SessionOption {
  id: string;
  label: string;
}

/**
 * Add or edit one document.
 *
 * ── Why the field is called "Link" and not "File" ───────────────────────────
 *
 * `DocumentDoc.url` points at something hosted elsewhere. Firebase Storage is
 * live and `lib/uploads.ts` writes to it, but only for the three image fields it
 * was built for — a picker here would need a document prefix in
 * `storage.rules`, a type check that is not "is this a PNG", and a size cap an
 * order of magnitude above a logo's. Until that exists the honest control is a
 * URL box, and calling it anything else is how a dashboard acquires a capability
 * it does not have.
 *
 * ── The restriction is the control to read twice ────────────────────────────
 *
 * Ticking nothing means everybody. Ticking a tier hides the row from every
 * attendee who did not buy that tier — and hides it from the public documents
 * page entirely, whatever the status says. The link itself stays reachable by
 * anyone who has it either way, which the hint says rather than implying that
 * this is access control.
 */
export function DocumentForm({
  existing,
  ticketTypeNames,
  sessions,
}: {
  existing?: EditableDocument;
  /** Names, not ids — `apps/web` matches the restriction on the name. */
  ticketTypeNames: string[];
  /** The whole programme, so slides can be put on the talk they belong to. */
  sessions: SessionOption[];
}) {
  const [state, action] = useActionState<DocumentState, FormData>(saveDocumentAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      <Field
        name="title"
        label="Title"
        required
        defaultValue={existing?.title}
        error={state.fieldErrors?.title}
        maxLength={120}
        width="lg"
        hint="What an attendee taps. “Venue map” beats “KGC2027_map_v3_final”."
      />

      <Field
        name="url"
        label="Link"
        required
        type="url"
        defaultValue={existing?.url}
        error={state.fieldErrors?.url}
        placeholder="https://…"
        width="lg"
        hint="Host the file wherever you already do and paste the address. Anyone with the link can open it."
      />

      <Textarea
        name="description"
        label="Description"
        defaultValue={existing?.description}
        rows={2}
        maxLength={280}
        hint="One line under the title. Optional."
      />

      <FormGrid>
        <Select
          name="kind"
          label="Kind"
          defaultValue={existing?.kind ?? 'link'}
          options={[
            { value: 'pdf', label: 'PDF' },
            { value: 'slides', label: 'Slides' },
            { value: 'video', label: 'Video' },
            { value: 'link', label: 'Link' },
          ]}
          hint="Decides the icon beside the row."
        />
        <Select
          name="status"
          label="Status"
          defaultValue={existing?.status ?? 'draft'}
          options={[
            { value: 'draft', label: 'Draft, not visible to attendees' },
            { value: 'published', label: 'Published: live in the app' },
            ...(existing?.status === 'cancelled'
              ? [{ value: 'cancelled', label: 'Withdrawn: hidden everywhere' }]
              : []),
          ]}
        />
        <Field
          name="order"
          label="Order"
          type="number"
          defaultValue={existing?.order ?? 0}
          error={state.fieldErrors?.order}
          hint="Low numbers first."
        />
      </FormGrid>

      {/*
        Attaching to a session puts the row on that talk's page in the app and
        in the agenda on the website, as well as leaving it in the main list.
        It is a second place to find the same handout, not a move — somebody
        looking for "the slides from this morning" and somebody looking for
        "all the slides" are both right.
      */}
      <Select
        name="sessionId"
        label="Session"
        defaultValue={existing?.sessionId ?? ''}
        error={state.fieldErrors?.sessionId}
        width="lg"
        options={[
          { value: '', label: 'Not attached to a session' },
          ...sessions.map((s) => ({ value: s.id, label: s.label })),
        ]}
        hint={
          sessions.length === 0
            ? 'No sessions are on the agenda yet.'
            : 'Shows this handout on that session’s page as well as in the documents list.'
        }
      />

      <FieldSet
        legend="Visible to"
        hint="Tick nothing for everybody. Ticking a tier also takes the document off the public documents page."
      >
        {ticketTypeNames.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            No ticket types have been entered, so there is nothing to restrict this to yet.
          </p>
        ) : (
          ticketTypeNames.map((name) => (
            <CheckboxField
              key={name}
              name="visibleToTicketTypes"
              value={name}
              label={name}
              defaultChecked={existing?.visibleToTicketTypes.includes(name)}
            />
          ))
        )}
      </FieldSet>

      <FormActions>
        <SubmitButton pendingLabel="Saving…">
          {existing ? 'Save changes' : 'Add document'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
