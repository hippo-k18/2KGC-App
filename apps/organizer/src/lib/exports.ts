import 'server-only';

import { toCsv, type Column } from './csv';
import { listOrders, money, type OrderRow } from './commerce';
import { listAttendees, listSessions, listSpeakers, listSponsors } from './data';
import type { AttendeeRow, SessionRow, SpeakerRow, SponsorRow } from './data';

/**
 * Every export the dashboard offers, as data.
 *
 * One registry rather than a route per export, because Whova has eight of these
 * and they differ only in which rows and which columns. Adding a ninth is an
 * entry here, not a file.
 *
 * ── What goes in a column list is a privacy decision ────────────────────────
 *
 * These files leave the building. They get emailed to a badge printer, a
 * caterer, an AV company. So the columns are chosen rather than dumped:
 * `qrSecret` and `claimCode` appear in no export at all, because either one is
 * a working credential — the QR secret admits its holder at the door, and the
 * claim code signs them into the app as that attendee. An export that carried
 * them would turn a spreadsheet forwarded to a supplier into a set of usable
 * tickets.
 *
 * `emailHash`, `uid` and internal document ids are likewise absent: nobody
 * outside this system can use them, and they invite joining data that should
 * not be joined.
 */

export type ExportKind = 'attendees' | 'orders' | 'speakers' | 'sessions' | 'sponsors' | 'catering';

export interface ExportDef {
  kind: ExportKind;
  title: string;
  /** What it is for, in the words of the person who would ask for it. */
  purpose: string;
  /** Named so an organizer knows what they are about to hand over. */
  contains: string;
  build: () => Promise<{ csv: string; rows: number }>;
}

function def<T>(
  kind: ExportKind,
  title: string,
  purpose: string,
  contains: string,
  load: () => Promise<T[]>,
  columns: Column<T>[],
): ExportDef {
  return {
    kind,
    title,
    purpose,
    contains,
    build: async () => {
      const rows = await load();
      return { csv: toCsv(rows, columns), rows: rows.length };
    },
  };
}

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

export const EXPORTS: ExportDef[] = [
  def<AttendeeRow>(
    'attendees',
    'Attendee list',
    'The everyday one — badge printing, catering numbers, a delegate list.',
    'Name, email, title, company, ticket type, and whether they have the app.',
    listAttendees,
    [
      { header: 'Name', value: (a) => a.name },
      { header: 'Email', value: (a) => a.email },
      { header: 'Title', value: (a) => a.title ?? '' },
      { header: 'Company', value: (a) => a.company ?? '' },
      { header: 'Ticket', value: (a) => a.ticketType ?? '' },
      { header: 'Ticket status', value: (a) => a.registrationStatus ?? '' },
      { header: 'Category', value: (a) => a.roles.join('; ') },
      { header: 'Signed into app', value: (a) => yesNo(a.signedIn) },
      { header: 'In directory', value: (a) => yesNo(a.visibleInDirectory) },
      { header: 'Interests', value: (a) => a.interests.join('; ') },
    ],
  ),

  def<AttendeeRow>(
    'catering',
    'Badge and catering list',
    'The one you send to a supplier. Deliberately the narrowest export here.',
    'Name and company only — no email, no ticket price, nothing personal.',
    async () => {
      const all = await listAttendees();
      // Refunded tickets are excluded: this list becomes a headcount somebody
      // is invoiced for, and a cancelled registration is not a lunch.
      return all.filter((a) => a.registrationStatus !== 'cancelled');
    },
    [
      { header: 'Name', value: (a) => a.name },
      { header: 'Company', value: (a) => a.company ?? '' },
      { header: 'Ticket', value: (a) => a.ticketType ?? '' },
    ],
  ),

  def<OrderRow>(
    'orders',
    'Orders and payments',
    'Reconciling against Stripe, or handing a finance team the year’s ticket revenue.',
    'Buyer, company, amounts, tax, refunds and the Stripe payment id.',
    listOrders,
    [
      { header: 'Purchased', value: (o) => o.purchasedAt.slice(0, 10) },
      { header: 'Buyer', value: (o) => o.buyerName ?? '' },
      { header: 'Email', value: (o) => o.email },
      { header: 'Company', value: (o) => o.companyName ?? '' },
      { header: 'Ticket', value: (o) => o.ticketNames.join('; ') },
      { header: 'Seats', value: (o) => o.seatCount },
      { header: 'Status', value: (o) => o.status },
      { header: 'Channel', value: (o) => o.channel },
      // Money as a plain decimal, not a formatted string: a finance person is
      // going to SUM this column, and "$799.00" sums to zero.
      { header: 'Subtotal', value: (o) => (o.subtotalCents / 100).toFixed(2) },
      { header: 'Tax', value: (o) => (o.taxCents / 100).toFixed(2) },
      { header: 'Discount', value: (o) => (o.discountCents / 100).toFixed(2) },
      { header: 'Total', value: (o) => (o.totalCents / 100).toFixed(2) },
      { header: 'Refunded', value: (o) => (o.refundedCents / 100).toFixed(2) },
      { header: 'Net', value: (o) => (o.netCents / 100).toFixed(2) },
      { header: 'Currency', value: (o) => o.currency.toUpperCase() },
      { header: 'Promo code', value: (o) => o.promotionCode ?? '' },
      { header: 'PO number', value: (o) => o.poNumber ?? '' },
      { header: 'Stripe payment', value: (o) => o.stripePaymentIntentId ?? '' },
      { header: 'Stripe invoice', value: (o) => o.stripeInvoiceId ?? '' },
    ],
  ),

  def<SpeakerRow>(
    'speakers',
    'Speaker list',
    'Chasing bios and headshots, or handing the programme to a designer.',
    'Name, title, company, their sessions, and what is missing from the profile.',
    listSpeakers,
    [
      { header: 'Name', value: (s) => s.name },
      { header: 'Title', value: (s) => s.title ?? '' },
      { header: 'Company', value: (s) => s.company ?? '' },
      { header: 'Sessions', value: (s) => s.sessionTitles.join('; ') },
      { header: 'Session count', value: (s) => s.sessionCount },
      { header: 'Has bio', value: (s) => yesNo(s.hasBio) },
      { header: 'Has photo', value: (s) => yesNo(s.hasPhoto) },
    ],
  ),

  def<SessionRow>(
    'sessions',
    'Programme',
    'The AV company, the room signage, and anyone who wants the agenda in a spreadsheet.',
    'Day, times, room, track, speakers, format and publication status.',
    listSessions,
    [
      { header: 'Day', value: (s) => s.day },
      { header: 'Start', value: (s) => s.startsAtLocal.slice(11, 16) },
      { header: 'End', value: (s) => s.endsAtLocal.slice(11, 16) },
      { header: 'Title', value: (s) => s.title },
      { header: 'Room', value: (s) => s.roomName ?? '' },
      { header: 'Track', value: (s) => s.primaryTrackName ?? '' },
      { header: 'Speakers', value: (s) => s.speakerNames.join('; ') },
      { header: 'Format', value: (s) => s.format },
      { header: 'Status', value: (s) => s.status },
    ],
  ),

  def<SponsorRow>(
    'sponsors',
    'Sponsor list',
    'The sponsorship team, and whoever is producing the signage.',
    'Name, tier, booth, website and main contact.',
    listSponsors,
    [
      { header: 'Name', value: (s) => s.name },
      { header: 'Tier', value: (s) => s.tier },
      { header: 'Booth', value: (s) => s.boothLocation ?? '' },
      { header: 'Website', value: (s) => s.website ?? '' },
      { header: 'Contact', value: (s) => s.contactName ?? '' },
      { header: 'Contact email', value: (s) => s.contactEmail ?? '' },
      { header: 'Has logo', value: (s) => yesNo(s.hasLogo) },
    ],
  ),
];

