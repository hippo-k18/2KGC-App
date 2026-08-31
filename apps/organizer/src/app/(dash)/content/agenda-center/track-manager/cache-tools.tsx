'use client';

import { useActionState } from 'react';
import { FormActions, FormBanner, SubmitButton } from '../../../form';
import { reconcileAgendaCachesAction, type ReconcileState } from './actions';

/**
 * The repair tool for the agenda's denormalised caches.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * Every session carries a copy of its speakers' names, its primary track's name
 * and colour, and its room's name, so the agenda list renders without four
 * extra reads per row. The three editors that can change those sources — this
 * screen, Speaker Manager and Logistics Center — each fan their edit out as
 * they save. This is what closes the two cases a fan-out cannot: a batch that
 * failed halfway, and a session whose cached array no longer lines up with its
 * id array, which the fan-out refuses to guess at rather than corrupt the
 * billing order.
 *
 * ── Check before repair, always ─────────────────────────────────────────────
 *
 * "Check" computes the identical work and writes nothing, so the number is
 * visible before anything moves. On healthy data both buttons report zero: the
 * rebuild reproduces exactly what the seed and the importer write, so a freshly
 * imported agenda needs no writes at all. A check that reports drift on data
 * nobody edited is itself the finding — it means a writer and this reconciler
 * disagree, and that is worth reading before pressing Repair.
 */
export function CacheTools() {
  const [state, action] = useActionState<ReconcileState, FormData>(
    reconcileAgendaCachesAction,
    {},
  );

  return (
    <form action={action}>
      <FormBanner state={state} successFallback="Checked." />

      {state.dangling && state.dangling.length > 0 ? (
        <div className="whova-banner warning" role="status">
          <div>
            <strong>
              {state.dangling.length} reference{state.dangling.length === 1 ? '' : 's'} point at a
              document that no longer exists.
            </strong>{' '}
            The cached name is kept rather than blanked — a stale room name still gets somebody to
            roughly the right place, and an empty one gets them nowhere. Each is{' '}
            <code>session → collection/id</code>:
            <ul style={{ fontSize: 12, marginBottom: 0, paddingLeft: 18 }}>
              {state.dangling.slice(0, 12).map((d) => (
                <li key={d}>
                  <code>{d}</code>
                </li>
              ))}
              {state.dangling.length > 12 ? <li>…and {state.dangling.length - 12} more.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      <FormActions style={{ marginTop: 12 }}>
        <SubmitButton name="mode" value="check" variant="secondary" small pendingLabel="Checking…">
          Check for drift
        </SubmitButton>
        <SubmitButton name="mode" value="repair" small pendingLabel="Repairing…">
          Repair
        </SubmitButton>
      </FormActions>
    </form>
  );
}
