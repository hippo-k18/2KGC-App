import 'server-only';

import { COLLECTIONS, EVENT_ID, type SettingsDoc } from '@kgc/shared';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Organizer settings, one document per feature area.
 *
 * A third of the remaining console screens are settings forms — branding, the
 * event website, registration rules, post-event access, code access. They all
 * do the same three things: read a bag of values, render a form, write it back
 * with an audit entry. This is that, once.
 *
 * ── Values are flat and untyped on purpose ──────────────────────────────────
 *
 * Each screen owns its own shape and validates it before calling `saveSettings`.
 * A discriminated union of twelve settings shapes would be a type edited on
 * every screen and therefore permanently slightly wrong, and it would put the
 * validation somewhere other than next to the form that produces the values.
 * `readSettings` is generic so a caller gets its own shape back without a cast
 * at every field.
 */

/** Every settings key in use. A const so a typo is a compile error. */
export const SETTINGS_KEYS = {
  branding: 'branding',
  eventWebsite: 'event-website',
  registration: 'registration',
  access: 'access',
  logistics: 'logistics',
  appAdoption: 'app-adoption',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

/**
 * Read one settings bag, with the caller's defaults filled in.
 *
 * Never throws and never returns null: a settings screen that cannot render
 * because nobody has saved anything yet is a screen nobody can use to save
 * anything. An unreachable database yields the defaults and the error goes to
 * the war-room page.
 */
export async function readSettings<T extends Record<string, unknown>>(
  key: SettingsKey,
  defaults: T,
): Promise<T & { updatedBy?: string; updatedAt?: string }> {
  try {
    const doc = await db().collection(COLLECTIONS.settings).doc(key).get();
    if (!doc.exists) return { ...defaults };

    const data = doc.data() as SettingsDoc;
    if (data.eventId !== EVENT_ID) return { ...defaults };

    let updatedAt: string | undefined;
    try {
      updatedAt = data.updatedAt?.toDate().toISOString();
    } catch {
      updatedAt = undefined;
    }

    // Defaults first, so a key added to a screen after somebody saved does not
    // come back undefined and blank a field that has a sensible default.
    return { ...defaults, ...(data.values as Partial<T>), updatedBy: data.updatedBy, updatedAt };
  } catch (err) {
    recordError(`settings.read:${key}`, err);
    return { ...defaults };
  }
}

/**
 * Write one settings bag and audit the change.
 *
 * Merges rather than replaces, so a screen that renders a subset of a bag
 * cannot silently drop the keys it does not show — which is how a settings page
 * added later wipes the one added first.
 */
export async function saveSettings(
  key: SettingsKey,
  values: Record<string, string | number | boolean | null>,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ref = db().collection(COLLECTIONS.settings).doc(key);
    const before = (await ref.get()).data()?.values ?? {};

    await ref.set(
      {
        eventId: EVENT_ID,
        key,
        values,
        updatedBy: actor,
        updatedAt: new Date(),
        createdAt: (await ref.get()).exists ? undefined : new Date(),
      },
      { merge: true },
    );

    /**
     * Only the keys that actually changed go into the audit entry. A settings
     * form posts every field on every save, so recording the whole bag would
     * make the log a wall of unchanged values with the one real edit buried.
     */
    const changed: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (JSON.stringify((before as Record<string, unknown>)[k] ?? null) === JSON.stringify(v ?? null)) continue;
      changed[k] = v;
      previous[k] = (before as Record<string, unknown>)[k] ?? null;
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
