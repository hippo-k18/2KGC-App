'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveBrandingAction, type BrandingState } from './actions';

/** Shared submit button — `useFormStatus` only reports on its own form. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

/**
 * The text-shaped half of App Branding.
 *
 * Colours are `type="text"` rather than `type="color"` on purpose. A native
 * swatch picker says "pick anything"; a hex field beside a note saying the value
 * is only recorded says what is actually happening. The picker would be the
 * prettier lie.
 */
export function AppBrandingForm({
  brandColor,
  accentColor,
  tagline,
  supportEmail,
  hashtag,
}: {
  brandColor: string;
  accentColor: string;
  tagline: string;
  supportEmail: string;
  hashtag: string;
}) {
  const [state, action] = useActionState<BrandingState, FormData>(saveBrandingAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="which" value="app" />
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="brandColor">
          Brand colour
        </label>
        <input
          className="whova-text-input whova-input-sm"
          id="brandColor"
          name="brandColor"
          defaultValue={brandColor}
          placeholder="#2069BC"
          maxLength={7}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
        />
        <p className="whova-form-description">
          The app currently ships <code>#2069BC</code>, sampled from Whova&rsquo;s own header. White
          text on it is 5.51:1, which clears AA — a colour chosen here would need checking the same
          way before it went anywhere near a screen.
        </p>
      </div>

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="accentColor">
          Accent colour
        </label>
        <input
          className="whova-text-input whova-input-sm"
          id="accentColor"
          name="accentColor"
          defaultValue={accentColor}
          placeholder="#24A8E4"
          maxLength={7}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
        />
      </div>

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="tagline">
          Tagline
        </label>
        <input
          className="whova-text-input whova-input-xl"
          id="tagline"
          name="tagline"
          defaultValue={tagline}
          maxLength={80}
          placeholder="The conference for knowledge graph practitioners"
        />
      </div>

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="supportEmail">
          Support address
        </label>
        <input
          className="whova-text-input whova-input-lg"
          id="supportEmail"
          name="supportEmail"
          type="email"
          defaultValue={supportEmail}
          placeholder="help@knowledgegraph.tech"
        />
        <p className="whova-form-description">
          Where an attendee who cannot get into the app is meant to write. Nothing surfaces it yet;
          the confirmation email in <code>@kgc/scripts</code> has its own hard-coded address.
        </p>
      </div>

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="hashtag">
          Event hashtag
        </label>
        <input
          className="whova-text-input whova-input-sm"
          id="hashtag"
          name="hashtag"
          defaultValue={hashtag}
          placeholder="KGC2027"
          maxLength={30}
        />
      </div>

      <SaveButton />
    </form>
  );
}

export function BrandedUrlForm({ brandedSlug }: { brandedSlug: string }) {
  const [state, action] = useActionState<BrandingState, FormData>(saveBrandingAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="which" value="url" />
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="brandedSlug">
          Event address
        </label>
        <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
          <span className="muted" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
            knowledgegraph.tech/
          </span>
          <input
            className="whova-text-input whova-input-sm"
            id="brandedSlug"
            name="brandedSlug"
            defaultValue={brandedSlug}
            placeholder="kgc2027"
            maxLength={40}
            style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
        </div>
        {/*
          Reserving the string is the cheap half and is worth doing early, because
          the address goes on printed material months before anything serves it.
          Serving it is the expensive half and is not built.
        */}
        <p className="whova-form-description">
          Reserving the word costs nothing and settles the argument before it reaches a flyer.
          Making the address resolve is a separate job — see below.
        </p>
      </div>

      <SaveButton />
    </form>
  );
}
