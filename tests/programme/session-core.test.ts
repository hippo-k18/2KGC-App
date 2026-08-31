/**
 * Tests for the session editor's pure half.
 *
 * `actions.ts` cannot be loaded here at all — it is `'use server'` and pulls in
 * `lib/firestore.ts` and `lib/time.ts`, both of which carry `server-only`, which
 * throws outside a React Server Component. So the parts that can be wrong
 * quietly live in `session-core.ts` and are pinned here, exactly as
 * `conflicts-core.ts` is.
 *
 * The ordering tests are the point. `speakerNames` mirrors `speakerIds`
 * positionally and the position is the programme committee's billing order, so
 * a sort, a dedupe or a `filter(Boolean)` slipped in anywhere on this path does
 * not lose a name — it silently moves every later name onto the wrong person,
 * and the symptom is a printed programme crediting the wrong lead author.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_FORMATS,
  SESSION_STATUSES,
  SKILL_LEVELS,
  conflictsForSession,
  parseSessionForm,
  primaryTrackFor,
  qaDefaultsFor,
  speakerIndexDelta,
  speakerNamesFor,
} from '../../apps/organizer/src/app/(dash)/content/agenda-center/session-manager/session-core';
import type { Conflict } from '../../apps/organizer/src/lib/conflicts-core';

const DAY = '2027-05-05';

/** A form that would be accepted, so each test can break exactly one thing. */
function form(over: Record<string, string | string[]> = {}): FormData {
  const base: Record<string, string | string[]> = {
    title: 'A talk',
    startsAtLocal: `${DAY}T09:00`,
    endsAtLocal: `${DAY}T10:00`,
    status: 'draft',
    format: 'talk',
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) {
    if (Array.isArray(v)) for (const one of v) fd.append(k, one);
    else fd.append(k, v);
  }
  return fd;
}

function ok(fd: FormData) {
  const parsed = parseSessionForm(fd);
  if (!parsed.ok) throw new Error(`expected a valid form, got: ${parsed.error}`);
  return parsed.value;
}

function bad(fd: FormData) {
  const parsed = parseSessionForm(fd);
  if (parsed.ok) throw new Error('expected the form to be rejected');
  return parsed;
}

describe('parseSessionForm — the fields', () => {
  it('trims the title and rejects a blank one, naming the field', () => {
    expect(ok(form({ title: '  Graphs at scale  ' })).title).toBe('Graphs at scale');
    expect(bad(form({ title: '   ' })).fieldErrors.title).toBeDefined();
  });

  it('accepts every member of each closed union, and nothing else', () => {
    for (const s of SESSION_STATUSES) expect(ok(form({ status: s })).status).toBe(s);
    for (const f of SESSION_FORMATS) expect(ok(form({ format: f })).format).toBe(f);
    for (const l of SKILL_LEVELS) expect(ok(form({ skillLevel: l })).skillLevel).toBe(l);

    expect(bad(form({ status: 'deleted' })).fieldErrors.status).toBeDefined();
    expect(bad(form({ format: 'break' })).fieldErrors.format).toBeDefined();
    expect(bad(form({ skillLevel: 'expert' })).fieldErrors.skillLevel).toBeDefined();
  });

  it('treats a blank skill level as "not stated" rather than as an error', () => {
    expect(ok(form({ skillLevel: '' })).skillLevel).toBeUndefined();
  });

  it('reads capacity as a whole number of seats, blank meaning uncapped', () => {
    expect(ok(form({ capacity: '60' })).capacity).toBe(60);
    expect(ok(form({ capacity: '' })).capacity).toBeUndefined();
    expect(bad(form({ capacity: '12.5' })).fieldErrors.capacity).toBeDefined();
    expect(bad(form({ capacity: '0' })).fieldErrors.capacity).toBeDefined();
    expect(bad(form({ capacity: '-3' })).fieldErrors.capacity).toBeDefined();
    expect(bad(form({ capacity: 'lots' })).fieldErrors.capacity).toBeDefined();
  });

  it('reports every bad field at once, not just the first', () => {
    const parsed = bad(form({ title: '', status: 'nope', format: 'nope' }));
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual(['format', 'status', 'title']);
    expect(parsed.error).toContain('3 fields');
  });
});

