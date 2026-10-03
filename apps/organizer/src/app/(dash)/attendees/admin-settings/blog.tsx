'use client';

import { useActionState } from 'react';
import { Field, FormActions, FormBanner, FormGrid, Select, SubmitButton } from '../../form';
import { blogRowAction, inviteBlogAction, type BlogState } from './actions';

/** Add someone to the blog. They get an email with the sign-in link. */
export function BlogInviteForm() {
  const [state, action] = useActionState<BlogState, FormData>(inviteBlogAction, {});
  return (
    <form action={action} key={`blog-invite-${state.attempt ?? 0}`}>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <FormGrid>
        <Field name="email" type="email" label="Email" required autoComplete="off" maxLength={254} defaultValue={state.typed?.email ?? ''} />
        <Field name="name" label="Name" required autoComplete="off" maxLength={120} defaultValue={state.typed?.name ?? ''} hint="The byline on their posts." />
        <Select
          name="role"
          label="Role"
          defaultValue={state.typed?.role ?? 'writer'}
          options={[
            { value: 'writer', label: 'Writer: drafts their own posts, which go to review' },
            { value: 'editor', label: 'Editor: edits and publishes any post' },
          ]}
        />
      </FormGrid>
      <FormActions>
        <SubmitButton pendingLabel="Adding…">Add to the blog</SubmitButton>
      </FormActions>
    </form>
  );
}

/** One person's buttons. The role is not changeable for the owners fixed in the server settings. */
export function BlogRowActions({ email, role, invited }: { email: string; role: 'editor' | 'writer'; invited: boolean }) {
  const [state, action] = useActionState<BlogState, FormData>(blogRowAction, {});
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <input type="hidden" name="email" value={email} />
      <FormBanner state={state} style={{ marginBottom: 4 }} />
      <button type="submit" name="intent" value={role === 'editor' ? 'make-writer' : 'make-editor'} className="linkish" style={linkButton}>
        Make {role === 'editor' ? 'writer' : 'editor'}
      </button>
      {invited && (
        <button type="submit" name="intent" value="resend" className="linkish" style={linkButton}>
          Resend invitation
        </button>
      )}
      <button type="submit" name="intent" value="remove" className="linkish" style={{ ...linkButton, color: 'var(--danger)' }}>
        Remove
      </button>
    </form>
  );
}

const linkButton = {
  background: 'none',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
} as const;
