/**
 * Tests for the agenda importer's pure half.
 *
 * `import.ts` cannot be loaded here — it is `server-only` and holds a Firestore
 * handle — so everything that can be wrong quietly lives in `import-core.ts`,
 * exactly as `session-core.ts` does for the editor.
 *
 * Two properties are the reason this file exists, and both have already caused
 * real bugs in this repo:
 *
 *  1. **The timezone derivation.** `startsAt`, `endsAt` and `day` are derived
 *     from the sheet's local wall clock plus the event's zone, and never taken
 *     from the file. KGC's Monday reception starts at 21:00 in New York, which
 *     is 01:00 UTC on Tuesday. Anything that derived `day` from the instant, or
 *     in the machine's own zone, files it under the wrong tab — and the bug is
 *     invisible to anyone testing in Eastern time during business hours, which
 *     is why it is pinned with an explicit UTC assertion and with one date in
 *     each half of the year.
 *
 *  2. **`speakerNames` mirrors `speakerIds` positionally.** The index is the
 *     programme committee's billing order. A sort, a dedupe or a `filter` on
 *     this path does not lose a name — it moves every later name onto the wrong
 *     person, and the symptom is a printed programme crediting the wrong lead
 *     author.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import { TIME_ZONE } from '@kgc/shared';
import {
  planSessionImport,
  splitCell,
  type SessionCatalog,
  type SessionCsvRow,
} from '../../apps/organizer/src/app/(dash)/content/agenda-center/session-manager/import-core';
import {
  guessMapping,
  SESSION_FIELDS,
  SPEAKER_FIELDS,
  TRACK_FIELDS,
} from '../../apps/organizer/src/lib/csv-import';

const CATALOG: SessionCatalog = {
  rooms: [
    { id: 'bloomberg-165', name: 'Bloomberg 165' },
    { id: 'the-atrium', name: 'The Atrium' },
  ],
  tracks: [
    { id: 'graph-ml', name: 'Graph ML', color: '#2180b2' },
    { id: 'industry', name: 'Industry', color: '#c0392b' },
    { id: 'unpainted', name: 'Unpainted' },
  ],
  speakers: [
    { id: 'sp-hartmann', name: 'Elke Hartmann', sessionIds: [] },
    { id: 'sp-okonkwo', name: 'Ada Okonkwo', sessionIds: ['old-session'] },
    { id: 'sp-vance', name: 'Jae Vance', sessionIds: [] },
  ],
  sessions: [],
};

/** Only the columns a case cares about; the rest default to blank cells. */
function row(over: Partial<SessionCsvRow> = {}): SessionCsvRow {
  return {
    title: 'Knowledge graphs at scale',
    day: '2027-05-04',
    startTime: '09:00',
    endTime: '10:00',
    endDate: '',
    room: '',
    track: '',
    speakers: '',
    format: '',
    status: '',
    skillLevel: '',
    capacity: '',
    description: '',
    ...over,
  };
}

function planOne(over: Partial<SessionCsvRow> = {}, catalog: SessionCatalog = CATALOG) {
  return planSessionImport([row(over)], catalog, TIME_ZONE);
}

// ---------------------------------------------------------------------------

