'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveLinkAction, type LinkState } from './link-actions';

/**
 * Create a tracked link.
 *
 * Rendered by three screens with different fields shown, because a campaign
 * link, a referral link and a social link are one document with a different
 * reason for existing. `owner` is what separates Referral Contest from Campaign
 * Link Tracking; `channel` is what separates Social Sharing from both.
 *
 * ── The destination is a path, and the form says so loudly ──────────────────
 *
 * ⚠️ An absolute URL would make `/r/{code}` an open redirect on the
 * conference's own domain — a link that genuinely starts at
 * `knowledgegraph.tech` and ends anywhere. It is refused server-side and again
 * in the redirect route; the note here is so nobody wastes time trying.
 */
export function LinkForm({
  destinations,
  showOwner,
  showChannel,
  ownerLabel = 'Credit to',
  ownerPlaceholder = 'Ada Lovelace',
  codePlaceholder = 'spring-mail',
}: {
  /** Paths on the marketing site worth linking to. */
  destinations: { path: string; label: string }[];
  showOwner?: boolean;
  showChannel?: boolean;
  ownerLabel?: string;
  ownerPlaceholder?: string;
  codePlaceholder?: string;
}) {
  const [state, action] = useActionState<LinkState, FormData>(saveLinkAction, {});

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="code">
          Code
        </label>
        <input
          id="code"
          name="code"
          required
          maxLength={48}
          placeholder={codePlaceholder}
          pattern="[a-zA-Z0-9\-]{2,48}"
          className="whova-text-input"
          style={{ maxWidth: 240 }}
        />
        <p className="whova-form-description">
          Appears in the public URL as <code>/r/your-code</code>. Using an existing code edits
          that link and keeps its clicks.
        </p>
      </div>

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="label">
          Label
        </label>
        <input
          id="label"
          name="label"
          required
          maxLength={80}
          placeholder="February announcement email"
          className="whova-text-input"
          style={{ maxWidth: 340 }}
        />
        <p className="whova-form-description">
          Only you see this.
        </p>
      </div>

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="destination">
          Goes to
        </label>
        <select
          id="destination"
          name="destination"
          className="whova-text-input"
          style={{ maxWidth: 340 }}
        >
          {destinations.map((d) => (
            <option key={d.path} value={d.path}>
              {d.label} · {d.path}
            </option>
          ))}
        </select>
        <p className="whova-form-description">
          Links can only go to a page on the conference site.
        </p>
      </div>

      {showOwner && (
        <div className="whova-form-group">
          <label className="whova-form-label" htmlFor="owner">
            {ownerLabel}
          </label>
          <input
            id="owner"
            name="owner"
            maxLength={80}
            placeholder={ownerPlaceholder}
            className="whova-text-input"
            style={{ maxWidth: 300 }}
          />
          <p className="whova-form-description">
            Who gets the credit on the leaderboard. They do not need an account.
          </p>
        </div>
      )}

      {showChannel && (
        <div className="whova-form-group">
          <label className="whova-form-label" htmlFor="channel">
            Channel
          </label>
          <select
            id="channel"
            name="channel"
            className="whova-text-input"
            style={{ maxWidth: 240 }}
          >
            <option value="linkedin">LinkedIn</option>
            <option value="bluesky">Bluesky</option>
            <option value="mastodon">Mastodon</option>
            <option value="x">X</option>
            <option value="email">Email signature</option>
            <option value="slack">Slack or Discord</option>
            <option value="partner">Partner site</option>
            <option value="print">Print or QR</option>
          </select>
        </div>
      )}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : 'Create link'}
    </button>
  );
}
