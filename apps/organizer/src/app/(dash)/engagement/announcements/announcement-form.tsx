'use client';

import { useActionState } from 'react';
import { CharCount, HelpTip } from '../../menu';
import { sendAnnouncementAction, type SendState } from './actions';

/**
 * Whova's "Start from scratch" compose modal, as an inline panel.
 *
 * The field order is theirs — Recipients, Sender name, Reply-to, Subject, Body,
 * Send options, When to send — and the three send options are quoted from their
 * UI verbatim, because the distinction between them ("attendees without the app
 * will only get an email") is the part organizers actually reason about.
 *
 * Every option that needs an email sender or a segment to exist is present and
 * disabled rather than deleted. A disabled radio with a one-line reason under
 * it tells an organizer evaluating the move exactly where they stand; silently
 * omitting the option tells them we never thought about it.
 */
export function AnnouncementForm({ recipientCount }: { recipientCount: number }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendAnnouncementAction, {});

  return (
    <form action={action}>
      <div className="whova-form-group">
        <div className="whova-form-label">
          <span>Recipients</span>
          <span className="whova-form-label-suffix">*</span>
          <HelpTip>
            Whova targets by ticket type, category or segment and shows a live count before you
            send. All three derive from registration question answers, which nothing collects yet —
            so the only real audience here is everyone.
          </HelpTip>
        </div>
        <div className="whova-radio-group">
          <label className="whova-radio-label">
            <input
              className="whova-radio-input"
              type="radio"
              name="recipients"
              value="all"
              defaultChecked
            />
            <span>All attendees ({recipientCount})</span>
          </label>
          {[
            ['Specific attendee ticket type', 'needs ticket types'],
            ['Specific attendee category', 'needs categories'],
            ['Specific attendee segment', 'needs registration question answers'],
            ['Attendees who added a specific session', 'reads savedSessions — buildable, not built'],
          ].map(([label, why]) => (
            <div key={label}>
              <label className="whova-radio-label">
                <input className="whova-radio-input" type="radio" name="recipients" disabled />
                <span>{label}</span>
              </label>
              <div className="whova-radio-description">{why}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="title">Subject</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          id="title"
          name="title"
          className="whova-text-input"
          placeholder="Enter subject"
          required
          maxLength={120}
        />
        <CharCount id="title" max={120} />
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="body">Body</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <textarea
          id="body"
          name="body"
          className="whova-text-input"
          rows={6}
          required
          maxLength={2000}
        />
        <CharCount id="body" max={2000} />
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <span>Send options</span>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <div className="whova-checkbox-group">
          <div>
            <label className="whova-checkbox-label">
              <input className="whova-checkbox-input" type="checkbox" name="push" />
              <span>Also send as a push notification</span>
            </label>
            <div className="whova-checkbox-description">
              One FCM topic send from this server via the Admin SDK — no Cloud Function, so this
              works on the free plan. It refuses while the dashboard is pointed at the emulator and
              tells you so, rather than pretending to have sent.
            </div>
          </div>
          <div>
            <label className="whova-checkbox-label">
              <input className="whova-checkbox-input" type="checkbox" disabled />
              <span>Send email as well</span>
            </label>
            <div className="whova-checkbox-description">
              Still the one genuinely missing channel — needs a transactional provider with a
              verified sending domain. Unlike push, no plan upgrade unblocks it.
            </div>
          </div>
        </div>
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <span>When to send</span>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <div className="whova-radio-group">
          <label className="whova-radio-label">
            <input className="whova-radio-input" type="radio" name="when" value="now" defaultChecked />
            <span>Send now</span>
          </label>
          <div>
            <label className="whova-radio-label">
              <input className="whova-radio-input" type="radio" name="when" disabled />
              <span>Schedule send date</span>
            </label>
            <div className="whova-radio-description">
              Deliberately absent. A 6am wrong-timezone blast is a common real failure; requiring a
              human to press the button, awake, in the room, is the cheapest defence there is.
            </div>
          </div>
        </div>
      </div>

      <div className="whova-form-group">
        <label className="whova-checkbox-label">
          <input className="whova-checkbox-input" type="checkbox" name="confirm" required />
          <span>I understand this reaches every attendee and cannot be recalled.</span>
        </label>
      </div>

      {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      {state.ok ? <p style={{ color: 'var(--success)', fontSize: 14 }}>{state.message}</p> : null}
      {state.pushNote ? <p className="whova-form-description">{state.pushNote}</p> : null}

      <button type="submit" className="whova-btn-main primary" disabled={pending}>
        {pending ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
