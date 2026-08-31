'use client';

import { useActionState } from 'react';
import type { TicketTypeRow } from '@/lib/commerce';
import {
  CheckboxField,
  DateTimeField,
  Field,
  FieldSet,
  FormActions,
  FormBanner,
  FormGrid,
  MoneyField,
  Select,
  SubmitButton,
  Textarea,
  wholeUnits,
} from '../../../form';
import { saveTicketTypeAction, type TicketState } from './actions';
import { groupsToText } from './groups';

/**
 * Create or edit one ticket type.
 *
 * ── The price field is the whole screen ─────────────────────────────────────
 *
 * Everything else here is copy; this one number is what a buyer's card is
 * charged. So it takes **whole dollars** — the organizer types `799` — and the
 * action converts to cents. Asking a human to enter minor units is how a ticket
 * ends up at $7.99 or $79,900 depending on who filled the form in, and neither
 * mistake announces itself. `MoneyField` owns that convention and the live
 * preview that makes a slipped decimal visible before saving rather than after
 * selling; the argument for both is in its docblock.
 *
 * ── Built on the shared vocabulary ──────────────────────────────────────────
 *
 * Every control here comes from `(dash)/form.tsx`. Nothing about the form's
 * contract changed in the move — the same sixteen field names, the same action,
 * the same validation — but the markup did: this screen was emitting
 * `.whova-form-row`, a class that matched nothing in `globals.css`, around bare
 * `<input>` elements that `globals.css` deliberately does not style. The money
 * screen was rendering as unstyled browser defaults. It is Whova's form
 * vocabulary now, which is what the rest of the dashboard already looked like.
 *
 * `TicketState` is passed straight to `FormBanner`, which takes a `FormState`:
 * the two are structurally identical and no conversion is needed. What this
 * screen does not yet use is `FormState.fieldErrors` — every control accepts an
 * `error`, but `saveTicketTypeAction` returns one sentence for the whole form,
 * so there is nothing to put under an individual box. Rewriting a money action
 * to prove a component works was not worth the risk; the next editor written
 * against this vocabulary can return them from the start.
 */
