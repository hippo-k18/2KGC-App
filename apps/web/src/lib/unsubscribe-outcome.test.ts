import { describe, expect, it } from 'vitest';
import { oneClickStatus, pageAfter } from './unsubscribe-outcome';

describe('unsubscribe answers (T258 #11)', () => {
  it('answers 204 only when the reader is actually off the list', () => {
    expect(oneClickStatus('unsubscribed')).toBe(204);
    expect(oneClickStatus('already')).toBe(204);
    expect(oneClickStatus('gone')).toBe(204);
  });

  it('answers 503 when the write failed, so the mail client does not claim success', () => {
    expect(oneClickStatus('error')).toBe(503);
  });

  it('sends the page to an error state rather than "done" on a failed write', () => {
    expect(pageAfter('a.b', 'error')).toBe('/u/a.b?error=1');
    expect(pageAfter('a.b', 'unsubscribed')).toBe('/u/a.b?done=1');
  });
});
