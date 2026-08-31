'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { trackId as mintTrackId } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getTrack } from '@/lib/data';
import {
  fanOutTrackChange,
  reconcileSessionCaches,
  summariseFanOut,
} from '@/lib/denormalise';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { readCsvUpload, type ProgrammeImportState } from '@/lib/csv-import';
import { commitTrackImport, previewTrackCsv, type TrackImportOutcome } from './import';

/**
 * Create or edit one track, and repair the caches when something goes wrong.
 *
 * ── Why this screen was read-only until now ─────────────────────────────────
 *
 * The gap note this file replaces named the blocker exactly: `SessionDoc`
 * caches `primaryTrackName` and `primaryTrackColor` so the agenda list renders
 * without N extra reads, and until a fan-out existed, renaming a track from
 * here would have left every session displaying the old name and the old
 * colour — on the phone, on the website and in the programme CSV — with nothing
 * to detect it. `lib/denormalise.ts` is that fan-out. It is called below, and
 * what it reports is returned to the screen rather than dropped.
 *
 * ── Only the primary track is cached, and that is worth saying out loud ─────
 *
 * Programme chairs cross-list talks, so a session can sit in several tracks;
 * `trackIds[0]` is the one the agenda card shows. A rename therefore touches
 * fewer sessions than reference the track, and the form says which number is
 * which before the organizer commits — "twelve sessions carry this track, two
 * of them display it" is the honest sentence, and it is the difference between
 * a rename that looks broken and one that is understood.
 */
export interface TrackState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** `summariseFanOut` for the session caches this save rewrote. */
  fanOut?: string;
  /** False when a fan-out batch failed and some sessions are still stale. */
  fanOutOk?: boolean;
}

/** Six-digit hex, the form `primaryTrackColor` takes and the app renders. */
const HEX = /^#[0-9a-fA-F]{6}$/;

