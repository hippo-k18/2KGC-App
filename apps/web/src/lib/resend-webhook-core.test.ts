import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readDeliveryProblem, verifySvixSignature } from './resend-webhook-core';

const secret = `whsec_${Buffer.from('a test signing key of some length').toString('base64')}`;
const body = '{"type":"email.bounced"}';
const sign = (id: string, ts: string, b: string, key = secret) =>
  `v1,${createHmac('sha256', Buffer.from(key.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${b}`).digest('base64')}`;
const now = 1_800_000_000;

describe('the Resend webhook signature (T258 #9)', () => {
  const ok = { secret, id: 'msg_1', timestamp: String(now), signature: sign('msg_1', String(now), body), body, nowS: now };

  it('accepts a correctly signed request', () => {
    expect(verifySvixSignature(ok)).toBe('ok');
    expect(verifySvixSignature({ ...ok, signature: `v1,AAAA ${ok.signature}` })).toBe('ok');
  });

  it('fails closed with no secret configured', () => {
    expect(verifySvixSignature({ ...ok, secret: undefined })).toBe('no-secret');
    expect(verifySvixSignature({ ...ok, secret: '' })).toBe('no-secret');
  });

  it('refuses a changed body, a missing header, another key and a stale timestamp', () => {
    expect(verifySvixSignature({ ...ok, body: body + ' ' })).toBe('bad-signature');
    expect(verifySvixSignature({ ...ok, signature: null })).toBe('bad-signature');
    expect(
      verifySvixSignature({ ...ok, signature: sign('msg_1', String(now), body, `whsec_${Buffer.from('other').toString('base64')}`) }),
    ).toBe('bad-signature');
    expect(verifySvixSignature({ ...ok, nowS: now + 301 })).toBe('stale');
  });
});

describe('reading the event', () => {
  it('reads a hard bounce', () => {
    expect(
      readDeliveryProblem({
        type: 'email.bounced',
        created_at: '2026-10-14T10:00:00.000Z',
        data: { email_id: 'em_1', to: ['Ada@Example.com'], bounce: { type: 'Permanent' } },
      }),
    ).toEqual({ kind: 'bounced', emails: ['ada@example.com'], emailId: 'em_1', at: new Date('2026-10-14T10:00:00.000Z') });
  });

  it('reads a complaint', () => {
    expect(readDeliveryProblem({ type: 'email.complained', data: { to: ['bo@example.com'] } })?.kind).toBe('complained');
  });

  it('ignores a transient bounce, other events and junk', () => {
    expect(readDeliveryProblem({ type: 'email.bounced', data: { to: ['a@b.co'], bounce: { type: 'Transient' } } })).toBeNull();
    expect(readDeliveryProblem({ type: 'email.delivered', data: { to: ['a@b.co'] } })).toBeNull();
    expect(readDeliveryProblem({ type: 'email.bounced', data: { to: [] } })).toBeNull();
    expect(readDeliveryProblem(null)).toBeNull();
  });
});
