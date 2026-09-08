'use client';

import { useActionState, useState } from 'react';
import type { CallFormFieldDef } from '@kgc/shared';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  Select,
  SubmitButton,
  Textarea,
  type FormState,
} from '../../../form';
import { saveFieldAction } from './actions';

/**
 * Add a question to a call's form, or edit one.
 *
 * ── The type dropdown drives what the rest of the form shows ───────────────
 *
 * The only reason this is a client component. Options belong to a `choice` and
 * a `multi-choice`; a character limit belongs to the two text kinds; a
 * `description` collects nothing at all and so has neither, and cannot be
 * required. Rendering every control for every kind would let an organizer set a
 * character limit on a checkbox, which the validator then refuses after the
 * round trip — a form that offers a control it will not accept.
 *
 * ── Editing keeps the id, and the notice says why ──────────────────────────
 *
 * The id is what answers are stored under. Rewording is safe and the field keeps
 * its id; *retyping* it is not, and mints a new form version. The distinction is
 * on screen because it is the one an organizer cannot infer.
 */
export function FieldForm({
  callId,
  existing,
  answered,
}: {
  callId: string;
  existing?: CallFormFieldDef;
  /** How many submissions already answered this question. Zero for a new one. */
  answered: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveFieldAction, {});
  const [kind, setKind] = useState<CallFormFieldDef['kind']>(existing?.kind ?? 'short-text');

  const hasOptions = kind === 'choice' || kind === 'multi-choice';
  const hasLength = kind === 'short-text' || kind === 'long-text';
  const isDescription = kind === 'description';

  return (
    <form action={action}>
      <input type="hidden" name="callId" value={callId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <FormBanner state={state} />

      {existing && answered > 0 && (
        <p className="whova-banner warning" role="note" style={{ marginBottom: 16 }}>
          <span>
            ⚠️ {answered} {answered === 1 ? 'submission has' : 'submissions have'} already answered
            this. Rewording the prompt is safe. The question keeps its id and the answers stay
            attached. Changing its <strong>type</strong>, its options, or removing it mints a new
            form version, and those {answered} answers stay pinned to the version they were given
            under. Nothing is destroyed either way.
          </span>
        </p>
      )}

      <Select
        label="Type"
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as CallFormFieldDef['kind'])}
        width="lg"
        options={[
          { value: 'short-text', label: 'Short answer: one line' },
          { value: 'long-text', label: 'Paragraph: the abstract itself is one of these' },
          { value: 'choice', label: 'Multiple choice: pick one' },
          { value: 'multi-choice', label: 'Checkboxes: pick any' },
          { value: 'checkbox', label: 'Single checkbox: yes or no' },
          { value: 'consent', label: 'Consent: records a decision, cannot be required' },
          { value: 'description', label: 'Description: text on the page, collects no answer' },
        ]}
      />

      <Textarea
        label={isDescription ? 'The text' : 'Question'}
        name="prompt"
        required
        rows={isDescription ? 4 : 2}
        defaultValue={existing?.prompt}
        placeholder={
          isDescription
            ? 'Your abstract will be read by three reviewers. Aim for 300 words.'
            : 'What is the main contribution of this work?'
        }
        hint={
          isDescription
            ? 'Shown between questions. It asks nothing and stores nothing.'
            : 'What the submitter reads. The answer is stored under an id derived from this the first time it is saved, and that id never changes afterwards.'
        }
      />

      {hasOptions && (
        <Textarea
          label="Options"
          name="options"
          rows={5}
          required
          defaultValue={(existing?.options ?? []).join('\n')}
          placeholder={'Research\nIndustry case study\nTooling'}
          hint="One per line. At least two, and no two the same."
        />
      )}

      {hasLength && (
        <Field
          label="Character limit"
          name="maxLength"
          type="number"
          min={1}
          max={kind === 'long-text' ? 10000 : 500}
          defaultValue={existing?.maxLength ?? ''}
          placeholder={kind === 'long-text' ? '2000' : '200'}
          hint={
            kind === 'long-text'
              ? 'Up to 10,000. Leave blank for the default of 2,000. An abstract capped at 10,000 is about 1,500 words.'
              : 'Up to 500. Leave blank for the default of 200. More than 500 on one line means this wants to be a paragraph.'
          }
          width="sm"
        />
      )}

      <Field
        label="Help text"
        name="helpText"
        maxLength={200}
        defaultValue={existing?.helpText}
        placeholder="Optional. Shown in small type under the question."
        width="xl"
      />

      {!isDescription && (
        <CheckboxField
          name="required"
          label="Required"
          defaultChecked={existing?.required ?? false}
          description={
            kind === 'consent'
              ? 'A consent box cannot be required. Consent that cannot be withheld is not consent, and the validator refuses it. If this is a condition of submitting, make it a plain checkbox and say so in the prompt.'
              : 'A submitter cannot finish without answering. Nothing stops them saving a draft.'
          }
        />
      )}

      <FormActions>
        <SubmitButton>{existing ? 'Save question' : 'Add question'}</SubmitButton>
      </FormActions>
    </form>
  );
}