export async function saveTrackAction(
  _prev: TrackState,
  formData: FormData,
): Promise<TrackState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const rawColor = String(formData.get('color') ?? '').trim();

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = 'Give the track a name.';
  if (rawColor && !HEX.test(rawColor)) {
    fieldErrors.color = 'A colour is six hex digits after a hash, e.g. #2180b2. Leave it blank for none.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  // Stored lower case so two spellings of the same colour do not read as a
  // change and trigger a pointless fan-out across the agenda.
  const color = rawColor ? rawColor.toLowerCase() : undefined;

  const existing = id ? await getTrack(id) : null;
  if (id && !existing) return { error: 'That track no longer exists.' };

  /**
   * The id is the importer's own slug, minted once.
   *
   * A track created here and later re-imported from the agenda sheet lands on
   * the same document rather than a near-duplicate — that is what
   * `trackId(name)` buys. It is *not* re-derived on a rename: `trackIds` on
   * every session points at this id, and moving the document would silently
   * unfile every talk in the track.
   */
  const docId = id || mintTrackId(name);
  if (!docId) return { error: 'That name produces an empty id. Use some letters or numbers.' };
  if (!id) {
    const clash = await getTrack(docId);
    if (clash) return { error: `“${clash.name}” already uses the id “${docId}”.` };
  }

  try {
    await db()
      .collection(COLLECTIONS.tracks)
      .doc(docId)
      .set(
        {
          eventId: EVENT_ID,
          name,
          // `FieldValue.delete()` rather than `undefined`: with
          // `ignoreUndefinedProperties` the old colour would survive the save
          // that was meant to clear it, and the cached copy on every session
          // would then disagree with the source.
          color: color ?? FieldValue.delete(),
          description: description || FieldValue.delete(),
          ...(existing ? {} : { createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true },
      );
  } catch (err) {
    recordError('track.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the track.' };
  }

  /**
   * After the write, and outside its try/catch — a cache must never be pushed
   * to a value the source does not hold yet, and a fan-out failure is not a
   * failed save.
   */
  let fanOut: string | undefined;
  let fanOutOk = true;
  if (existing && (existing.name !== name || existing.color !== color)) {
    const result = await fanOutTrackChange(db(), docId, { name, color });
    fanOut = summariseFanOut(result);
    fanOutOk = result.ok;
    if (!result.ok) recordError('track.fanOut', new Error(result.errors.join('; ')));
  }

  await appendAudit({
    actor,
    action: existing ? 'track.update' : 'track.create',
    targetPath: `${COLLECTIONS.tracks}/${docId}`,
    targetId: docId,
    before: existing
      ? { name: existing.name, color: existing.color ?? null, description: existing.description ?? null }
      : {},
    after: {
      name,
      color: color ?? null,
      description: description || null,
      ...(fanOut ? { sessionCaches: fanOut } : {}),
    },
  });

  revalidatePath(ROUTES.trackManager);
  if (fanOut) {
    revalidatePath(ROUTES.sessionManager);
    revalidatePath(ROUTES.conflictCheck);
  }

  return {
    ok: true,
    message: existing ? `Saved ${name}.` : `Added ${name} as ${docId}.`,
    fanOut,
    fanOutOk,
  };
}

export interface ReconcileState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Session ids referencing a speaker, track or room document that is gone. */
  dangling?: string[];
  /** True when the run only reported and wrote nothing. */
  dryRun?: boolean;
}

/**
 * Rebuild every cached name on every session from the source documents.
 *
 * ── Why this lives on Track Manager ─────────────────────────────────────────
 *
 * It repairs all four caches — `speakerNames`, `primaryTrackName`,
 * `primaryTrackColor` and `roomName` — so it belongs to no single editor. It is
 * here because this is the screen whose gap note named the hazard, and because
 * the three editors that can now cause it all link to this one place rather
 * than each growing their own repair button.
 *
 * ── Check, then repair ──────────────────────────────────────────────────────
 *
 * Two submits, one action. "Check" is `dryRun`, which computes the identical
 * work and commits nothing, so an organizer can see the blast radius before
 * agreeing to it. On healthy data both report zero: the reconcile reproduces
 * exactly what the seed and the importer write, so a freshly seeded event
 * issues no writes at all — which is also the standing test that the fan-out
 * and the writers still agree.
 */
export async function reconcileAgendaCachesAction(
  _prev: ReconcileState,
  formData: FormData,
): Promise<ReconcileState> {
  const actor = await requireOrganizer();
  const dryRun = String(formData.get('mode') ?? '') !== 'repair';

  try {
    const result = await reconcileSessionCaches(db(), { dryRun });
    const summary = summariseFanOut(result);

    if (!dryRun) {
      await appendAudit({
        actor,
        action: 'agenda.reconcile',
        targetPath: COLLECTIONS.sessions,
        targetId: EVENT_ID,
        before: {},
        after: { summary, dangling: result.dangling.length },
      });
      revalidatePath(ROUTES.trackManager);
      revalidatePath(ROUTES.sessionManager);
      revalidatePath(ROUTES.speakerManager);
      revalidatePath(ROUTES.conflictCheck);
    }

    return {
      ok: result.ok,
      dryRun,
      dangling: result.dangling,
      message: dryRun
        ? `Would rewrite ${result.updated.length} of ${result.scanned} session(s). Nothing was written.`
        : summary,
      error: result.ok ? undefined : summary,
    };
  } catch (err) {
    recordError('agenda.reconcile', err);
    return { error: err instanceof Error ? err.message : 'Could not check the agenda caches.' };
  }
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/** Preview a track CSV. Writes nothing, and fans nothing out. */
export async function previewTrackImportAction(
  _prev: ProgrammeImportState,
  formData: FormData,
): Promise<ProgrammeImportState> {
  await requireOrganizer();

  const csv = await readCsvUpload(formData);
  if (typeof csv !== 'string') return { stage: 'idle', error: csv.error };

  const preview = previewTrackCsv(csv);
  return {
    stage: 'preview',
    csv,
    header: preview.header,
    sample: preview.valid.slice(0, 3),
    validCount: preview.valid.length,
    totalRows: preview.totalRows,
    errors: preview.errors,
  };
}

/**
 * Commit a track import.
 *
 * The message says how many *sessions* were rewritten as well as how many
 * tracks were written, because that is the number an organizer does not expect:
 * one changed cell in a colour column restyles every session on that track, and
 * `import.ts` runs the same `fanOutTrackChange` the form does to make it happen
 * in the same run rather than at the next cache repair.
 */
export async function commitTrackImportAction(
  _prev: ProgrammeImportState,
  formData: FormData,
): Promise<ProgrammeImportState> {
  const actor = await requireOrganizer();

  const csv = String(formData.get('csv') ?? '');
  if (!csv) return { stage: 'idle', error: 'The file was lost between steps. Upload it again.' };

  let outcome: TrackImportOutcome;
  try {
    outcome = await commitTrackImport({
      text: csv,
      actor,
      allowPartial: formData.get('allowPartial') === 'on',
    });
  } catch (err) {
    recordError('track.import', err);
    return { stage: 'preview', csv, error: err instanceof Error ? err.message : 'The import failed.' };
  }

  if (outcome.created === 0 && outcome.updated === 0) {
    return {
      stage: 'preview',
      csv,
      error:
        outcome.errors.length > 0 || outcome.failed.length > 0
          ? 'Nothing was imported — the file still has problems. Fix them, or tick “import the good rows anyway”.'
          : 'Nothing was imported.',
      errors: outcome.errors,
      failed: outcome.failed,
      totalRows: outcome.totalRows,
    };
  }

  revalidatePath(ROUTES.trackManager);
  revalidatePath(ROUTES.sessionManager);
  revalidatePath(ROUTES.conflictCheck);

  return {
    stage: 'done',
    errors: outcome.errors,
    failed: outcome.failed,
    totalRows: outcome.totalRows,
    message:
      `Imported ${outcome.created} new ${outcome.created === 1 ? 'track' : 'tracks'}` +
      (outcome.updated ? `, updated ${outcome.updated} already on the list` : '') +
      (outcome.sessionsRecoloured
        ? `, and rewrote the cached track name or colour on ${outcome.sessionsRecoloured} session${outcome.sessionsRecoloured === 1 ? '' : 's'}`
        : '') +
      '.' +
      // Never swallowed: a half-applied recolour leaves some agenda cards in the
      // old palette and nothing would notice on a later pass.
      (outcome.fanOutFailures.length
        ? ` ⚠️ ${outcome.fanOutFailures.join('; ')}. Run the agenda cache check below.`
        : ''),
  };
}
