'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { BoothRow } from '@/lib/booths';
import type { ExhibitorRow } from '@/lib/exhibitors';
import { addBoothAction, assignBoothAction, type BoothState } from './actions';

function Submit({ label, secondary }: { label: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`whova-btn-main${secondary ? ' secondary' : ''}`}
      disabled={pending}
    >
      {pending ? 'Working…' : label}
    </button>
  );
}

/**
 * Put an exhibitor in a space.
 *
 * Booth and exhibitor are both `<select>`s over what actually exists rather
 * than free text. Typing a booth number is how an exhibitor ends up allocated
 * to "A12 " with a trailing space, and the resulting floor plan is wrong in a
 * way nobody sees until somebody is standing in the wrong aisle.
 *
 * The exhibitor's *name* rides along in a hidden field so the booth document
 * can denormalise it. It could be looked up server-side from the id, and that
 * would be one more read on a path that is already reading the booth inside a
 * transaction — the name is display-only and nothing is decided from it.
 */
export function AssignBoothForm({
  booths,
  exhibitors,
}: {
  booths: BoothRow[];
  exhibitors: ExhibitorRow[];
}) {
  const [state, action] = useActionState<BoothState, FormData>(assignBoothAction, {});

  const assignable = booths.filter((b) => b.status !== 'blocked');

  if (assignable.length === 0 || exhibitors.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        {exhibitors.length === 0
          ? 'No exhibitors exist yet — add one in Exhibitor Manager before allocating space.'
          : 'Every booth on the plan is blocked. Unblock one to allocate it.'}
      </p>
    );
  }

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="boothId">
          Booth
        </label>
        <select id="boothId" name="boothId" required style={{ maxWidth: 320 }}>
          {assignable.map((b) => (
            <option key={b.id} value={b.id}>
              {b.number} · {b.size}
              {b.zone ? ` · ${b.zone}` : ''}
              {b.exhibitorName ? ` — currently ${b.status} to ${b.exhibitorName}` : ' — free'}
            </option>
          ))}
        </select>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="exhibitorId">
          Exhibitor
        </label>
        <select
          id="exhibitorId"
          name="exhibitorId"
          required
          style={{ maxWidth: 320 }}
          onChange={(e) => {
            const hidden = e.currentTarget.form?.elements.namedItem('exhibitorName');
            const label = e.currentTarget.selectedOptions[0]?.dataset.name ?? '';
            if (hidden instanceof HTMLInputElement) hidden.value = label;
          }}
        >
          {exhibitors.map((x) => (
            <option key={x.id} value={x.id} data-name={x.name}>
              {x.name}
              {x.status !== 'confirmed' ? ` (${x.status})` : ''}
            </option>
          ))}
        </select>
        <input type="hidden" name="exhibitorName" defaultValue={exhibitors[0]?.name ?? ''} />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="orderId">
          Order id
        </label>
        <input id="orderId" name="orderId" placeholder="optional" style={{ maxWidth: 320 }} />
        <p className="muted" style={{ fontSize: 12 }}>
          Links the space to the purchase that paid for it. Leave blank for an allocation made by
          hand — the audit entry still records who made it.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="hold">
          Hold only
        </label>
        <label style={{ fontSize: 13 }}>
          <input id="hold" type="checkbox" name="hold" /> Promised, not paid — keeps it off the
          available list without counting it as sold
        </label>
      </div>

      <Submit label="Allocate" />
    </form>
  );
}

/** Add a space to the plan. The number is the id, so re-adding one edits it. */
export function AddBoothForm({ packages }: { packages: { id: string; name: string }[] }) {
  const [state, action] = useActionState<BoothState, FormData>(addBoothAction, {});

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="number">
          Number
        </label>
        <input
          id="number"
          name="number"
          required
          placeholder="A12"
          maxLength={12}
          style={{ maxWidth: 140 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          As printed on the floor plan. It is also the document id, so adding{' '}
          <code>A12</code> twice edits it rather than creating a second one.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="size">
          Size
        </label>
        <input id="size" name="size" required placeholder="3m × 2m" style={{ maxWidth: 220 }} />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="zone">
          Zone
        </label>
        <input id="zone" name="zone" placeholder="Main aisle" style={{ maxWidth: 220 }} />
        <p className="muted" style={{ fontSize: 12 }}>
          Groups a long list into something walkable. Booths sort by zone, then naturally by number
          — A2 before A10, which a plain sort gets backwards.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="ticketTypeId">
          Sold as
        </label>
        <select id="ticketTypeId" name="ticketTypeId" style={{ maxWidth: 320 }}>
          <option value="">— not decided yet —</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <Submit label="Add booth" secondary />
    </form>
  );
}
