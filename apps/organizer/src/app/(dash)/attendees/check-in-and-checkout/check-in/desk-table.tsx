'use client';

import { useMemo, useState, useTransition } from 'react';
import { checkInByIdAction, undoCheckInAction, type DeskState } from './actions';

/**
 * The attendee table Whova puts on the running check-in screen, with the
 * inline button in the Status column.
 *
 * Why this exists at all: the scanner needs a code off the attendee's phone,
 * and a queue of a thousand people reliably contains someone whose battery is
 * flat. Whova's answer is to let the desk find a person by name and press a
 * button, and it is the right one — without it the fallback is "step aside and
 * wait", which is how a check-in desk turns into a crowd.
 *
 * Filtering is in-memory over the whole list. The list is already here (the
 * server component needs it for the denominator anyway) and 50 rows filter in
 * microseconds, so a round trip per keystroke would be slower and would also
 * make the desk depend on the network between key presses.
 *
 * The optimistic bit is deliberate and narrow: the row flips the moment the
 * action resolves, not the moment it is clicked. At a desk, a row that says
 * "checked in" before the write lands is a row that will lie to you when the
 * write fails, and the person is already walking away.
 */

export interface DeskRow {
  id: string;
  name: string;
  email: string;
  ticketType?: string;
  status: string;
  checkedIn: boolean;
  checkedInAt: string | null;
}

export function DeskTable({ listId, rows }: { listId: string; rows: DeskRow[] }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [state, setState] = useState<Record<string, DeskState>>({});
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'in' && !r.checkedIn) return false;
      if (filter === 'out' && r.checkedIn) return false;
      if (!needle) return true;
      return `${r.name} ${r.email} ${r.ticketType ?? ''}`.toLowerCase().includes(needle);
    });
  }, [rows, q, filter]);

  const run = (id: string, fn: () => Promise<DeskState>) => {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setState((s) => ({ ...s, [id]: res }));
      setBusy(null);
    });
  };

  const chips: [string, typeof filter, number][] = [
    ['All', 'all', rows.length],
    ['Not checked in', 'out', rows.filter((r) => !r.checkedIn).length],
    ['Checked in', 'in', rows.filter((r) => r.checkedIn).length],
  ];

  return (
    <>
      <div className="toolbar">
        <div className="whova-search-input" style={{ flex: '0 1 420px', maxWidth: 420, width: '100%' }}>
          <span className="search-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            className="whova-text-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an attendee by name, email or ticket"
            aria-label="Find an attendee by name, email or ticket"
            autoComplete="off"
          />
        </div>
        {chips.map(([label, key, n]) => (
          <button
            key={key}
            type="button"
            className={`whova-tag-main ${filter === key ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setFilter(key)}
          >
            {label} ({n})
          </button>
        ))}
      </div>

      <div className="whova-table-wrapper">
        <div className="whova-table" role="table">
          <div className="whova-table-head" role="rowgroup">
            <div className="whova-table-row" role="row">
              <div className="whova-table-header cell-fill" role="columnheader">
                Attendee
              </div>
              <div className="whova-table-header cell-sm" role="columnheader">
                Ticket
              </div>
              <div className="whova-table-header cell-mdsm" role="columnheader">
                Checked in
              </div>
              <div className="whova-table-header cell-mdsm cell-end-align" role="columnheader">
                Status
              </div>
            </div>
          </div>
          <div className="whova-table-body" role="rowgroup">
            {shown.length === 0 ? (
              <div className="whova-empty-table">
                <div className="description">No attendee matches that search</div>
              </div>
            ) : (
              shown.map((r) => {
                const s = state[r.id];
                const working = pending && busy === r.id;
                const inactive = r.status !== 'active';
                return (
                  <div
                    className={`whova-table-row${s?.error ? ' row-error' : ''}`}
                    role="row"
                    key={r.id}
                  >
                    <div className="whova-table-cell cell-fill" role="cell">
                      <span>
                        <strong>{r.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.email}
                        </div>
                        {s?.error ? (
                          <div style={{ color: 'var(--danger)', fontSize: 12 }}>{s.error}</div>
                        ) : null}
                      </span>
                    </div>
                    <div className="whova-table-cell cell-sm" role="cell">
                      {inactive ? (
                        <span className="whova-tag-main red-tag outline-tag">{r.status}</span>
                      ) : (
                        (r.ticketType ?? '—')
                      )}
                    </div>
                    <div className="whova-table-cell cell-mdsm" role="cell">
                      {r.checkedInAt ? (
                        <span style={{ fontSize: 13 }}>
                          {r.checkedInAt.slice(11, 16)} on {r.checkedInAt.slice(0, 10)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </div>
                    <div className="whova-table-cell cell-mdsm cell-end-align" role="cell">
                      {inactive ? (
                        <span className="muted" style={{ fontSize: 12 }}>
                          talk to registration
                        </span>
                      ) : r.checkedIn ? (
                        <button
                          type="button"
                          className="btn btn-default btn-sm"
                          disabled={working}
                          onClick={() => run(r.id, () => undoCheckInAction(listId, r.id))}
                        >
                          {working ? '…' : '↺ Undo'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={working}
                          onClick={() => run(r.id, () => checkInByIdAction(listId, r.id))}
                        >
                          {working ? 'Checking in…' : 'Check in'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