describe('times are derived, never taken from the sheet', () => {
  it('turns a date column and a time column into a wall clock', () => {
    const { planned } = planOne();
    expect(planned[0].fields.startsAtLocal).toBe('2027-05-04T09:00');
    expect(planned[0].fields.endsAtLocal).toBe('2027-05-04T10:00');
    expect(planned[0].fields.timeZone).toBe(TIME_ZONE);
  });

  it('files a 21:00 reception under its LOCAL day, not the UTC one', () => {
    const { planned, failed } = planOne({
      title: 'Welcome reception',
      startTime: '21:00',
      endTime: '23:30',
    });
    expect(failed).toEqual([]);

    // 21:00 in New York on 4 May is 01:00 UTC on 5 May. The instant crosses
    // midnight; the day tab must not.
    expect(planned[0].fields.startsAt.toISOString()).toBe('2027-05-05T01:00:00.000Z');
    expect(planned[0].fields.day).toBe('2027-05-04');
  });

  it('uses the zone rather than a fixed offset — the same clock in January', () => {
    // EST is UTC-5, EDT is UTC-4. A hard-coded offset passes one of these two.
    const { planned } = planOne({ day: '2027-01-15', startTime: '21:00', endTime: '23:30' });
    expect(planned[0].fields.startsAt.toISOString()).toBe('2027-01-16T02:00:00.000Z');
    expect(planned[0].fields.day).toBe('2027-01-15');
  });

  it('accepts the spellings a spreadsheet emits', () => {
    const { planned } = planOne({ day: '05/04/2027', startTime: '9:00 AM', endTime: '10:30 AM' });
    expect(planned[0].fields.startsAtLocal).toBe('2027-05-04T09:00');
    expect(planned[0].fields.endsAtLocal).toBe('2027-05-04T10:30');
  });

  it('assumes a length when the End cell is empty rather than dropping the row', () => {
    const { planned, failed } = planOne({ endTime: '' });
    expect(failed).toEqual([]);
    expect(planned[0].fields.endsAtLocal).toBe('2027-05-04T09:45');
  });

  it('rolls the calendar date when an assumed end crosses midnight', () => {
    const { planned } = planOne({ startTime: '23:30', endTime: '' });
    expect(planned[0].fields.endsAtLocal).toBe('2027-05-05T00:15');
    // The day key still belongs to the evening the session started in.
    expect(planned[0].fields.day).toBe('2027-05-04');
  });

  it('honours an explicit end date for a session running past midnight', () => {
    const { planned, failed } = planOne({
      startTime: '23:00',
      endTime: '00:30',
      endDate: '2027-05-05',
    });
    expect(failed).toEqual([]);
    expect(planned[0].fields.endsAtLocal).toBe('2027-05-05T00:30');
  });

  it('refuses a row that ends before it starts, and says so on that line', () => {
    const { planned, failed } = planOne({ startTime: '10:00', endTime: '09:00' });
    expect(planned).toEqual([]);
    expect(failed[0].line).toBe(2);
    expect(failed[0].message).toMatch(/ends at or before it starts/);
  });

  it('refuses an unreadable date on its own line and keeps going', () => {
    const { planned, failed } = planSessionImport(
      [row({ day: 'next Tuesday' }), row({ title: 'A good one' })],
      CATALOG,
      TIME_ZONE,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].line).toBe(2);
    expect(planned).toHaveLength(1);
    expect(planned[0].line).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('speakerNames mirrors speakerIds positionally', () => {
  it('keeps the sheet order — it is billing order, not a set', () => {
    const { planned } = planOne({ speakers: 'Jae Vance; Ada Okonkwo; Elke Hartmann' });
    expect(planned[0].fields.speakerIds).toEqual(['sp-vance', 'sp-okonkwo', 'sp-hartmann']);
    expect(planned[0].fields.speakerNames).toEqual(['Jae Vance', 'Ada Okonkwo', 'Elke Hartmann']);
  });

  it('does not sort, and the two arrays stay index-aligned', () => {
    const { planned } = planOne({ speakers: 'Jae Vance; Ada Okonkwo' });
    const { speakerIds, speakerNames } = planned[0].fields;
    expect(speakerNames).not.toEqual([...speakerNames!].sort());
    expect(speakerIds).toHaveLength(speakerNames!.length);
    speakerIds!.forEach((id, i) => {
      expect(CATALOG.speakers.find((s) => s.id === id)!.name).toBe(speakerNames![i]);
    });
  });

  it('does not dedupe — a session may bill the same person twice', () => {
    const { planned } = planOne({ speakers: 'Ada Okonkwo; Jae Vance; Ada Okonkwo' });
    expect(planned[0].fields.speakerIds).toEqual(['sp-okonkwo', 'sp-vance', 'sp-okonkwo']);
    expect(planned[0].fields.speakerNames).toEqual(['Ada Okonkwo', 'Jae Vance', 'Ada Okonkwo']);
  });

  it("caches the speaker record's spelling, not the sheet's", () => {
    // A rename fans out by rewriting the entry whose id matches; a cache holding
    // the sheet's spelling would never be corrected by it.
    const { planned } = planOne({ speakers: 'ada  okonkwo' });
    expect(planned[0].fields.speakerNames).toEqual(['Ada Okonkwo']);
  });

  it('refuses the whole row when one name is unknown, rather than shifting the rest', () => {
    const { planned, failed } = planOne({ speakers: 'Ada Okonkwo; Nobody At All; Jae Vance' });
    expect(planned).toEqual([]);
    expect(failed[0].message).toMatch(/No speaker called “Nobody At All”/);
  });

  it('refuses a name two speaker records share', () => {
    const catalog: SessionCatalog = {
      ...CATALOG,
      speakers: [
        { id: 'a', name: 'Ada Okonkwo', sessionIds: [] },
        { id: 'b', name: 'Ada Okonkwo', sessionIds: [] },
      ],
    };
    const { planned, failed } = planOne({ speakers: 'Ada Okonkwo' }, catalog);
    expect(planned).toEqual([]);
    expect(failed[0].message).toMatch(/cannot tell them apart/);
  });

  it('leaves both arrays alone when the column is blank', () => {
    // A blank cell means "not filled in", never "remove the speakers".
    const { planned } = planOne({ speakers: '' });
    expect(planned[0].fields.speakerIds).toBeUndefined();
    expect(planned[0].fields.speakerNames).toBeUndefined();
  });

  it('carries the previous speakerIds so the inverse index can be diffed', () => {
    // The id is derived from title and start time, so ask the planner for it
    // rather than pinning the hash — this test is about the diff, not the id.
    const catalog: SessionCatalog = {
      ...CATALOG,
      sessions: [
        {
          id: planOne().planned[0].docId,
          title: 'Knowledge graphs at scale',
          startsAtLocal: '2027-05-04T09:00',
          speakerIds: ['sp-okonkwo'],
        },
      ],
    };
    const { planned } = planOne({ speakers: 'Jae Vance' }, catalog);
    expect(planned[0].exists).toBe(true);
    // `speakerIndexDelta` reads this to work out that Ada loses the session and
    // Jae gains it. Without it, a re-import leaves a speaker's own page showing
    // a session they are no longer on.
    expect(planned[0].speakerIdsBefore).toEqual(['sp-okonkwo']);
    expect(planned[0].fields.speakerIds).toEqual(['sp-vance']);
  });
});

// ---------------------------------------------------------------------------

describe('a multi-value cell', () => {
  it('splits on semicolons, which is what the export writes', () => {
    expect(splitCell('Graph ML; Industry')).toEqual(['Graph ML', 'Industry']);
  });

  it('splits on pipes and newlines too', () => {
    expect(splitCell('Graph ML | Industry')).toEqual(['Graph ML', 'Industry']);
    expect(splitCell('Graph ML\nIndustry')).toEqual(['Graph ML', 'Industry']);
  });

  it('does NOT split on a comma — "Okonkwo, Ada" is one person', () => {
    expect(splitCell('Okonkwo, Ada')).toEqual(['Okonkwo, Ada']);
  });

  it('drops empty parts left by a trailing separator', () => {
    expect(splitCell('Graph ML; ; ')).toEqual(['Graph ML']);
  });
});

// ---------------------------------------------------------------------------

describe('the primary-track caches mirror trackIds[0]', () => {
  it('caches the first track and nothing about the others', () => {
    const { planned } = planOne({ track: 'Industry; Graph ML' });
    expect(planned[0].fields.trackIds).toEqual(['industry', 'graph-ml']);
    expect(planned[0].fields.primaryTrackName).toBe('Industry');
    expect(planned[0].fields.primaryTrackColor).toBe('#c0392b');
  });

  it('asks for the cached colour to be removed when the primary track has none', () => {
    // Absence versus ignorance: the track document is authoritative including
    // in what it omits, so a stale colour from a previous track must not stay.
    const { planned } = planOne({ track: 'Unpainted' });
    expect(planned[0].fields.primaryTrackColor).toBeUndefined();
    expect(planned[0].fields.clearPrimaryTrackColor).toBe(true);
  });

  it('does not ask for a deletion when the row named no track at all', () => {
    const { planned } = planOne({ track: '' });
    expect(planned[0].fields.trackIds).toBeUndefined();
    expect(planned[0].fields.clearPrimaryTrackColor).toBe(false);
  });

  it('refuses an unknown track and names the import that fixes it', () => {
    const { planned, failed } = planOne({ track: 'Quantum' });
    expect(planned).toEqual([]);
    expect(failed[0].message).toMatch(/Import the track list first/);
  });
});

// ---------------------------------------------------------------------------

describe('rooms', () => {
  it('caches roomName beside roomId', () => {
    const { planned } = planOne({ room: 'bloomberg 165' });
    expect(planned[0].fields.roomId).toBe('bloomberg-165');
    expect(planned[0].fields.roomName).toBe('Bloomberg 165');
  });

  it('refuses an unknown room rather than writing a name with no id', () => {
    const { planned, failed } = planOne({ room: 'Room 5' });
    expect(planned).toEqual([]);
    expect(failed[0].message).toMatch(/No room called “Room 5”/);
  });
});

// ---------------------------------------------------------------------------

describe('what an import may and may not change', () => {
  it('creates a session as a draft when the sheet says nothing', () => {
    const { planned } = planOne();
    expect(planned[0].exists).toBe(false);
    expect(planned[0].fields.status).toBe('draft');
  });

  it('leaves an existing session’s status alone when the cell is blank', () => {
    const first = planOne().planned[0];
    const catalog: SessionCatalog = {
      ...CATALOG,
      sessions: [
        {
          id: first.docId,
          title: 'Knowledge graphs at scale',
          startsAtLocal: '2027-05-04T09:00',
          speakerIds: [],
        },
      ],
    };
    const { planned } = planOne({}, catalog);
    expect(planned[0].exists).toBe(true);
    expect(planned[0].fields.status).toBeUndefined();
  });

  it('honours an explicit status and refuses one outside the union', () => {
    expect(planOne({ status: 'published' }).planned[0].fields.status).toBe('published');
    expect(planOne({ status: 'live' }).failed[0].message).toMatch(/is not a status/);
  });

  it('maps the format words a programme sheet actually uses', () => {
    expect(planOne({ format: 'Lightning Talk' }).planned[0].fields.format).toBe('talk');
    expect(planOne({ format: 'Panel Discussion' }).planned[0].fields.format).toBe('panel');
    expect(planOne({ format: 'Reception' }).planned[0].fields.format).toBe('social');
    // Unrecognised is a talk, not an error — the vocabulary is ours, not theirs.
    expect(planOne({ format: 'Fireside chat' }).planned[0].fields.format).toBe('talk');
    expect(planOne({ format: '' }).planned[0].fields.format).toBeUndefined();
  });

  it('refuses two rows that would land on the same document', () => {
    const { planned, failed } = planSessionImport([row(), row()], CATALOG, TIME_ZONE);
    expect(planned).toHaveLength(1);
    expect(failed[0].line).toBe(3);
    expect(failed[0].message).toMatch(/same session as line 2/);
  });

  it('refuses a reschedule rather than creating a twin nothing can remove', () => {
    const catalog: SessionCatalog = {
      ...CATALOG,
      sessions: [
        {
          id: 'some-other-id',
          title: 'Knowledge graphs at scale',
          startsAtLocal: '2027-05-04T09:00',
          speakerIds: [],
        },
      ],
    };
    const { planned, failed } = planOne({ startTime: '09:30' }, catalog);
    expect(planned).toEqual([]);
    expect(failed[0].message).toMatch(/Move the existing session in Session Manager/);
  });

  it('updates in place when the same sheet is imported twice', () => {
    const first = planOne().planned[0];
    const catalog: SessionCatalog = {
      ...CATALOG,
      sessions: [
        {
          id: first.docId,
          title: 'Knowledge graphs at scale',
          startsAtLocal: '2027-05-04T09:00',
          speakerIds: [],
        },
      ],
    };
    const second = planOne({}, catalog).planned[0];
    expect(second.docId).toBe(first.docId);
    expect(second.exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the field specs match what this project exports', () => {
  it('maps every column of the programme export', () => {
    // `lib/exports.ts` emits exactly this header. "Export it, fix it in Excel,
    // import it again" is the workflow the connection guides describe, and it
    // only works while these two agree.
    const header = ['Day', 'Start', 'End', 'Title', 'Room', 'Track', 'Speakers', 'Format', 'Status'];
    const map = guessMapping(header, SESSION_FIELDS);
    expect(map).toMatchObject({
      day: 0,
      startTime: 1,
      endTime: 2,
      title: 3,
      room: 4,
      track: 5,
      speakers: 6,
      format: 7,
      status: 8,
    });
  });

  it("maps the speaker export's real columns and ignores its derived ones", () => {
    const header = ['Name', 'Title', 'Company', 'Sessions', 'Session count', 'Has bio', 'Has photo'];
    const map = guessMapping(header, SPEAKER_FIELDS);
    expect(map).toMatchObject({ name: 0, title: 1, company: 2 });
    // A spreadsheet must not be able to assert that a speaker has a bio, and
    // the session link has exactly one writer — the session importer.
    expect(map.bio).toBeNull();
    expect(map.photoURL).toBeNull();
  });

  it('reads Whova and hand-made spellings for a track sheet', () => {
    const map = guessMapping(['Category', 'Hex colour', 'About'], TRACK_FIELDS);
    expect(map).toMatchObject({ name: 0, color: 1, description: 2 });
  });

  it('rejects a colour that is not six hex digits', () => {
    const color = TRACK_FIELDS.find((f) => f.key === 'color')!;
    expect(color.validate!('#2180b2')).toBeUndefined();
    expect(color.validate!('2180b2')).toBeUndefined();
    expect(color.validate!('blue')).toMatch(/six-digit hex/);
  });

  it('rejects a javascript: URL in a photo column', () => {
    const photo = SPEAKER_FIELDS.find((f) => f.key === 'photoURL')!;
    expect(photo.validate!('https://example.test/a.jpg')).toBeUndefined();
    // Three surfaces put this string straight into an href or Linking.openURL.
    expect(photo.validate!('javascript:alert(1)')).toMatch(/not an http/);
    expect(photo.validate!('example.test/a.jpg')).toMatch(/not an http/);
  });
});
