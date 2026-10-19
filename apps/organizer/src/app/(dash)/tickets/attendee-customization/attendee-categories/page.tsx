import Link from 'next/link';
import { categoryForTicket, ticketKey } from '@kgc/shared';
import { attendeeCategories } from '@/lib/attendee-categories';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { listAttendees } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { PageHeader, Panel } from '../../../ui';
import { RuleEditor, type TicketRuleRow } from './rule-editor';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Attendee Customization › Attendee Categories.
 *
 * Whova's nav lists categories twice because the same objects do two jobs:
 * labelling a *person*, and deciding what a *purchase* makes somebody. The list
 * and the hand assignment are at `attendees/categories`. This is the other
 * half: which category a ticket type sets.
 *
 * The rule is applied in `ensureRegistration`, the one function a purchase, an
 * invoice, an import and Add an attendee all go through, and saving a rule here
 * relabels the people who already hold that ticket. A category an organizer set
 * by hand is never changed by a rule.
 *
 * Rows are the ticket list plus any type people hold that is not in it, such as
 * one that arrived with an import, so every holder is reachable by a rule.
 */
export default async function AttendeeCategoriesPage() {
  await requireOrganizer();

  const [catalogue, attendees, { categories, ticketRules }] = await Promise.all([
    listTicketTypes(),
    listAttendees(),
    attendeeCategories(),
  ]);

  const holders = new Map<string, { label: string; n: number }>();
  for (const a of attendees) {
    if (!a.ticketType || a.registrationStatus !== 'active') continue;
    const k = ticketKey(a.ticketType);
    const hit = holders.get(k) ?? { label: a.ticketType.trim(), n: 0 };
    hit.n += 1;
    holders.set(k, hit);
  }

  const onSale = new Set(catalogue.map((t) => ticketKey(t.name)));
  const names = [
    ...catalogue.map((t) => t.name),
    ...[...holders.entries()].filter(([k]) => !onSale.has(k)).map(([, v]) => v.label),
  ];
  const rows: TicketRuleRow[] = names.map((name) => ({
    ticketType: name,
    onSale: onSale.has(ticketKey(name)),
    holders: holders.get(ticketKey(name))?.n ?? 0,
    categoryId: categoryForTicket(categories, ticketRules, name)?.id ?? '',
  }));

  return (
    <>
      <PageHeader
        title="Attendee Categories"
        info={
          <>
            <strong>Set a category by ticket type</strong>
            <p>
              Anyone who buys, is imported with or is added with a ticket type gets its category.
              Saving also updates the people who already hold it. A category you assigned by hand
              is never changed.
            </p>
          </>
        }
        actions={
          <Link href="/attendees/categories" className="whova-btn-main">
            Manage categories
          </Link>
        }
        links={[
          <Link key="t" href="/tickets/attendee-customization/ticket-tiering">
            Ticket Tiering
          </Link>,
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Category by ticket type</h2>
        <RuleEditor rows={rows} categories={categories} />
        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          To add, rename or delete a category, or to assign one to a person, open{' '}
          <Link href="/attendees/categories">Attendees › Categories</Link>.
        </p>
      </Panel>
    </>
  );
}
