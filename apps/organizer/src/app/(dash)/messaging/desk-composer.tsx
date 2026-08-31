'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { DeskRecipient } from '@/lib/messaging';
import { sendDeskMessageAction, type DeskMessageState } from './actions';

/**
 * The desk's composer, in both of its two shapes.
 *
 * Starting a conversation needs a recipient picker; replying inside one does
 * not, and showing a picker there would be an invitation to send the reply to
 * the wrong person. Otherwise the two are the same control, so they are one
 * component taking a fixed recipient or a list to choose from.
 *
 * ── Deliberately unlike `MessageForm` next door ─────────────────────────────
 *
 * No typed confirmation count, no passphrase, no cooldown. Those exist because
 * a bulk email reaches forty-five people irrevocably; this reaches one person
 * whose conversation is on screen above the box. The friction that is right for
 * a blast is wrong for a message somebody is trying to send while a speaker
 * stands at a gate, and `actions.ts` records the reasoning.
 */
export function DeskComposer({
  recipients,
  fixedRecipient,
}: {
  /** For the new-message form. Ignored when `fixedRecipient` is set. */
  recipients?: DeskRecipient[];
  /** Replying inside an existing conversation. */
  fixedRecipient?: { uid: string; name: string };
}) {
  const [state, action] = useActionState<DeskMessageState, FormData>(sendDeskMessageAction, {});
  const [body, setBody] = useState('');
  const [uid, setUid] = useState('');

  /**
   * Reconcile the box with whatever the last submit returned.
   *
   * A successful send clears it; a failure restores exactly what was typed,
   * because retyping a message you have already written is what makes somebody
   * give up on this screen and use their own phone. Done as a render-phase
   * comparison against the previous result rather than in an effect — this is
   * React's documented shape for "adjust state when something changes", and an
   * effect here would blank the box a frame after the organizer had started
   * typing into it again.
   */
  const [lastResult, setLastResult] = useState(state);
  if (state !== lastResult) {
    setLastResult(state);
    if (state.ok) setBody('');
    else if (state.keep !== undefined) setBody(state.keep);
  }

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      {fixedRecipient ? (
        <input type="hidden" name="recipientUid" value={fixedRecipient.uid} />
      ) : (
        <div className="whova-form-row">
          <label className="whova-form-label" htmlFor="recipientUid">
            Send to
          </label>
          <select
            id="recipientUid"
            name="recipientUid"
            required
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            style={{ maxWidth: 420 }}
          >
            <option value="">Choose someone…</option>
            {(recipients ?? []).map((r) => (
              <option key={r.uid} value={r.uid}>
                {r.isSpeaker ? '★ ' : ''}
                {r.name}
                {r.detail ? ` — ${r.detail}` : ''}
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 12 }}>
            Speakers are marked ★ and listed first. Only people who have opened the app and left
            direct messages switched on appear here.
          </p>
        </div>
      )}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="body">
          {fixedRecipient ? `Reply to ${fixedRecipient.name}` : 'Message'}
        </label>
        <textarea
          id="body"
          name="body"
          rows={5}
          required
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Your session has moved to Bloomberg 165. The AV team will meet you at the door at 14:30."
        />
        {/*
          Said here because it is the difference between this and every other
          "message X" screen in the dashboard, and an organizer who assumes a
          phone buzzes will assume the message was ignored when it was not.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          Plain text, delivered to their app inbox. <strong>There is no push notification</strong> —
          they see it when they next open the app. For anything that cannot wait, ring them.
        </p>
      </div>

      <SendButton label={fixedRecipient ? 'Send reply' : 'Send message'} />
    </form>
  );
}

/** Split out because `useFormStatus` only reports the form it is rendered inside. */
function SendButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Sending…' : label}
    </button>
  );
}
