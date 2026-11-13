import { describe, expect, it } from 'vitest';
import { SPEAK_FALLBACK, speakCloseLabel, speakHref } from './speak-link';

describe('speakHref (T405)', () => {
  it('goes to the shown call', () => expect(speakHref({ id: 'call-for-speakers-kgc-2027' })).toBe('/submit/call-for-speakers-kgc-2027'));
  it('falls back to the speaking box with no call', () => {
    expect(speakHref(null)).toBe(SPEAK_FALLBACK);
    expect(speakHref(undefined)).toBe('/sponsor#speak');
  });
});

describe('speakCloseLabel (T405)', () => {
  it('writes the call date US style', () => expect(speakCloseLabel('2027-01-31')).toBe('January 31, 2027'));
  it('uses January 15, 2027 when the call has no date', () => {
    expect(speakCloseLabel(undefined)).toBe('January 15, 2027');
    expect(speakCloseLabel('soon')).toBe('January 15, 2027');
  });
  it('never moves the day with the zone', () => expect(speakCloseLabel('2027-01-15')).toBe('January 15, 2027'));
});
