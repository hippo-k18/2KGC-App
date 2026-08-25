'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ExhibitorRow } from '@/lib/exhibitors';
import { saveExhibitorAction, type ExhibitorState } from './actions';

/**
 * Create or edit one exhibitor.
 *
 * `status` leads the form rather than sitting at the bottom, because it is the
 * field that decides everything else: a provisional exhibitor has not paid and
 * should not be printed on a floor plan, and confirming one is the actual
 * decision being recorded here.
 */
export function ExhibitorForm({ existing }: { existing?: ExhibitorRow }) {
  const [state, action] = useActionState<ExhibitorState, FormData>(saveExhibitorAction, {});

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
          Company
        </label>
        <input id="name" name="name" required defaultValue={existing?.name} maxLength={80} />
        {existing && (
          <p className="muted" style={{ fontSize: 12 }}>
            Id <code>{existing.id}</code> stays the same — passes and lead scans point at it.
          </p>
        )}
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={existing?.status ?? 'provisional'} style={{ maxWidth: 200 }}>
          <option value="provisional">Provisional — not paid yet</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <p className="muted" style={{ fontSize: 12 }}>
          Only confirmed exhibitors belong on a printed floor plan.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="boothNumber">
          Booth
        </label>
        <input
          id="boothNumber"
          name="boothNumber"
          defaultValue={existing?.boothNumber}
          placeholder="E12"
          style={{ maxWidth: 160 }}
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="passesAllocated">
          Staff passes
        </label>
        <input
          id="passesAllocated"
          name="passesAllocated"
          type="number"
          min={0}
          defaultValue={existing?.passesAllocated ?? ''}
          placeholder="Not specified"
          style={{ maxWidth: 160 }}
        />
        {/*
          The number that causes an argument on the morning of day one, when
          somebody from a booth arrives expecting a badge that was never in the
          package. Having it written down before that is the whole point.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          What the package includes. {existing ? `${existing.passesUsed} claimed so far. ` : ''}
          Blank means the contract does not say — which is worth chasing before doors open.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="contactName">
          Main contact
        </label>
        <input id="contactName" name="contactName" defaultValue={existing?.contactName} />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="contactEmail">
          Contact email
        </label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          defaultValue={existing?.contactEmail}
          placeholder="events@company.com"
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Where booth logistics and setup times go. Without it this exhibitor cannot be messaged.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="website">
          Website
        </label>
        <input id="website" name="website" defaultValue={existing?.website} placeholder="https://" />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="description">
          Description
        </label>
        <textarea id="description" name="description" rows={4} defaultValue={existing?.description} />
        <p className="muted" style={{ fontSize: 12 }}>
          Shown in the app&rsquo;s exhibitor list, once that list exists.
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
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Add exhibitor'}
    </button>
  );
}
