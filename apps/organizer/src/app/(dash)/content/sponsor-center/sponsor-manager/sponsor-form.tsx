'use client';

import { useActionState } from 'react';
import type { SponsorDoc, SponsorTier, WithId } from '@kgc/shared';
import { ImageField } from '@/components/image-field';
import {
  Field,
  FieldSet,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  Textarea,
  type FormState,
} from '../../../form';
import { saveSponsorAction } from './actions';

/**
 * Create or edit one sponsor.
 *
 * ── Why `tier` leads the form ───────────────────────────────────────────────
 *
 * It is the only field on this screen with a contract behind it. The other
 * twelve describe a company; `tier` records what they paid for, and three
 * separate surfaces read it as a *ranking*: the public sponsor page groups by it
 * and sizes the logo from it, the app's directory sorts by it, and this screen
 * groups by it. Getting it wrong is a commercial error rather than a typo, so it
 * is a constrained select over the same `TIER_ORDER` those surfaces use and it
 * sits where the eye lands first.
 *
 * ── Every control here has a reader ─────────────────────────────────────────
 *
 * Checked field by field before it was added, because a control over a field
 * nothing renders is a lie the organizer only discovers at the conference. What
 * that check excluded is `downloads` — modelled, counted in the list row, and
 * rendered by no surface at all. It has no control, and the gap note on the
 * page says so.
 */
export function SponsorForm({
  existing,
  tiers,
}: {
  existing?: WithId<SponsorDoc>;
  /** `TIER_ORDER` from the server, so the select cannot drift from the sort. */
  tiers: SponsorTier[];
}) {
  const [state, action] = useActionState<FormState, FormData>(saveSponsorAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      <FormGrid>
        <Field
          name="name"
          label="Company"
          required
          defaultValue={existing?.name}
          maxLength={80}
          width="lg"
          error={state.fieldErrors?.name}
          hint={
            existing ? (
              <>
                Id <code>{existing.id}</code> stays the same when you rename them — lead scans and
                the website&rsquo;s logo files both point at it.
              </>
            ) : (
              'The id is made from this name, and it is permanent.'
            )
          }
        />

        <Select
          name="tier"
          label="Tier"
          required
          width="sm"
          defaultValue={existing?.tier ?? ''}
          placeholder="— choose —"
          options={tiers.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
          error={state.fieldErrors?.tier}
          hint="What they bought. Decides logo size on the public sponsor page and position in the app."
        />
      </FormGrid>

      <ImageField
        name="logo"
        label="Logo"
        currentUrl={existing?.logoURL}
        help="PNG, JPEG, WebP or GIF. Large images are shrunk to 1024px in your browser before they are sent, so a file straight out of a brand pack is fine. A wordmark on a transparent background reads best at every tier size."
      />
      {state.fieldErrors?.logo ? (
        <p className="whova-form-error-message" role="alert">
          {state.fieldErrors.logo}
        </p>
      ) : null}

      <FormGrid>
        <Field
          name="website"
          label="Website"
          type="url"
          inputMode="url"
          defaultValue={existing?.website}
          placeholder="https://example.com"
          width="lg"
          error={state.fieldErrors?.website}
          hint="The logo on the public page links here, and the app shows a Visit website button. Left blank, both render without a link rather than a dead one."
        />

        <Field
          name="boothLocation"
          label="Booth"
          defaultValue={existing?.boothLocation}
          placeholder="A12"
          width="sm"
          hint="Printed under their name in the app directory."
        />
      </FormGrid>

      <Textarea
        name="description"
        label="About"
        rows={4}
        defaultValue={existing?.description}
        maxLength={1200}
        hint="Shown on the sponsor's own screen in the app. Not shown on the website, which renders logos only."
      />

      <Textarea
        name="offers"
        label="At the booth"
        rows={4}
        defaultValue={existing?.offers?.join('\n')}
        placeholder={'Live demo at 2pm each day\nFree espresso all conference'}
        error={state.fieldErrors?.offers}
        hint="One per line. The app shows the first two as tags on the directory row and the whole list on the sponsor's screen — so they are phrases, not paragraphs."
      />

      <FieldSet
        legend="Main contact"
        hint="Where sponsorship logistics go. Message Sponsors mails exactly this address, and a sponsor without one cannot be contacted from this dashboard at all — which matters most when you are chasing the logo above."
      >
        <FormGrid>
          <Field name="contactName" label="Name" defaultValue={existing?.contactName} width="lg" />
          <Field
            name="contactEmail"
            label="Email"
            type="email"
            defaultValue={existing?.contactEmail}
            placeholder="partnerships@company.com"
            width="lg"
            error={state.fieldErrors?.contactEmail}
          />
        </FormGrid>
      </FieldSet>

      <FormActions>
        <SubmitButton pendingLabel={existing ? 'Saving…' : 'Adding…'}>
          {existing ? 'Save changes' : 'Add sponsor'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
