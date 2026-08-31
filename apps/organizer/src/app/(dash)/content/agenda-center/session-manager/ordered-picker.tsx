'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { FieldSet } from '../../../form';

export interface PickerOption {
  value: string;
  label: string;
}

/**
 * An **ordered** list of choices from a fixed set — session speakers, session
 * tracks.
 *
 * ── Why this is not a `<select multiple>` ───────────────────────────────────
 *
 * Because the order is data. `speakerNames` mirrors `speakerIds` positionally
 * and the position is the programme committee's billing order — first author
 * first, not alphabetical — and `agenda/[id].tsx` falls back to
 * `speakerNames[i]` while a speaker document is still loading. `trackIds[0]` is
 * likewise the primary track, and it is the only one whose name and colour are
 * cached onto the session and rendered on the agenda card.
 *
 * A multi-select cannot express any of that. It reports its selection in DOM
 * order rather than in the order the organizer picked, so "Hartmann, then
 * Okonkwo" and "Okonkwo, then Hartmann" submit identically — the control would
 * silently decide who is billed first, and the mistake would surface as a
 * printed programme with the wrong lead author on it. So each choice gets its
 * own row and its own explicit position, and the rows are reorderable.
 *
 * ── How the order survives the round trip ───────────────────────────────────
 *
 * Every row renders a `<select>` carrying the *same* `name`, and
 * `FormData.getAll(name)` returns them in document order. Moving a row moves the
 * `<select>`, so the submitted order is exactly the order on screen. `key` is the
 * row index rather than the chosen id, which is right here for the reason it is
 * usually wrong: the position *is* the identity, and two rows may legitimately
 * hold the same id.
 *
 * Duplicates are allowed rather than blocked. `denormalise.ts` is explicit that
 * a session may bill the same person twice and that it is not the fan-out's
 * business to decide; it is not this control's either.
 */
export function OrderedPicker({
  name,
  legend,
  hint,
  options,
  defaultValue = [],
  addLabel,
  emptyNote,
  firstBadge,
}: {
  /** The form field name. Repeated once per row. */
  name: string;
  legend: string;
  hint?: ReactNode;
  options: PickerOption[];
  defaultValue?: string[];
  addLabel: string;
  /** Shown in place of the rows when nothing is chosen. */
  emptyNote: ReactNode;
  /** Marks row 0 as special — "primary" for tracks. Omitted for speakers. */
  firstBadge?: string;
}) {
  const [rows, setRows] = useState<string[]>(defaultValue);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[from], next[to]] = [next[to], next[from]];
    setRows(next);
  };

  const add = () => {
    // The first option not already chosen, so adding two rows in a row does not
    // produce two identical ones that the organizer then has to notice.
    const unused = options.find((o) => !rows.includes(o.value));
    const pick = unused ?? options[0];
    if (pick) setRows([...rows, pick.value]);
  };

  if (options.length === 0) {
    return (
      <FieldSet legend={legend} hint={hint}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          There are none to choose from yet.
        </p>
      </FieldSet>
    );
  }

  return (
    <FieldSet legend={legend} hint={hint}>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
          {emptyNote}
        </p>
      ) : null}

      {rows.map((value, i) => (
        <div
          key={i}
          style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}
        >
          <span className="muted" style={{ fontSize: 12, minWidth: 62 }}>
            {i === 0 && firstBadge ? firstBadge : `${i + 1}.`}
          </span>
          <select
            name={name}
            className="whova-text-input whova-input-lg"
            value={value}
            aria-label={`${legend} ${i + 1}`}
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value;
              setRows(next);
            }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="whova-btn-main small secondary"
            onClick={() => move(i, i - 1)}
            disabled={i === 0}
            aria-label={`Move up to position ${i}`}
          >
            ↑
          </button>
          <button
            type="button"
            className="whova-btn-main small secondary"
            onClick={() => move(i, i + 1)}
            disabled={i === rows.length - 1}
            aria-label={`Move down to position ${i + 2}`}
          >
            ↓
          </button>
          <button
            type="button"
            className="whova-btn-main small secondary"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}

      <button type="button" className="whova-btn-main small secondary" onClick={add}>
        {addLabel}
      </button>
    </FieldSet>
  );
}
