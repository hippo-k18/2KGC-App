import { describe, expect, it } from 'vitest';
import { FALLBACK_CALL_ID, submitTarget } from './submit-redirect';

describe('submitTarget (T372)', () => {
  it('goes to the shown call, keeping the query', () => {
    expect(submitTarget('call-for-speakers-kgc-2027', '')).toBe('/submit/call-for-speakers-kgc-2027');
    expect(submitTarget('next-year', 'utm_source=x&utm_medium=y')).toBe('/submit/next-year?utm_source=x&utm_medium=y');
    expect(submitTarget('next-year', '?utm_source=x')).toBe('/submit/next-year?utm_source=x');
  });
  it('falls back to the 2027 call when none is shown', () => {
    expect(submitTarget(null, '')).toBe(`/submit/${FALLBACK_CALL_ID}`);
    expect(submitTarget(undefined, 'utm_source=x')).toBe(`/submit/${FALLBACK_CALL_ID}?utm_source=x`);
  });
});
