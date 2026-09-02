import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  usable,
  type SettingsKey,
  type SettingsValues,
} from '@kgc/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Organizer settings, one document per feature area.
 *
 * Five screens across three feature areas do the same three things: read a bag
 * of values, render a form, write it back with an audit entry. This is that,
 * once.
 *
 * ── The shapes are not here any more ────────────────────────────────────────
 *
 * `SETTINGS_KEYS`, the value shapes, the defaults and the register of which
 * install reads which field live in `@kgc/shared` (`packages/shared/src/
 * settings.ts`). They were here, flat and untyped, on the argument that each
 * screen owns its own shape — which was true while the writing screen was also
 * the only reader. It stopped being true the moment the website and the app
 * were named as readers: three installs that cannot import each other have to
 * agree on a key name, and the only place that agreement can be enforced by the
 * compiler is the shared package.
 *
 * Re-exported below so the existing `from '@/lib/settings'` imports keep
 * working and there is one obvious import for a screen in this app.
 */
export { SETTINGS_KEYS, SETTINGS_DEFAULTS };
export type { SettingsKey, SettingsValues };

/** What a screen may send: any subset, with `null` meaning "clear this". */
export type SettingsPatch<K extends SettingsKey> = {
  [F in keyof SettingsValues[K]]?: SettingsValues[K][F] | null;
};

/** The read result: a complete bag, plus who last touched the document. */
export type SettingsRead<K extends SettingsKey> = SettingsValues[K] & {
  updatedBy?: string;
  updatedAt?: string;
};

/**
 * Read one settings bag, with the shared defaults filled in.
 *
 * Never throws and never returns null: a settings screen that cannot render
 * because nobody has saved anything yet is a screen nobody can use to save
 * anything. An unreachable database yields the defaults and the error goes to
 * the war-room page.
 *
 * The caller no longer supplies defaults. It used to, and the result was that
 * `app-branding` and `branded-event-url` held different views of the *same*
 * document — two screens disagreeing about what an unset value is. Defaults are
 * now `SETTINGS_DEFAULTS`, which the website and the app will read from the
 * same file.
 */
export async function readSettings<K extends SettingsKey>(key: K): Promise<SettingsRead<K>> {
  const defaults = SETTINGS_DEFAULTS[key];

  try {
    const doc = await db().collection(COLLECTIONS.settings).doc(key).get();
    if (!doc.exists) return { ...defaults };

    const data = doc.data() as { eventId?: string; values?: unknown; updatedBy?: string; updatedAt?: { toDate(): Date } };
    if (data.eventId !== EVENT_ID) return { ...defaults };

    let updatedAt: string | undefined;
    try {
      updatedAt = data.updatedAt?.toDate().toISOString();
    } catch {
      updatedAt = undefined;
    }

    return { ...defaults, ...usable(defaults, data.values), updatedBy: data.updatedBy, updatedAt };
  } catch (err) {
    recordError(`settings.read:${key}`, err);
    return { ...defaults };
  }
}

/*
 * `usable()` was declared here and, identically, in `apps/web/src/lib/data.ts`,
 * both guarding the same defect — a `null` written by an older save spreading
 * over a default and turning `''` into the string "null" on a page — and both
 * justified by the claim that the two apps cannot import each other. They can:
 * both depend on `@kgc/shared`, which is where it lives now.
 */

/**
 * Write part of one settings bag and audit the change.
 *
 * ── Why every key is named on every write ───────────────────────────────────
 *
 * `values` is a nested map and the write is a merge, so Firestore merges it key
 * by key. Sending only the fields one screen renders therefore *looks* right
 * and is right — until you want to remove one. AGENTS.md gotcha 9: under a
 * merge an absent key leaves the old value in place and the action still
 * returns "Saved", so an organizer who deletes a wrong support address is told
 * it saved and still has the wrong support address.
 *
 * So a `null` in the patch means "clear this", and it is written as
 * `FieldValue.delete()` — verified against the emulator to work inside a nested
 * map under `{ merge: true }`, which is not obvious and is why it is stated
 * here. `lib/campaigns.ts` `saveLink()` is the same pattern at the top level.
 *
 * Cleared fields are **removed**, not stored as `null`. That is what lets a
 * reader fall back to `SETTINGS_DEFAULTS` instead of having to know that `null`
 * means "unset" — a rule the app and the website would each have to learn
 * separately, and one of them would not.
 *
 * The rest of the merged bag is sent alongside, so a bag written by three
 * screens survives a save from any one of them even where the merge is shallow
 * (the demo store's is).
 */
export async function saveSettings<K extends SettingsKey>(
  key: K,
  patch: SettingsPatch<K>,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ref = db().collection(COLLECTIONS.settings).doc(key);
    const snap = await ref.get();
    const before = usable(SETTINGS_DEFAULTS[key], snap.data()?.values) as Record<string, unknown>;

    const next: Record<string, unknown> = { ...before };
    const cleared: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) {
        delete next[k];
        cleared.push(k);
      } else {
        next[k] = v;
      }
    }

    const values: Record<string, unknown> = { ...next };
    for (const k of cleared) values[k] = FieldValue.delete();

    await ref.set(
      {
        eventId: EVENT_ID,
        key,
        values,
        updatedBy: actor,
        updatedAt: new Date(),
        ...(snap.exists ? {} : { createdAt: new Date() }),
      },
      { merge: true },
    );

    /**
     * Only the keys that actually changed go into the audit entry. A settings
     * form posts every field on every save, so recording the whole bag would
     * make the log a wall of unchanged values with the one real edit buried.
     *
     * A cleared field is recorded as `null` rather than as the sentinel, which
     * is not JSON and would land in the audit log as `{}`.
     */
    const changed: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) {
      const after = cleared.includes(k) ? null : (next[k] ?? null);
      const was = before[k] ?? null;
      if (JSON.stringify(was) === JSON.stringify(after)) continue;
      changed[k] = after;
      previous[k] = was;
    }

    if (Object.keys(changed).length > 0) {
      await appendAudit({
        actor,
        action: 'settings.update',
        targetPath: `${COLLECTIONS.settings}/${key}`,
        targetId: key,
        before: previous,
        after: changed,
      });
    }

    return { ok: true };
  } catch (err) {
    recordError(`settings.save:${key}`, err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save.' };
  }
}
