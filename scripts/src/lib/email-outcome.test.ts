import { describe, expect, it } from 'vitest';

import { sendOutcomeMessage } from './email.js';

/**
 * ── Finding 5 ──────────────────────────────────────────────────────────────
 *
 * The dashboard said "Link sent to marek@…" for mail the provider had refused
 * a second earlier, because the only thing a Send button could ask was whether
 * an API key was configured. These cases pin the one property that matters: a
 * sentence claiming a mail left may only be produced by the outcome that means
 * a mail left.
 *
 * A test that could not fail is the thing this project has shipped twice, so
 * each case below names a *different* outcome and asserts the claim is absent,
 * rather than asserting the same happy string three times.
 */
describe('sendOutcomeMessage', () => {
  const base = {
    to: 'marek@ontotextlabs.example.invalid',
    sent: 'Link sent to marek@ontotextlabs.example.invalid.',
    fallback: 'Copy the link from the row and send it yourself.',
  } as const;

  it('claims a send only when the provider accepted it', () => {
    expect(sendOutcomeMessage({ ...base, outcome: 'sent' })).toBe(base.sent);
  });

  it('says nothing was sent when this deployment cannot send at all', () => {
    const msg = sendOutcomeMessage({ ...base, outcome: 'skipped' });
    expect(msg).toContain('nothing was sent');
    expect(msg).not.toContain('Link sent to');
    expect(msg).toContain(base.fallback);
  });

  it('says nothing arrived when the provider refused the address', () => {
    const msg = sendOutcomeMessage({ ...base, outcome: 'failed' });
    expect(msg).toContain('refused');
    expect(msg).toContain('nothing arrived');
    expect(msg).not.toContain('Link sent to');
    expect(msg).toContain(base.fallback);
  });

  it('names the address in both of the ways it did not go', () => {
    for (const outcome of ['skipped', 'failed'] as const) {
      expect(sendOutcomeMessage({ ...base, outcome })).toContain(base.to);
    }
  });

  it('tells the reader what to do instead in every case that is not a send', () => {
    for (const outcome of ['skipped', 'failed'] as const) {
      expect(sendOutcomeMessage({ ...base, outcome, fallback: 'Ring them.' })).toMatch(
        /Ring them\.$/,
      );
    }
  });
});
