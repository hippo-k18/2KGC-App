import type { TicketTypeRow } from '@/lib/commerce';

/**
 * The "On sale" cell every ticket list prints: off sale when the price phases
 * say so, else the sales window as wall clock in the event's zone, else
 * "always".
 */
export function salesWindowText(t: TicketTypeRow): string {
  if (t.offSale) return `Off sale: ${t.offSale.toLowerCase()}`;
  if (t.salesOpenAtLocal || t.salesCloseAtLocal) {
    return `${t.salesOpenAtLocal?.slice(0, 10) ?? 'now'} → ${t.salesCloseAtLocal?.slice(0, 10) ?? 'no end'}`;
  }
  return 'always';
}
