/**
 * Imports a Whova agenda/speaker export into Firestore.
 *
 *   npm run import:whova -- --agenda agenda.csv --speakers speakers.csv --dry-run
 *   npm run import:whova -- --agenda agenda.csv --confirm-live
 *
 * Deliberately header-tolerant. Whova's export column names vary by event
 * configuration and change between releases, and the failure mode of a strict
 * importer is a 3am support ticket at T-2 weeks. Instead it fuzzy-matches
 * headers, prints exactly what it matched, and refuses to write anything until
 * you have seen that mapping — which is what `--dry-run` is for.
 *
 * This is also the generic spreadsheet importer the rest of the project reuses
 * (speakers, sponsors, rooms, booth assignments). Adding a new entity means
 * adding a field map, not writing another script.
 */
import { readFileSync } from 'node:fs';

import { COLLECTIONS, EVENT_ID, TIME_ZONE } from '@kgc/shared';
import { parse } from 'csv-parse/sync';
import { Timestamp } from 'firebase-admin/firestore';

import { commitAll, targetDescription, type PendingWrite } from './lib/firestore.js';
import { roomId, sessionId, speakerId, stableGuid, trackId } from './lib/ids.js';
import { deriveTimes, toWallClock } from './lib/time.js';

/** Candidate header names, most specific first. Matching is case/space-insensitive. */
const AGENDA_FIELDS = {
  title: ['session title', 'title', 'name', 'session name'],
  description: ['description', 'session description', 'abstract', 'summary'],
  startDate: ['start date', 'date', 'session date', 'day'],
  startTime: ['start time', 'from', 'begin time', 'start'],
  endDate: ['end date'],
  endTime: ['end time', 'to', 'finish time', 'end'],
  room: ['room', 'location', 'venue', 'room/location', 'session location'],
  track: ['track', 'tracks', 'category', 'session track', 'topic'],
  speakers: ['speakers', 'speaker', 'presenter', 'presenters', 'speaker names'],
  format: ['type', 'session type', 'format'],
} as const;

const SPEAKER_FIELDS = {
  name: ['name', 'speaker name', 'full name'],
  firstName: ['first name', 'firstname'],
  lastName: ['last name', 'lastname', 'surname'],
  title: ['title', 'job title', 'position'],
  company: ['company', 'affiliation', 'organization', 'organisation'],
  bio: ['bio', 'biography', 'about'],
  photo: ['photo', 'photo url', 'picture', 'headshot'],
  email: ['email', 'email address'],
} as const;

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/** Resolves a field map against the actual headers, reporting what it found. */
function mapHeaders<T extends Record<string, readonly string[]>>(
  headers: string[],
  fields: T,
): { map: Partial<Record<keyof T, string>>; report: string[] } {
  const available = new Map(headers.map((h) => [norm(h), h]));
  const map: Partial<Record<keyof T, string>> = {};
  const report: string[] = [];

  for (const key of Object.keys(fields) as (keyof T)[]) {
    const hit = fields[key].find((c) => available.has(norm(c)));
    if (hit) {
      map[key] = available.get(norm(hit))!;
      report.push(`  ${String(key).padEnd(12)} <- "${map[key]}"`);
    } else {
      report.push(`  ${String(key).padEnd(12)} <- (not found)`);
    }
  }
  return { map, report };
}

const readCsv = (path: string): Record<string, string>[] =>
  parse(readFileSync(path, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, trim: true });

