import { describe, expect, it } from 'vitest';

import { type Badge, orderBadges, stripLegacy } from './badge-core';

const badge = (id: string, name: string, status: Badge['status'] = 'active'): Badge => ({
  registrationId: id,
  qrSecret: `secret-${id}`,
  name,
  ticketType: 'Main Conference',
  category: null,
  status,
});

describe('orderBadges', () => {
  it('puts the ticket bought under the address first', () => {
    const own = badge('reg_own', 'Zoe Own');
    const alt = badge('reg_alt', 'Ada Alt');
    expect(orderBadges([own], [alt]).map((b) => b.registrationId)).toEqual(['reg_own', 'reg_alt']);
  });

  it('shows every alternate, active ones first, then by name', () => {
    const out = orderBadges(
      [],
      [badge('reg_c', 'Cal', 'cancelled'), badge('reg_b', 'Bea'), badge('reg_a', 'Abe')],
    );
    expect(out.map((b) => b.registrationId)).toEqual(['reg_a', 'reg_b', 'reg_c']);
  });

  it('lists a registration once even if both lookups return it', () => {
    const own = badge('reg_own', 'Zoe Own');
    expect(orderBadges([own], [own, badge('reg_x', 'Xan')]).map((b) => b.registrationId)).toEqual([
      'reg_own',
      'reg_x',
    ]);
  });

  it('is empty when the address holds nothing', () => expect(orderBadges([], [])).toEqual([]));
});

describe('stripLegacy', () => {
  it('drops the claim code a v1 cache entry carried', () => {
    const cached = { ...badge('reg_own', 'Zoe Own'), claimCode: 'ABC234' };
    const out = stripLegacy(cached);
    expect(out).not.toHaveProperty('claimCode');
    expect(out.qrSecret).toBe('secret-reg_own');
  });
});
