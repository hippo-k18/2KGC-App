'use client';

import { useActionState, useState } from 'react';
import { brandPalette, isHexColor, whiteTextPasses } from '@kgc/shared';
import { ImageField } from '@/components/image-field';
import { useFormStatus } from 'react-dom';
import { saveBrandingAction, type BrandingState } from './actions';

/** Shared submit button — `useFormStatus` only reports on its own form. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

/**
 * One colour: a hex box with a native swatch beside it, kept in step.
 *
 * The hex box is the field that posts. The swatch has no `name`, so an empty
 * box still clears the colour instead of posting the picker's default black.
 */
function ColourField({
  name,
  label,
  initial,
  builtIn,
  children,
}: {
  name: string;
  label: string;
  initial: string;
  /** What the surfaces paint with while this is empty. */
  builtIn: string;
  children?: React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const palette = brandPalette(value);

  return (
    <div className="whova-form-group">
      <label className="whova-form-label" htmlFor={name}>
        {label}
      </label>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHexColor(value) ? value : builtIn}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          style={{ height: 40, padding: 2, width: 48 }}
        />
        <input
          className="whova-text-input whova-input-sm"
          id={name}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={builtIn}
          maxLength={7}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
        />
        {palette ? (
          <span
            style={{
              background: palette.brand,
              borderRadius: 4,
              color: palette.onBrand,
              fontSize: 12,
              padding: '6px 10px',
            }}
          >
            Sample text
          </span>
        ) : null}
      </div>
      {value && palette && !whiteTextPasses(value) ? (
        <p className="whova-form-description">
          White text is hard to read on this colour. Dark text is used on it instead.
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** App Branding: colours, tagline, support address, hashtag, logo and banner. */
export function AppBrandingForm({
  brandColor,
  accentColor,
  tagline,
  supportEmail,
  hashtag,
  logoUrl,
  bannerUrl,
  logoIsLink,
  bannerIsLink,
}: {
  brandColor: string;
  accentColor: string;
  tagline: string;
  supportEmail: string;
  hashtag: string;
  logoUrl: string;
  bannerUrl: string;
  /** Whether the saved value was pasted rather than uploaded, so the link box shows it. */
  logoIsLink: boolean;
  bannerIsLink: boolean;
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

      <ColourField name="brandColor" label="Brand colour" initial={brandColor} builtIn="#2069BC">
        <p className="whova-form-description">
          Headers and main buttons on the website and in the app. Leave empty for the built-in
          colours.
        </p>
      </ColourField>

      <ColourField name="accentColor" label="Accent colour" initial={accentColor} builtIn="#17556A">
        <p className="whova-form-description">Links and highlights on the website.</p>
      </ColourField>

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
          Where an attendee who cannot get into the app should write. Shown on the app sign-in
          screen and in the website footer.
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

      <ImageField
        name="logoFile"
        label="Logo"
        currentUrl={logoUrl || undefined}
        help="PNG, JPEG, WebP or GIF. Shown in the website header and on the app sign-in screen. A wide mark on a transparent background works best."
      />
      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="logoUrl">
          Or paste a logo link
        </label>
        <input
          className="whova-text-input whova-input-xl"
          id="logoUrl"
          name="logoUrl"
          type="url"
          defaultValue={logoIsLink ? logoUrl : ''}
          placeholder="https://example.com/logo.png"
        />
      </div>

      <ImageField
        name="bannerFile"
        label="Banner"
        currentUrl={bannerUrl || undefined}
        maxEdge={1600}
        previewSize={160}
        help="A wide picture, about 1600 by 600. Shown behind the website home page heading and at the top of the app Home tab."
      />
      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="bannerUrl">
          Or paste a banner link
        </label>
        <input
          className="whova-text-input whova-input-xl"
          id="bannerUrl"
          name="bannerUrl"
          type="url"
          defaultValue={bannerIsLink ? bannerUrl : ''}
          placeholder="https://example.com/banner.jpg"
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
          The address sends visitors to the front page of the event website.
        </p>
      </div>

      <SaveButton />
    </form>
  );
}
