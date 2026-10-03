'use client';

import { useActionState } from 'react';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  SubmitButton,
  Textarea,
} from '../../../form';
import { savePageCopyAction, type PageCopyState } from './actions';

/**
 * The three editors, one form per `pageContent` document.
 *
 * Three forms rather than one, because one Save that writes three documents
 * cannot report a partial failure honestly — and these three pages have nothing
 * to do with each other beyond living on the same site.
 *
 * `key={state.version}` on every control is the remount `form.tsx` warns about:
 * the fields are uncontrolled, so after a save React keeps the DOM node and
 * ignores the new `defaultValue`, and the box would go on showing what the
 * organizer typed next to a green "Saved" even if the value stored differed.
 */
const EMPTY: PageCopyState = {};

function useCopyForm() {
  return useActionState(savePageCopyAction, EMPTY);
}

export function CodeOfConductForm({
  reportEmail,
  fallbackEmail,
  committee,
}: {
  reportEmail: string;
  /**
   * What `/code-of-conduct` prints while the box above is empty. Passed in
   * rather than imported so this file holds no address of its own — the string
   * is `EVENT.contactEmail`, declared once in `@kgc/shared` and read by the
   * public page as well, so the hint cannot come to disagree with the page.
   */
  fallbackEmail: string;
  committee: string;
}) {
  const [state, action] = useCopyForm();
  const v = state.version ?? 0;

  return (
    <form action={action}>
      <input type="hidden" name="page" value="code-of-conduct" />
      <FormBanner state={state} style={{ marginBottom: 14 }} />

      <Field
        key={`e${v}`}
        name="reportEmail"
        label="Reporting address"
        type="email"
        width="xl"
        defaultValue={reportEmail}
        error={state.fieldErrors?.reportEmail}
        hint={`Where incident reports go. If empty, the page shows ${fallbackEmail}.`}
      />

      <Textarea
        key={`c${v}`}
        name="committee"
        label="Executive Committee"
        rows={6}
        width="xl"
        defaultValue={committee}
        error={state.fieldErrors?.committee}
        hint="One “Name, Role” per line, in the order shown. If empty, the page shows its default list."
      />

      <FormActions>
        <SubmitButton>Save reporting route</SubmitButton>
      </FormActions>
    </form>
  );
}

export function CallPageForm({
  page,
  submitUrl,
  submitLabel,
  dates,
  datesConfirmed,
}: {
  page: 'call-for-posters' | 'startup-pitch';
  submitUrl: string;
  submitLabel: string;
  dates: string;
  datesConfirmed: boolean;
}) {
  const [state, action] = useCopyForm();
  const v = state.version ?? 0;

  return (
    <form action={action}>
      <input type="hidden" name="page" value={page} />
      <FormBanner state={state} style={{ marginBottom: 14 }} />

      <Field
        key={`u${v}`}
        name="submitUrl"
        label="Submission URL"
        type="url"
        width="xl"
        defaultValue={submitUrl}
        error={state.fieldErrors?.submitUrl}
        hint="A full https:// address. If empty, the button is hidden."
      />

      <Field
        key={`l${v}`}
        name="submitLabel"
        label="Button label"
        width="xl"
        defaultValue={submitLabel}
        error={state.fieldErrors?.submitLabel}
        hint="For example “Submit on EasyChair”."
      />

      <Textarea
        key={`d${v}`}
        name="dates"
        label="Deadlines"
        rows={6}
        width="xl"
        defaultValue={dates}
        error={state.fieldErrors?.dates}
        hint="One per line, “March 25, 2027 | Submissions close”. If empty, the page shows its default dates."
      />

      <CheckboxField
        key={`k${v}`}
        name="datesConfirmed"
        label="These dates are confirmed"
        defaultChecked={datesConfirmed}
        description="Leave this off while the dates are provisional. It only applies when the box above has dates in it."
      />

      <FormActions>
        <SubmitButton>Save this call</SubmitButton>
      </FormActions>
    </form>
  );
}