describe('parseSessionForm — the wall clock', () => {
  it('rejects anything that is not YYYY-MM-DDTHH:mm, per field', () => {
    // An ISO instant is the dangerous one: accepting it would let a value that
    // has already been shifted into UTC be treated as local wall clock.
    expect(bad(form({ startsAtLocal: '2027-05-05T09:00:00Z' })).fieldErrors.startsAtLocal).toBeDefined();
    expect(bad(form({ startsAtLocal: '05/05/2027 09:00' })).fieldErrors.startsAtLocal).toBeDefined();
    expect(bad(form({ endsAtLocal: '' })).fieldErrors.endsAtLocal).toBeDefined();
  });

  it('rejects an end at or before the start, and blames the end box', () => {
    expect(bad(form({ endsAtLocal: `${DAY}T09:00` })).fieldErrors.endsAtLocal).toBeDefined();
    expect(bad(form({ endsAtLocal: `${DAY}T08:00` })).fieldErrors.endsAtLocal).toBeDefined();
  });

  it('accepts a session that runs past midnight onto the next date', () => {
    // The 21:00 reception. It is legal, and `day` stays the start's date —
    // which is derived server-side by deriveTimes, not here.
    const v = ok(form({ startsAtLocal: `${DAY}T21:00`, endsAtLocal: '2027-05-06T01:00' }));
    expect(v.startsAtLocal).toBe(`${DAY}T21:00`);
    expect(v.endsAtLocal).toBe('2027-05-06T01:00');
  });

  it('does not complain about the times when only the title is missing', () => {
    expect(bad(form({ title: '' })).fieldErrors.endsAtLocal).toBeUndefined();
  });
});

describe('parseSessionForm — ordered ids', () => {
  it('keeps submission order for speakers and tracks', () => {
    const v = ok(form({ speakerIds: ['sp3', 'sp1', 'sp2'], trackIds: ['t9', 't1'] }));
    expect(v.speakerIds).toEqual(['sp3', 'sp1', 'sp2']);
    expect(v.trackIds).toEqual(['t9', 't1']);
  });

  it('never sorts and never dedupes — a session may bill the same person twice', () => {
    const v = ok(form({ speakerIds: ['zed', 'amy', 'zed'] }));
    expect(v.speakerIds).toEqual(['zed', 'amy', 'zed']);
  });

  it('drops empty rows, which are pickers nobody filled in', () => {
    const v = ok(form({ speakerIds: ['sp1', '', ' ', 'sp2'] }));
    expect(v.speakerIds).toEqual(['sp1', 'sp2']);
  });

  it('is an empty list when nothing was picked, not undefined', () => {
    expect(ok(form()).speakerIds).toEqual([]);
    expect(ok(form()).trackIds).toEqual([]);
  });
});

describe('speakerNamesFor', () => {
  const byId = new Map([
    ['sp1', 'Ada Hartmann'],
    ['sp2', 'Chidi Okonkwo'],
  ]);

  it('mirrors speakerIds positionally', () => {
    expect(speakerNamesFor(['sp2', 'sp1'], byId).names).toEqual(['Chidi Okonkwo', 'Ada Hartmann']);
  });

  it('produces an array of exactly the same length, so index i is the same person', () => {
    const { names } = speakerNamesFor(['sp1', 'sp2', 'sp1'], byId);
    expect(names).toHaveLength(3);
    expect(names).toEqual(['Ada Hartmann', 'Chidi Okonkwo', 'Ada Hartmann']);
  });

  it('reports an unknown id rather than dropping it and shifting every later name', () => {
    const { names, unknown } = speakerNamesFor(['sp1', 'ghost', 'sp2'], byId);
    expect(unknown).toEqual(['ghost']);
    // The caller refuses the save; what matters is that position 2 is still sp2.
    expect(names).toHaveLength(3);
    expect(names[2]).toBe('Chidi Okonkwo');
  });

  it('is empty for an empty selection', () => {
    expect(speakerNamesFor([], byId)).toEqual({ names: [], unknown: [] });
  });
});

