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
 * ── The unbuilt options are gone from the form, not greyed out in it ────────
 *
 * This file used to carry six disabled controls — four recipient filters, an
 * email checkbox and a scheduled send — each with a one-line reason beneath it.
 * The argument was that a disabled option tells an organizer evaluating the
 * move exactly where they stand. It does, and it also tells everyone *else* the
 * same thing, because a `disabled` attribute is not behind `SHOW_GAP_NOTES`:
 * six greyed controls render to a demo audience as a product that half works.
 * The reasons moved intact to the gap panel on the page, which is behind the
 * flag, and the form now offers only what it can do.
 *
 * What is left is a single-audience send. The Recipients group is kept as one
 * fixed row rather than dropped, because "who is this going to" is the question
 * an organizer must answer before pressing a button that cannot be recalled,
 * and a form that does not ask it invites the assumption that it went to fewer
 * people than it did.
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
          <div className="whova-radio-description">
            The only audience there is. An announcement writes one document that every signed-in
            attendee reads, and the push goes to a topic rather than to a list of devices — so
            there is nowhere for a narrower audience to be expressed even if one could be computed.
          </div>
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
          <div className="whova-radio-description">
            The only option, and one of them on purpose: a 6am wrong-timezone blast is a common real
            failure, and requiring a human to press the button — awake, in the room — is the
            cheapest defence there is.
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
