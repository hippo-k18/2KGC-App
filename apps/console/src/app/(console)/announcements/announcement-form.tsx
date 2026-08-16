'use client';

import { useActionState } from 'react';
import { sendAnnouncementAction, type SendState } from './actions';

export function AnnouncementForm() {
  const [state, action, pending] = useActionState<SendState, FormData>(sendAnnouncementAction, {});

  return (
    <form action={action}>
      <label htmlFor="title">Title</label>
      <input id="title" name="title" required maxLength={120} />

      <label htmlFor="body">Body</label>
      <textarea id="body" name="body" rows={5} required maxLength={2000} />

      <label style={{ fontWeight: 400, marginTop: 16 }}>
        <input type="checkbox" name="push" style={{ width: 'auto' }} /> Also send as a push
        notification (seam only — nothing is delivered yet)
      </label>

      <label style={{ fontWeight: 400 }}>
        <input type="checkbox" name="confirm" style={{ width: 'auto' }} required /> I understand
        this reaches every attendee and cannot be recalled
      </label>

      <button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send announcement'}
      </button>

      {state.error ? <p className="error">{state.error}</p> : null}
      {state.ok ? <p className="ok">{state.message}</p> : null}
      {state.pushNote ? <p className="muted">{state.pushNote}</p> : null}
    </form>
  );
}
