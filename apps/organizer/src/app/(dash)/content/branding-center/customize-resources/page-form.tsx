'use client';

import { useActionState, useState } from 'react';
import { normaliseSlug } from '@kgc/shared';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  SubmitButton,
  Textarea,
} from '../../../form';
import { RichText } from './rich-text';
import { savePageAction, type PageFormState } from './actions';

export interface EditablePage {
  id: string;
  title: string;
  slug: string;
  body: string;
  summary: string;
  published: boolean;
  order: number;
}

/**
 * Write one page.
 *
 * ── The preview is beside the box, not behind a button ──────────────────────
 *
 * The body is Markdown, and most organizers have never typed any. A preview
 * that has to be asked for is a preview nobody asks for, so it renders as they
 * type, from the same parser the website and the app use — which means what is
 * on screen here is what will be on the page, including the syntax that did not
 * work. Hiding an unrecognised marker would be worse than showing it: an
 * organizer who types `# Wi-Fi` and sees a heading learns the rule in one go.
 *
 * ── Why the address field fills itself and then stops ───────────────────────
 *
 * It follows the title until somebody edits it, then it is theirs. A slug that
 * kept tracking the title would silently move a published page's address on the
 * next spelling fix, and every printed link to it would stop working.
 */
export function PageForm({ existing }: { existing?: EditablePage }) {
  const [state, action] = useActionState<PageFormState, FormData>(savePageAction, {});

  const [title, setTitle] = useState(existing?.title ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(existing));
  const [body, setBody] = useState(existing?.body ?? '');

  const shownSlug = slugTouched ? slug : normaliseSlug(title);

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      <Field
        name="title"
        label="Title"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={state.fieldErrors?.title}
        maxLength={120}
        width="lg"
        hint="The heading at the top of the page."
      />

      <FormGrid>
        <Field
          name="slug"
          label="Web address"
          value={shownSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          error={state.fieldErrors?.slug}
          maxLength={60}
          hint={shownSlug ? `The page will be at /${shownSlug}` : 'Filled in from the title.'}
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

      <Field
        name="summary"
        label="Summary"
        defaultValue={existing?.summary}
        maxLength={200}
        width="lg"
        hint="One line under the title, in lists and in search results. Optional."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <Textarea
          name="body"
          label="Page text"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={state.fieldErrors?.body}
          rows={18}
          width="full"
          hint={
            <>
              <code>## Heading</code> for a heading, <code>- item</code> for a bullet,{' '}
              <code>1. item</code> for a numbered list, <code>**bold**</code>, and{' '}
              <code>[words](https://…)</code> for a link. A blank line starts a paragraph.
            </>
          }
        />

        <div>
          <div className="whova-form-label">
            <label>Preview</label>
          </div>
          <div
            className="panel"
            style={{ padding: 16, minHeight: 160, marginBottom: 0 }}
            aria-live="polite"
          >
            <h2 style={{ fontSize: 17, marginTop: 0 }}>{title || 'Untitled page'}</h2>
            {body.trim() ? (
              <RichText body={body} />
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>
                What you type appears here.
              </p>
            )}
          </div>
        </div>
      </div>

      <CheckboxField
        name="published"
        value="on"
        label="Published"
        defaultChecked={existing?.published}
        description="Published pages show on the website and in the app. Unpublished ones are only visible here."
      />

      <FormActions>
        <SubmitButton pendingLabel="Saving…">
          {existing ? 'Save changes' : 'Add page'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
