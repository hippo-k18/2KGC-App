import { doc } from 'firebase/firestore';

import {
  COLLECTIONS,
  EVENT_ID,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  type LogisticsSettings,
} from '@kgc/shared';

import { useDocument } from '@/lib/data/use-document';
import { getDb } from '@/lib/firebase/client';

/**
 * The emergency card — `settings/logistics`, on a phone.
 *
 * Written weekly by the dashboard's Virtual & Hybrid › Logistics Management ›
 * Emergency Manager and read back by Content › Logistics Center. Until now
 * nobody outside the organizing team could see it, which is the one settings bag
 * where that actually matters: the venue security number and the assembly point
 * exist to be read by somebody standing in the building, and an organizer's
 * screen is not where that person is looking.
 *
 * ── `useDocument`, and never a query ────────────────────────────────────────
 *
 * ⚠️ This was blocked on `firestore.rules`, not on a hook. `settings` had no
 * `match` block at all, so the default-closed posture denied the client SDK and
 * a hook written without the rule would have returned `permission-denied` —
 * which `use-document.ts` reports as an error, but which a screen that treated
 * "no data" as "nothing set" would have rendered as a blank card. The rule now
 * exists and names the key: `allow read: if isRegistered() && key ==
 * 'logistics'`.
 *
 * That predicate is exactly why this is a single-document read. `key` is a path
 * variable, bound on a `get` and unbound across a query, so a `list` of
 * `/settings` is denied outright — deliberately, because `settings/access`
 * holds `eventCode`, a shared string read out from the stage, and `staffNote`,
 * written for the check-in desk. Rules filter documents and not fields, so the
 * only way to hand over one bag and withhold the other is to name it. Do not
 * "improve" this into a collection listener.
 *
 * ⚠️ The rule is in the working tree and **not deployed**. Deploying is
 * `node scripts/ops/deploy-rules.mjs` and it is the owner's to run; the emulator
 * does not enforce the *absence* of a rule any more than it enforces an index,
 * so a local pass proves the rule is right and proves nothing about production.
 */
export interface Logistics extends LogisticsSettings {
  /**
   * Whether the organizer has said the card is fit to show.
   *
   * Inherited from `LogisticsSettings.planReady`, and restated here because it
   * is the whole gate: a half-filled emergency card during an emergency is
   * worse than none, which is why the dashboard refuses to set it with neither
   * an assembly point nor a lead.
   */
  planReady: boolean;
}

export function useLogistics() {
  const { data, error, status, retry } = useDocument<Logistics>(
    () => doc(getDb(), COLLECTIONS.settings, SETTINGS_KEYS.logistics),
    [],
    (_id, d) => merge(d),
  );

  return {
    /**
     * `null` while loading, on error, and when the organizer has not marked the
     * plan ready. The three are told apart by `status` and `planReady` — never
     * by this being null, for the reason `use-document.ts` states at length.
     */
    logistics: data,
    /** The organizer's assertion, readable even when the card is withheld. */
    planReady: data?.planReady === true,
    error,
    status,
    retry,
  };
}

/**
 * Stored values over the shared defaults, dropping anything whose type does not
 * match.
 *
 * The same guard `apps/organizer/src/lib/settings.ts` applies on the way out,
 * and for the same reason rather than out of habit: every save written before
 * the settings contract landed on 2026-08-31 stored `null` for a cleared field,
 * and a raw spread puts `null` where a `string` is declared. The consequence
 * here is not a type error — it is an emergency card whose medical point reads
 * "null".
 *
 * `eventId` is checked before anything is taken. A settings document belonging
 * to a different event is not a partial answer to fall back from; it is somebody
 * else's venue, and showing its assembly point would be worse than showing none.
 */
function merge(d: unknown): Logistics {
  const defaults = SETTINGS_DEFAULTS.logistics;
  const raw = d as { eventId?: unknown; values?: unknown } | undefined;
  if (!raw || raw.eventId !== EVENT_ID) return { ...defaults };

  const stored = raw.values;
  if (!stored || typeof stored !== 'object') return { ...defaults };

  const shape = defaults as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...shape };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!(k in shape)) continue;
    if (typeof v !== typeof shape[k]) continue;
    out[k] = v;
  }
  return out as unknown as Logistics;
}