/** Whova puts multiple speakers in one cell; the separator varies. */
const splitList = (v?: string) =>
  (v ?? '').split(/[;,|]|\band\b/i).map((s) => s.trim()).filter(Boolean);

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const agendaPath = arg('agenda');
  const speakersPath = arg('speakers');
  const dryRun = process.argv.includes('--dry-run');
  const live = process.argv.includes('--confirm-live');

  if (!agendaPath && !speakersPath) {
    console.error('Usage: --agenda <file.csv> [--speakers <file.csv>] [--dry-run] [--confirm-live]');
    process.exit(1);
  }
  if (!dryRun && !process.env.FIRESTORE_EMULATOR_HOST && !live) {
    console.error(`Refusing to write to ${targetDescription()} without --confirm-live or --dry-run.`);
    process.exit(1);
  }

  const writes: PendingWrite[] = [];
  const now = () => Timestamp.now();
  const base = () => ({ eventId: EVENT_ID, createdAt: now(), updatedAt: now() });
  const problems: string[] = [];

  // --- speakers first, so sessions can link to them -----------------------
  const speakerIdByName = new Map<string, string>();

  if (speakersPath) {
    const rows = readCsv(speakersPath);
    const { map, report } = mapHeaders(Object.keys(rows[0] ?? {}), SPEAKER_FIELDS);
    console.log(`\nSpeakers — ${rows.length} rows from ${speakersPath}`);
    console.log(report.join('\n'));

    for (const [i, row] of rows.entries()) {
      const name =
        (map.name && row[map.name]) ||
        [map.firstName && row[map.firstName], map.lastName && row[map.lastName]]
          .filter(Boolean).join(' ').trim();
      if (!name) { problems.push(`speakers row ${i + 2}: no name`); continue; }

      const company = map.company ? row[map.company] : undefined;
      const id = speakerId(name, company);
      speakerIdByName.set(norm(name), id);

      writes.push({ collection: COLLECTIONS.speakers, id: id, data: {
          ...base(), name,
          title: map.title ? row[map.title] || undefined : undefined,
          company: company || undefined,
          bio: map.bio ? row[map.bio] || undefined : undefined,
          photoURL: map.photo ? row[map.photo] || undefined : undefined,
          sessionIds: [],
        },
      });
    }
  }

  // --- agenda -------------------------------------------------------------
  if (agendaPath) {
    const rows = readCsv(agendaPath);
    const { map, report } = mapHeaders(Object.keys(rows[0] ?? {}), AGENDA_FIELDS);
    console.log(`\nAgenda — ${rows.length} rows from ${agendaPath}`);
    console.log(report.join('\n'));

    if (!map.title || !map.startDate || !map.startTime) {
      console.error(
        '\nCannot import: title, start date and start time are all required.\n' +
          'Headers seen: ' + Object.keys(rows[0] ?? {}).join(', ') +
          '\nAdd the real header names to AGENDA_FIELDS in this file.',
      );
      process.exit(1);
    }

    const tracksSeen = new Set<string>();
    const roomsSeen = new Set<string>();
    const sessionsBySpeaker = new Map<string, string[]>();

    for (const [i, row] of rows.entries()) {
      const title = row[map.title]?.trim();
      if (!title) { problems.push(`agenda row ${i + 2}: no title`); continue; }

      let times;
      try {
        const startLocal = toWallClock(row[map.startDate], row[map.startTime]);
        // Test the *value*, not just whether the column exists: Whova emits the
        // End Time column with an empty cell for lightning items and anything
        // open-ended, which is the common case, not the rare one. Assume 45
        // minutes rather than dropping the row — an approximate slot is
        // recoverable by a human, a silently missing session is not.
        const endCell = map.endTime ? row[map.endTime]?.trim() : '';
        const endLocal = endCell
          ? toWallClock(row[map.endDate ?? map.startDate] || row[map.startDate], endCell)
          : addMinutes(startLocal, 45);
        times = deriveTimes(startLocal, endLocal, TIME_ZONE);
      } catch (e) {
        problems.push(`agenda row ${i + 2} ("${title}"): ${(e as Error).message}`);
        continue;
      }

      const id = sessionId(title, times.startsAtLocal);
      const room = map.room ? row[map.room]?.trim() : undefined;
      const trackNames = map.track ? splitList(row[map.track]) : [];
      const speakerNames = map.speakers ? splitList(row[map.speakers]) : [];

      if (room) roomsSeen.add(room);
      trackNames.forEach((t) => tracksSeen.add(t));

      const sids = speakerNames.map((n) => {
        const known = speakerIdByName.get(norm(n));
        if (known) return known;
        // A speaker named on the agenda but absent from the speaker export.
        // Create a stub rather than dropping the link — a session with an
        // unlinked speaker name is a worse outcome than a thin speaker record.
        const id = speakerId(n);
        speakerIdByName.set(norm(n), id);
        writes.push({ collection: COLLECTIONS.speakers, id: id, data: { ...base(), name: n, sessionIds: [] },
        });
        problems.push(`speaker "${n}" appears on the agenda but not in the speaker export — stub created`);
        return id;
      });
      sids.forEach((sid) => sessionsBySpeaker.set(sid, [...(sessionsBySpeaker.get(sid) ?? []), id]));

      writes.push({ collection: COLLECTIONS.sessions, id: id, data: {
          ...base(), ...times,
          title,
          description: map.description ? row[map.description] || undefined : undefined,
          format: normaliseFormat(map.format ? row[map.format] : undefined),
          status: 'published',
          roomId: room ? roomId(room) : undefined,
          roomName: room || undefined,
          trackIds: trackNames.map(trackId),
          primaryTrackName: trackNames[0] || undefined,
          speakerIds: sids,
          speakerNames,
          tags: trackNames,
          sequence: 0,
          stableGuid: stableGuid(id),
          qaEnabled: true,
          pollsEnabled: false,
        },
      });
    }

    for (const name of tracksSeen) {
      writes.push({ collection: COLLECTIONS.tracks, id: trackId(name), data: { ...base(), name } });
    }
    for (const name of roomsSeen) {
      writes.push({ collection: COLLECTIONS.rooms, id: roomId(name), data: { ...base(), name } });
    }
    for (const [sid, ids] of sessionsBySpeaker) {
      writes.push({ collection: COLLECTIONS.speakers, id: sid, data: { sessionIds: ids } });
    }

    console.log(`\n  ${tracksSeen.size} tracks, ${roomsSeen.size} rooms discovered`);
  }

  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 25)) console.log(`  ! ${p}`);
    if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more`);
  }

  if (dryRun) {
    console.log(`\nDRY RUN — ${writes.length} documents would be written. Nothing changed.`);
    console.log('Check the header mapping above, then re-run without --dry-run.');
    return;
  }

  const count = await commitAll(writes);
  console.log(`\n${count} documents written to ${targetDescription()}.`);
}

function addMinutes(wallClock: string, minutes: number): string {
  const [date, time] = wallClock.split('T');
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${date}T${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function normaliseFormat(raw?: string): string {
  const v = norm(raw ?? '');
  if (v.includes('keynote')) return 'keynote';
  if (v.includes('workshop') || v.includes('tutorial')) return 'workshop';
  if (v.includes('panel')) return 'panel';
  if (v.includes('poster')) return 'poster';
  if (v.includes('social') || v.includes('reception') || v.includes('break')) return 'social';
  return 'talk';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