export function exportByKind(kind: string): ExportDef | undefined {
  return EXPORTS.find((e) => e.kind === kind);
}

// ---------------------------------------------------------------------------
// Analytics — the numbers Whova puts on this screen
// ---------------------------------------------------------------------------

export interface EventAnalytics {
  attendees: number;
  ticketHolders: number;
  signedIn: number;
  /** Share of ticket holders who have opened the app. The headline number. */
  adoptionPct: number;
  inDirectory: number;
  optedOut: number;
  bySignup: { label: string; count: number }[];
  byTicket: { label: string; count: number }[];
  byCompanyTop: { label: string; count: number }[];
  revenueNet: string;
  refunded: string;
}

/**
 * The stats block, computed in one pass.
 *
 * App adoption leads because it is the number an organizer can still act on in
 * the fortnight before doors open — every other figure here is a fact about the
 * past.
 */
export async function eventAnalytics(): Promise<EventAnalytics> {
  const [attendees, orders] = await Promise.all([listAttendees(), listOrders()]);

  const ticketHolders = attendees.filter((a) => a.registrationId).length;
  const signedIn = attendees.filter((a) => a.signedIn).length;

  const count = (rows: string[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
    return [...m.entries()]
      .map(([label, c]) => ({ label, count: c }))
      .sort((a, b) => b.count - a.count);
  };

  const real = orders.filter((o) => o.channel !== 'demo' && o.status !== 'pending');
  const netCents = real.reduce((n, o) => n + o.netCents, 0);
  const refundedCents = real.reduce((n, o) => n + o.refundedCents, 0);
  const currency = real[0]?.currency ?? 'usd';

  return {
    attendees: attendees.length,
    ticketHolders,
    signedIn,
    adoptionPct: ticketHolders === 0 ? 0 : Math.round((signedIn / ticketHolders) * 100),
    inDirectory: attendees.filter((a) => a.visibleInDirectory).length,
    optedOut: attendees.filter((a) => a.signedIn && !a.visibleInDirectory).length,
    bySignup: [
      { label: 'Holds a ticket and has the app', count: attendees.filter((a) => a.registrationId && a.signedIn).length },
      { label: 'Holds a ticket, no app yet', count: attendees.filter((a) => a.registrationId && !a.signedIn).length },
      { label: 'Has the app, no ticket', count: attendees.filter((a) => !a.registrationId && a.signedIn).length },
    ],
    byTicket: count(attendees.filter((a) => a.ticketType).map((a) => a.ticketType!)),
    byCompanyTop: count(attendees.filter((a) => a.company).map((a) => a.company!)).slice(0, 10),
    revenueNet: money(netCents, currency),
    refunded: money(refundedCents, currency),
  };
}