describe('primaryTrackFor', () => {
  const byId = new Map([
    ['graph-ds', { id: 'graph-ds', name: 'Graph Data Science', color: '#2180b2' }],
    ['ontologies', { id: 'ontologies', name: 'Ontologies', color: undefined }],
  ]);

  it('caches trackIds[0] and only trackIds[0]', () => {
    expect(primaryTrackFor(['ontologies', 'graph-ds'], byId).primary?.name).toBe('Ontologies');
  });

  it('has no primary track when the session is in none', () => {
    expect(primaryTrackFor([], byId).primary).toBeUndefined();
  });

  it('reports a colourless track as having no colour, so the cache is cleared', () => {
    // "Absence versus ignorance": the track document exists and is
    // authoritative in what it omits, so the old track's colour must not stay.
    expect(primaryTrackFor(['ontologies'], byId).primary?.color).toBeUndefined();
  });

  it('reports unknown ids anywhere in the list, not just first', () => {
    expect(primaryTrackFor(['graph-ds', 'gone'], byId).unknown).toEqual(['gone']);
  });
});

describe('speakerIndexDelta', () => {
  it('names who gained the session and who lost it', () => {
    expect(speakerIndexDelta(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });

  it('is empty when only the order changed — sessionIds is a set', () => {
    expect(speakerIndexDelta(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
  });

  it('handles a session going from nobody to somebody and back', () => {
    expect(speakerIndexDelta([], ['a'])).toEqual({ added: ['a'], removed: [] });
    expect(speakerIndexDelta(['a'], [])).toEqual({ added: [], removed: ['a'] });
  });

  it('does not add a duplicate twice — arrayUnion would ignore it anyway', () => {
    expect(speakerIndexDelta([], ['a', 'a'])).toEqual({ added: ['a'], removed: [] });
  });
});

describe('qaDefaultsFor', () => {
  it('matches what the seed writes, so a hand-made session behaves like a seeded one', () => {
    expect(qaDefaultsFor('keynote')).toEqual({ qaEnabled: true, pollsEnabled: true });
    expect(qaDefaultsFor('panel')).toEqual({ qaEnabled: true, pollsEnabled: true });
    expect(qaDefaultsFor('talk')).toEqual({ qaEnabled: true, pollsEnabled: false });
    expect(qaDefaultsFor('workshop')).toEqual({ qaEnabled: true, pollsEnabled: false });
    expect(qaDefaultsFor('poster')).toEqual({ qaEnabled: true, pollsEnabled: false });
    expect(qaDefaultsFor('social')).toEqual({ qaEnabled: false, pollsEnabled: false });
  });
});

describe('conflictsForSession', () => {
  const clash = (ids: string[], summary: string): Conflict => ({
    kind: 'room-double-booked',
    severity: 'error',
    summary,
    day: DAY,
    sessions: ids.map((id) => ({
      id,
      title: id,
      startsAtLocal: `${DAY}T09:00`,
      endsAtLocal: `${DAY}T10:00`,
    })),
  });

  it('keeps a conflict that names the session on either side of the pair', () => {
    const all = [clash(['s1', 's2'], 'first'), clash(['s2', 's3'], 'second')];
    expect(conflictsForSession(all, 's2').map((c) => c.summary)).toEqual(['first', 'second']);
    expect(conflictsForSession(all, 's1').map((c) => c.summary)).toEqual(['first']);
    expect(conflictsForSession(all, 's3').map((c) => c.summary)).toEqual(['second']);
  });

  it('is empty for a session in no conflict at all', () => {
    expect(conflictsForSession([clash(['s1', 's2'], 'first')], 's9')).toEqual([]);
  });
});
