import { describe, expect, it } from 'vitest';
import type { LearnPageContent } from '@kgc/shared';
import {
  parseRecovery,
  recoveryKey,
  recoveryStep,
  recoveryTimeLabel,
  recoveryToOffer,
  revisionForRestore,
  savedCovers,
  serializeRecovery,
} from './learn-recovery-core';

const page = (title: string): LearnPageContent => ({
  seoTitle: title,
  seoDescription: '',
  sections: [{ id: 's1', label: 'Top', background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks: [] }],
});

describe('recovery copy (T343, N5)', () => {
  it('is keyed by person and page, whatever the address case', () => {
    expect(recoveryKey(' Owner@Example.com ')).toBe(recoveryKey('owner@example.com'));
    expect(recoveryKey('a@x.test')).not.toBe(recoveryKey('b@x.test'));
    expect(recoveryKey('a@x.test', 'learn')).not.toBe(recoveryKey('a@x.test', 'other'));
  });

  it('round-trips the doc, the base revision and the time', () => {
    const copy = parseRecovery(serializeRecovery(page('mine'), 7, 1234));
    expect(copy).toEqual({ v: 1, doc: page('mine'), baseRevision: 7, at: 1234 });
  });

  it('reads nothing from missing, damaged or foreign values', () => {
    expect(parseRecovery(null)).toBeNull();
    expect(parseRecovery('')).toBeNull();
    expect(parseRecovery('{not json')).toBeNull();
    expect(parseRecovery('"text"')).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 2, doc: page('x'), baseRevision: 1, at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: { sections: 'no' }, baseRevision: 1, at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: { sections: [{}] }, baseRevision: 1, at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: page('x'), at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: page('x'), baseRevision: 1 }))).toBeNull();
  });

  it('keeps a copy while the screen differs from the server, and removes it once they match', () => {
    expect(recoveryStep({ content: page('typed'), lastSaved: page('server'), offerPending: false })).toBe('write');
    expect(recoveryStep({ content: page('same'), lastSaved: page('same'), offerPending: false })).toBe('clear');
  });

  it('never touches a copy that is still being offered', () => {
    expect(recoveryStep({ content: page('typed'), lastSaved: page('server'), offerPending: true })).toBe('skip');
    expect(recoveryStep({ content: page('same'), lastSaved: page('same'), offerPending: true })).toBe('skip');
  });

  it('offers a copy only when it holds words the server does not', () => {
    expect(recoveryToOffer(null, page('server'))).toBeNull();
    const same = parseRecovery(serializeRecovery(page('server'), 3, 1))!;
    expect(recoveryToOffer(same, page('server'))).toBeNull();
    const other = parseRecovery(serializeRecovery(page('lost words'), 3, 1))!;
    expect(recoveryToOffer(other, page('server'))).toBe(other);
  });

  it('a save of the same words makes the copy redundant, other words do not', () => {
    const copy = parseRecovery(serializeRecovery(page('W'), 3, 1));
    expect(savedCovers(copy, page('W'))).toBe(true);
    expect(savedCovers(copy, page('older'))).toBe(false);
    expect(savedCovers(null, page('W'))).toBe(false);
  });

  it('a copy typed before someone else saved goes back on its old revision, so the conflict asks', () => {
    const copy = parseRecovery(serializeRecovery(page('W'), 4, 1))!;
    // The server was at 9 when the editor opened: somebody saved after the words.
    expect(revisionForRestore(copy, 9, 9)).toBe(4);
    expect(revisionForRestore(copy, 9, 11)).toBe(4);
    // Nobody saved since: an ordinary edit on whatever this editor holds now.
    expect(revisionForRestore(copy, 4, 4)).toBe(4);
    expect(revisionForRestore(copy, 4, 6)).toBe(6);
  });

  it('names the time, and the day when it was not today', () => {
    const at = new Date(2026, 9, 22, 15, 41).getTime();
    expect(recoveryTimeLabel(at, new Date(2026, 9, 22, 18, 0).getTime())).toBe('3:41 PM');
    expect(recoveryTimeLabel(at, new Date(2026, 9, 23, 9, 0).getTime())).toBe('Oct 22, 3:41 PM');
  });
});
