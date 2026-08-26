'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendCampaignAction, type CampaignState } from './actions';

/**
 * Compose and send a campaign to a contact list.
 *
 * Deliberately close to `messaging/message-form.tsx` in shape, and deliberately
 * not the same component. The guards differ — this one shows the suppressed
 * count beside the recipient count, because the number an organizer needs to
 * check before mailing a thousand people is "how many of these asked me to
 * stop", and Message Speakers has no equivalent question.
 *
 * ── The count has to be typed ───────────────────────────────────────────────
 *
 * Not friction for its own sake. The mistake this catches is choosing the wrong
 * list, and the only symptom of that mistake is a number nobody would otherwise
 * read.
 */
export function CampaignForm({
  lists,
  selected,
  recipientCount,
  suppressed,
  needsPassphrase,
  emailReady,
}: {
  lists: { name: string; mailable: number; count: number }[];
  selected: string;
  recipientCount: number;
  suppressed: number;
  needsPassphrase: boolean;
  emailReady: boolean;
}) {
  const [state, action] = useActionState<CampaignState, FormData>(sendCampaignAction, {});
  const [subject, setSubject] = useState(state.keep?.subject ?? '');
  const [body, setBody] = useState(state.keep?.body ?? '');
  const [testOnly, setTestOnly] = useState(false);

  if (lists.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        There are no contact lists to send to. Import one on{' '}
        <a href="/tickets/ticket-marketing/campaign-contact-list">Campaign Contact List</a> first.
      </p>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="list" value={selected} />

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
          placeholder="KGC 2027 tickets are open — early-bird until 1 March"
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
            'Tickets for KGC 2027 are open.\n\n3–7 May at Cornell Tech, Roosevelt Island.\n\nEarly-bird pricing runs until 1 March: https://www.knowledgegraph.tech/r/spring-mail'
          }
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Plain text. A blank line starts a new paragraph; nothing else is formatted. Each person
          gets &ldquo;Hi &lt;first name&gt;,&rdquo; automatically — don&rsquo;t write your own
          greeting. Use a <code>/r/</code> link so you can tell afterwards whether this worked.
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
          <strong>Send me a test first</strong> — nothing goes to the list
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
              This will email <strong>{recipientCount}</strong> people on{' '}
              <strong>{selected}</strong> and <strong>cannot be recalled</strong>.
              {suppressed > 0 ? (
                <>
                  {' '}
                  A further <strong>{suppressed}</strong> on this list unsubscribed or bounced and
                  are excluded.
                </>
              ) : null}
            </p>

            <div className="whova-form-row" style={{ marginBottom: 10 }}>
              <label className="whova-form-label" htmlFor="confirmCount">
                Type <code>{recipientCount}</code> to confirm
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

      <SendButton testOnly={testOnly} count={recipientCount} />
    </form>
  );
}

/**
 * Split out because `useFormStatus` only reports the form it sits inside. A
 * send of a thousand is sequential and takes minutes; an unchanged button is a
 * button somebody presses again, and the second press is a second email to
 * everybody.
 */
function SendButton({ testOnly, count }: { testOnly: boolean; count: number }) {
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
          ? 'Send test'
          : `Send to ${count}`}
    </button>
  );
}