export function TicketForm({ existing }: { existing?: TicketTypeRow }) {
  const [state, action] = useActionState<TicketState, FormData>(saveTicketTypeAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      <Field
        name="name"
        label="Ticket name"
        required
        defaultValue={existing?.name}
        placeholder="Main Conference"
        maxLength={60}
        width="lg"
        hint={
          <>
            Printed on the badge and shown on the website.
            {existing && (
              <>
                {' '}
                Id <code>{existing.id}</code> stays the same — orders point at it.
              </>
            )}
          </>
        }
      />

      <MoneyField
        name="price"
        label="Price"
        required
        defaultValue={existing ? wholeUnits(existing.priceCents) : ''}
        currencyName="currency"
        currencyDefault={existing?.currency ?? 'usd'}
      />

      <Field
        name="tagline"
        label="Tagline"
        defaultValue={existing?.tagline}
        placeholder="Wednesday to Friday at Cornell Tech."
        maxLength={120}
        width="lg"
      />

      <Textarea
        name="includes"
        label="What’s included"
        rows={6}
        defaultValue={existing?.includes.join('\n')}
        placeholder={
          'Every main conference session\nCommunity happy hour\nEvening networking events'
        }
        hint={
          <>
            One bullet per line. Shown on the checkout order rail, on the smaller ticket cards, and
            on the ticket panel — <strong>unless</strong> the grouped list below has something in
            it, in which case the panel shows that instead.
          </>
        }
      />

      {/*
        The control that was missing, and the reason the one above was
        misleading.

        The public tickets page renders `groups` when a tier has one and falls
        back to the flat list when it does not, and All Access and Main
        Conference — the two panels a buyer actually reads — both carry a
        `groups` from the seed. So for those two tiers the flat box above
        changed the order rail and the cards and nothing on the panel, silently,
        and it is the only ticket-copy edit anyone is likely to make.

        A textarea rather than a repeater of heading + item rows: the content is
        three headings and a dozen bullets, the format is legible at a glance,
        and it can be pasted in from the copy somebody wrote in a document —
        which is where ticket copy actually comes from.
      */}
      <Textarea
        name="groups"
        label="What’s included, grouped"
        rows={10}
        defaultValue={existing ? groupsToText(existing.groups) : ''}
        placeholder={
          'All In-person Sessions\n' +
          '- Both workshop days, Monday and Tuesday\n' +
          '- Every conference session, Wednesday to Friday\n\n' +
          'All Virtual Sessions\n' +
          '- Live streams of every session\n\n' +
          'KGC Video Library Subscription (3 months)'
        }
        hint={
          <>
            <strong>This is what the two headline panels on the website show.</strong> A line with
            no dash is a heading; a line starting <code>-</code> is a bullet under it. A heading on
            its own is a group with no bullets. Leave it empty to fall back to the flat list above.
          </>
        }
      />

      {/*
        The honest caveat, stated where the number is entered. Overselling by
        one during a rush is a refund and an apology; discovering the limit was
        never enforced at the door is worse.
      */}
      <Field
        name="capacity"
        label="Capacity"
        type="number"
        min={1}
        defaultValue={existing?.quantityTotal ?? ''}
        placeholder="Unlimited"
        width="sm"
        hint={
          <>
            Blank for unlimited. {existing ? `${existing.quantitySold} sold so far. ` : ''}
            This closes the tier when it is reached, but it is{' '}
            <strong>not a hard reservation</strong> — two people can pass the check at the same
            moment and both pay.
          </>
        }
      />

      {/*
        Wall clock in the event's zone, not the server's.

        These were parsed with a bare `new Date()`, which resolves in whatever
        zone the process runs in — right by accident on a laptop in New York,
        and four hours out on a UTC host, where an early-bird deadline typed as
        23:59 closes at 19:59 Eastern. The zone is stated on the field because
        an organizer in London setting a deadline needs to know whose midnight
        it is.
      */}
      <FieldSet
        legend="Sales window"
        hint="Blank means always on sale. Use this for early-bird pricing."
      >
        <FormGrid>
          <DateTimeField
            name="salesOpenAt"
            label="Opens"
            defaultValue={existing?.salesOpenAtLocal ?? ''}
            timeZoneNote={existing?.salesTimeZone ?? 'America/New_York'}
          />
          <DateTimeField
            name="salesCloseAt"
            label="Closes"
            defaultValue={existing?.salesCloseAtLocal ?? ''}
            timeZoneNote={existing?.salesTimeZone ?? 'America/New_York'}
          />
        </FormGrid>
      </FieldSet>

      {/*
        This field had no control at all and the action wrote 'attendee'
        unconditionally, so saving an exhibitor tier silently moved it into the
        attendee catalogue — and onto the public tickets page.
      */}
      <Select
        name="audience"
        label="Catalogue"
        defaultValue={existing?.audience ?? 'attendee'}
        width="sm"
        options={[
          { value: 'attendee', label: 'Attendees' },
          { value: 'exhibitor', label: 'Exhibitors' },
          { value: 'sponsor', label: 'Sponsors' },
        ]}
        hint={
          <>
            ⚠️ Only <strong>attendee</strong> tiers appear on the public website —{' '}
            <code>catalogue.ts</code> filters to them. An exhibitor or sponsor tier is recorded here
            and has nothing selling it yet.
          </>
        }
      />

      <Field
        name="sortOrder"
        label="Sort order"
        type="number"
        defaultValue={existing?.sortOrder ?? 50}
        width="sm"
        hint="Lower numbers come first on the website."
      />

      <FieldSet
        legend="Options"
        hint="A hidden ticket can still be bought by direct link — that is how a comp or speaker rate works without appearing in the catalogue."
      >
        <CheckboxField
          name="visible"
          label="Show on the website"
          defaultChecked={existing ? existing.visible : true}
        />
        {/*
          `inPerson` earns its place on the dashboard rather than the website.

          The audit asked whether this field should exist at all, on the
          grounds that nothing public renders it. It is read by Virtual &
          Hybrid › Setup and by Attendee Customization › Ticket Tiering, both
          of which split the catalogue on it — so unticking it does change
          something, just not on the buyer's side. Saying which screens
          consume it is what stops the next reader concluding it is dead.
        */}
        <CheckboxField
          name="inPerson"
          label="In-person ticket"
          description="Splits the catalogue on Virtual & Hybrid › Setup and Attendee Customization › Ticket Tiering. Nothing on the public site renders it."
          defaultChecked={existing ? existing.inPerson : true}
        />
        <CheckboxField
          name="featured"
          label="Highlight on the tickets page"
          description="Draws the dark, emphasised panel on /tickets/exhibitor and /tickets/sponsor."
          defaultChecked={existing?.featured ?? false}
        />
        {/*
          Entitlements, not decoration. `includesWorkshops` is what
          Attendees › Ticket Session Mapping reads to decide whether this tier
          admits the workshop sessions — and until these controls existed, a
          tier created here could never grant that, because the action defaulted
          both to false and no field could change them.
        */}
        <CheckboxField
          name="includesWorkshops"
          label="Admits the workshop sessions"
          defaultChecked={existing?.includesWorkshops ?? false}
        />
        <CheckboxField
          name="includesVideoLibrary"
          label={
            <>
              Includes the video library
              <span className="muted"> — sold, but nothing serves it yet</span>
            </>
          }
          defaultChecked={existing?.includesVideoLibrary ?? false}
        />
      </FieldSet>

      <FormActions>
        <SubmitButton>{existing ? 'Save changes' : 'Create ticket'}</SubmitButton>
      </FormActions>
    </form>
  );
}
