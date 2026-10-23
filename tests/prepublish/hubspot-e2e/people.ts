import { createHash } from 'node:crypto';

export const OWNER = 'owner@hubspot-e2e.test';
/** Team members, none of them an owner. Finance can open Tickets (but not HubSpot), the others cannot. */
export const MEMBERS = {
  finance: 'finance@hubspot-e2e.test',
  agenda: 'agenda@hubspot-e2e.test',
  checkin: 'checkin@hubspot-e2e.test',
  learn: 'learn@hubspot-e2e.test',
} as const;

export const BACKFILL_N = 120;
export const ORDER_REG = 'reg_e2e_order';
export const ORDER_ID = 'ord_e2e_1';
export const ORDER_EMAIL = 'ada.order@example.com';
/** One person, two orders of one ticket each (T334 X1): refunding one must leave the contact Registered. */
export const MULTI_EMAIL = 'multi.ticket@example.com';
export const MULTI = [
  { order: 'ord_e2e_m1', reg: 'reg_e2e_m1', tier: 'main-conference', name: 'Main Conference', cents: 79900 },
  { order: 'ord_e2e_m2', reg: 'reg_e2e_m2', tier: 'virtual', name: 'Virtual Pass', cents: 19900 },
] as const;
export const bfEmail = (i: number) => `backfill${String(i).padStart(3, '0')}@example.com`;
export const bfReg = (i: number) => `reg_e2e_bf_${String(i).padStart(3, '0')}`;

export function sha(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** `hubspotPersonKey` in scripts/src/lib/hubspot-sync.ts: the queue is one document per person. */
export function personKey(email: string): string {
  return `p_${sha(email).slice(0, 40)}`;
}
