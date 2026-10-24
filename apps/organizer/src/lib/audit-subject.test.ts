import { describe, expect, it } from 'vitest';

import { auditPlace, auditSubject, namesARecord } from './audit-subject';

describe('auditSubject', () => {
  it('picks the best field first, then the earliest map holding it', () => {
    // Field order wins over map order: a session edit carries both a title and
    // a room, and the title is what the row is about.
    expect(auditSubject({ roomName: 'Hall A' }, { title: 'Opening Keynote' })).toBe(
      'Opening Keynote',
    );
    // Within one field, the first map wins — `after` before `before`, so a
    // rename shows the new name.
    expect(auditSubject({ name: 'Ada Okonkwo' }, { name: 'Ada Silva' })).toBe('Ada Okonkwo');
  });

  it('falls back to an address when nothing names the person', () => {
    expect(auditSubject({ status: 'cancelled' }, { email: 'ada@example.com' })).toBe(
      'ada@example.com',
    );
  });

  it('is null when no map holds anything readable', () => {
    expect(auditSubject({ status: 'cancelled' }, { status: 'active' })).toBeNull();
    expect(auditSubject({ name: '   ' })).toBeNull();
    expect(auditSubject(undefined, undefined)).toBeNull();
  });
});

describe('auditPlace', () => {
  it('says what kind of record changed', () => {
    expect(auditPlace('registrations/reg_01e1621469460b03d253854f')).toBe('A ticket holder');
    expect(auditPlace('sessionSeats/s1/seats/u1')).toBe('A seat');
    expect(auditPlace('stripe/promotionCodes/promo_123')).toBe('A discount code');
  });

  it('names the settings page rather than the whole collection', () => {
    expect(auditPlace('settings/access')).toBe('The access settings');
    expect(auditPlace('settings/attendeeCategories')).toBe('The attendee categories settings');
  });

  it('never prints a document id or a path', () => {
    const ids = [
      ['registrations/reg_01e1621469460b03d253854f', 'reg_01e1621469460b03d253854f'],
      ['checkInLists/door/checkIns/reg_01e162', 'reg_01e162'],
      // A settings key that is an auto-id rather than a word stays unsaid.
      ['settings/QL3mZ9aXbC7pVn2KsRtY', 'QL3mZ9aXbC7pVn2KsRtY'],
      ['somethingNew/abc123', 'abc123'],
    ];
    for (const [path, id] of ids) {
      const said = auditPlace(path);
      expect(said).not.toContain('/');
      expect(said.toLowerCase()).not.toContain(id.toLowerCase());
    }
    expect(auditPlace('')).toBe('A record');
  });

  it('has words for a collection nobody has mapped yet', () => {
    expect(auditPlace('somethingNew/abc123')).toBe('A record');
  });
});

describe('namesARecord', () => {
  it('reads back a document, not a whole collection', () => {
    expect(namesARecord('attendee.cancel', 'registrations/reg_abc')).toBe(true);
    expect(namesARecord('track.import', 'tracks')).toBe(false);
    expect(namesARecord('checkin.undo', 'checkInLists/door/checkIns/reg_abc')).toBe(true);
  });

  it('never reads the record an erasure was about', () => {
    // The record is anonymised rather than deleted, so this read would work —
    // and would put a name or an address into a log that outlives the erasure.
    expect(namesARecord('attendee.erase', 'registrations/reg_abc')).toBe(false);
  });

  it('leaves a Stripe object alone, because it is not in Firestore', () => {
    expect(namesARecord('discountCode.create', 'stripe/promotionCodes/promo_1')).toBe(false);
  });
});
