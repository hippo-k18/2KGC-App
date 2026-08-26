'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { TicketTypeRow } from '@/lib/commerce';
import { saveTicketTypeAction, type TicketState } from './actions';

/**
 * Create or edit one ticket type.
 *
 * ── The price field is the whole screen ─────────────────────────────────────
 *
 * Everything else here is copy; this one number is what a buyer's card is
 * charged. So it takes **whole dollars** — the organizer types `799` — and the
 * action converts to cents. Asking a human to enter minor units is how a ticket
 * ends up at $7.99 or $79,900 depending on who filled the form in, and neither
 * mistake announces itself.
 *
 * The live preview under the field exists for the same reason: it echoes the
 * parsed figure back in the format the website will print, so a slipped decimal
 * is visible before saving rather than after selling.
 */
export function TicketForm({ existing }: { existing?: TicketTypeRow }) {
  const [state, action] = useActionState<TicketState, FormData>(saveTicketTypeAction, {});

  // Whole units in the input, minor units in the database.
  const [price, setPrice] = useState(existing ? String(existing.priceCents / 100) : '');
  const parsed = Number(price.replace(/[$,\s]/g, ''));
  const previewOk = /^\d+(\.\d{1,2})?$/.test(price.replace(/[$,\s]/g, ''));

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="name">
          Ticket name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={existing?.name}
          placeholder="Main Conference"
          maxLength={60}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Printed on the badge and shown on the website.
          {existing && (
            <>
              {' '}
              Id <code>{existing.id}</code> stays the same — orders point at it.
            </>
          )}
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="price">
          Price
        </label>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <input
            id="price"
            name="price"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="799"
            inputMode="decimal"
            style={{ maxWidth: 140 }}
          />
          <select name="currency" defaultValue={existing?.currency ?? 'usd'} style={{ maxWidth: 90 }}>
            <option value="usd">USD</option>
            <option value="eur">EUR</option>
            <option value="gbp">GBP</option>
          </select>
          <span className="muted" style={{ fontSize: 13 }}>
            {previewOk ? (
              <>
                Buyers are charged{' '}
                <strong>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  }).format(parsed)}
                </strong>
              </>
            ) : (
              'Enter whole dollars, e.g. 799'
            )}
          </span>
        </div>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="tagline">
          Tagline
        </label>
        <input
          id="tagline"
          name="tagline"
          defaultValue={existing?.tagline}
          placeholder="Wednesday to Friday at Cornell Tech."
          maxLength={120}
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="includes">
          What&rsquo;s included
        </label>
        <textarea
          id="includes"
          name="includes"
          rows={6}
          defaultValue={existing?.includes.join('\n')}
          placeholder={'Every main conference session\nCommunity happy hour\nEvening networking events'}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          One bullet per line. These appear on the ticket panel.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="capacity">
          Capacity
        </label>
        <input
          id="capacity"
          name="capacity"
          type="number"
          min={1}
          defaultValue={existing?.quantityTotal ?? ''}
          placeholder="Unlimited"
          style={{ maxWidth: 160 }}
        />
        {/*
          The honest caveat, stated where the number is entered. Overselling by
          one during a rush is a refund and an apology; discovering the limit
          was never enforced at the door is worse.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          Blank for unlimited.{' '}
          {existing ? `${existing.quantitySold} sold so far. ` : ''}
          This closes the tier when it is reached, but it is <strong>not a hard reservation</strong>{' '}
          — two people can pass the check at the same moment and both pay.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="salesOpenAt">
          Sales window
        </label>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <input
            id="salesOpenAt"
            name="salesOpenAt"
            type="datetime-local"
            defaultValue={existing?.salesOpenAt?.slice(0, 16)}
          />
          <span className="muted">to</span>
          <input
            name="salesCloseAt"
            type="datetime-local"
            defaultValue={existing?.salesCloseAt?.slice(0, 16)}
          />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Blank means always on sale. Use this for early-bird pricing.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="audience">
          Catalogue
        </label>
        <select id="audience" name="audience" defaultValue={existing?.audience ?? 'attendee'} style={{ maxWidth: 240 }}>
          <option value="attendee">Attendees</option>
          <option value="exhibitor">Exhibitors</option>
          <option value="sponsor">Sponsors</option>
        </select>
        {/*
          This field had no control and the action wrote 'attendee'
          unconditionally, so saving an exhibitor tier silently moved it into
          the attendee catalogue — and onto the public tickets page.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          ⚠️ Only <strong>attendee</strong> tiers appear on the public website — `catalogue.ts`
          filters to them. An exhibitor or sponsor tier is recorded here and has nothing selling it
          yet.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="sortOrder">
          Sort order
        </label>
        <input
          id="sortOrder"
          name="sortOrder"
          type="number"
          defaultValue={existing?.sortOrder ?? 50}
          style={{ maxWidth: 120 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Lower numbers come first on the website.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label">Options</label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          <input type="checkbox" name="visible" defaultChecked={existing ? existing.visible : true} />{' '}
          Show on the website
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          <input type="checkbox" name="inPerson" defaultChecked={existing ? existing.inPerson : true} />{' '}
          In-person ticket
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          <input type="checkbox" name="featured" defaultChecked={existing?.featured ?? false} />{' '}
          Highlight on the tickets page
        </label>
        {/*
          Entitlements, not decoration. `includesWorkshops` is what
          Attendees › Ticket Session Mapping reads to decide whether this tier
          admits the workshop sessions — and until these controls existed, a
          tier created here could never grant that, because the action defaulted
          both to false and no field could change them.
        */}
        <label style={{ display: 'block', marginBottom: 6 }}>
          <input
            type="checkbox"
            name="includesWorkshops"
            defaultChecked={existing?.includesWorkshops ?? false}
          />{' '}
          Admits the workshop sessions
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            name="includesVideoLibrary"
            defaultChecked={existing?.includesVideoLibrary ?? false}
          />{' '}
          Includes the video library
          <span className="muted"> — sold, but nothing serves it yet</span>
        </label>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          A hidden ticket can still be bought by direct link — that is how a comp or speaker rate
          works without appearing in the catalogue.
        </p>
      </div>

      <SaveButton editing={Boolean(existing)} />
    </form>
  );
}

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Create ticket'}
    </button>
  );
}
