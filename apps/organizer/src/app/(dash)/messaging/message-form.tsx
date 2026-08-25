'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Audience, Recipient } from '@/lib/messaging';
import { sendBulkMessageAction, type MessageState } from './actions';

/**
 * The compose form, shared by Message Speakers and Message Sponsors.
 *
 * One component rather than two, because the screens differ only in which
 * audience they resolve. Whova's are visually identical too.
 *
 * ── The recipient count is the safety mechanism ─────────────────────────────
 *
 * It is shown large, next to the segment picker, and it has to be **typed** to
 * confirm. That is not friction for its own sake: the mistake this catches is
 * picking the wrong segment, and the only symptom of that mistake is a number
 * the organizer would otherwise never read.
 */
export function MessageForm({
  audience,
  segment,
  recipients,
  withoutEmail,
  needsPassphrase,
  emailReady,
}: {
  audience: Audience;
  segment: string;
  recipients: Recipient[];
  withoutEmail: number;
  needsPassphrase: boolean;
  emailReady: boolean;
}) {
  const [state, action] = useActionState<MessageState, FormData>(sendBulkMessageAction, {});
  const [subject, setSubject] = useState(state.keep?.subject ?? '');
  const [body, setBody] = useState(state.keep?.body ?? '');
  const [testOnly, setTestOnly] = useState(false);

  return (
    <form action={action}>
      <input type="hidden" name="audience" value={audience.id} />
      <input type="hidden" name="segment" value={segment} />

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      {!emailReady && (
        <p className="error">
          <strong>No email provider is configured.</strong> Set <code>RESEND_API_KEY</code> to send
          anything. Until then every attempt is recorded as skipped, which is visible but useless.
        </p>
      )}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="subject">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Your KGC 2027 slides are due 20 April"
          maxLength={120}
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="body">
          Message
        </label>
        <textarea
          id="body"
          name="body"
          rows={12}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            'Thanks again for speaking at KGC 2027.\n\nWe need your slides by 20 April so the AV team can load them.\n\nUpload here: …'
          }
        />
        {/*
          Said plainly because organizers paste from Word and expect formatting
          to survive. It will not, and finding that out from a sent email is
          worse than reading it here.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          Plain text. A blank line starts a new paragraph; nothing else is formatted. Each person
          gets &ldquo;Hi &lt;first name&gt;,&rdquo; automatically — don&rsquo;t write your own
          greeting.
        </p>
      </div>

      <div
        style={{
          background: 'var(--surface-alt)',
          border: '1px solid var(--hairline)',
          borderRadius: 4,
          marginBottom: 16,
          padding: 14,
        }}
      >
        <label style={{ display: 'block', marginBottom: 10 }}>
          <input
            type="checkbox"
            name="testOnly"
            checked={testOnly}
            onChange={(e) => setTestOnly(e.target.checked)}
          />{' '}
          <strong>Send me a test first</strong> — nothing goes to any {audience.noun}
        </label>

        {testOnly ? (
          <div className="whova-form-row" style={{ marginBottom: 0 }}>
            <label className="whova-form-label" htmlFor="testAddress">
              Send the test to
            </label>
            <input
              id="testAddress"
              name="testAddress"
              type="email"
              placeholder="you@knowledgegraph.tech"
              style={{ maxWidth: 320 }}
            />
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
              This will email <strong>{recipients.length}</strong> {audience.noun} and{' '}
              <strong>cannot be recalled</strong>. Sending twice is indistinguishable from a mistake
              in somebody&rsquo;s inbox.
            </p>

            <div className="whova-form-row" style={{ marginBottom: 10 }}>
              <label className="whova-form-label" htmlFor="confirmCount">
                Type <code>{recipients.length}</code> to confirm
              </label>
              <input
                id="confirmCount"
                name="confirmCount"
                autoComplete="off"
                inputMode="numeric"
                style={{ maxWidth: 120 }}
              />
            </div>

            {needsPassphrase && (
              <div className="whova-form-row" style={{ marginBottom: 0 }}>
                <label className="whova-form-label" htmlFor="passphrase">
                  Dashboard passphrase
                </label>
                <input
                  id="passphrase"
                  name="passphrase"
                  type="password"
                  autoComplete="off"
                  style={{ maxWidth: 240 }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {withoutEmail > 0 && !testOnly && (
        <p className="muted" style={{ fontSize: 12 }}>
          ⚠️ {withoutEmail} {withoutEmail === 1 ? 'record has' : 'records have'} no email address and
          will receive nothing. They are listed under the recipients below.
        </p>
      )}

      <SendButton testOnly={testOnly} count={recipients.length} noun={audience.noun} />
    </form>
  );
}

/**
 * Split out because `useFormStatus` only reports the status of the form it is
 * rendered inside. A send of forty-five is sequential and takes a few seconds;
 * an unchanged button is a button somebody presses again, and the second press
 * is a second email to everybody.
 */
function SendButton({
  testOnly,
  count,
  noun,
}: {
  testOnly: boolean;
  count: number;
  noun: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={testOnly ? 'whova-btn-main secondary' : 'whova-btn-main'}
      disabled={pending || (!testOnly && count === 0)}
    >
      {pending
        ? testOnly
          ? 'Sending test…'
          : `Sending to ${count}…`
        : testOnly
          ? 'Send test to me'
          : `Send to ${count} ${noun}`}
    </button>
  );
}
