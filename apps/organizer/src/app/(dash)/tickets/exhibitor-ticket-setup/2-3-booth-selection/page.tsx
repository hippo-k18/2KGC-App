import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.3 Booth Selection.
 *
 * ── The hardest unbuilt screen in the Tickets tab ───────────────────────────
 *
 * Every other gap here is &ldquo;write the collection and the editor&rdquo;.
 * This one is a reservation system: a booth is a unique thing that exactly one
 * exhibitor may hold, and two people clicking B-14 four seconds apart must not
 * both get it. `TicketTypeDoc.quantitySold` documents plainly that this project
 * has no seat lock across the Checkout redirect and deliberately accepts
 * overselling at KGC volumes. That trade is fine for a $1,200 conference pass
 * and not fine for a floor plan, where the duplicate is discovered by two
 * companies standing in the same square metre.
 */
export default async function BoothSelectionPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.3 Booth Selection"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
          Exhibitor Manager
        </Link>,
      ]}
      lead={
        <>
          <strong>There is no floor plan and no booth inventory.</strong> Nothing in Firestore
          models a booth, so there is nothing here to lay out, price, hold or assign.
        </>
      }
      whova={
        <>
          An uploaded floor-plan image with clickable booth regions, booths grouped into priced
          categories (corner, island, standard), live availability, a hold during checkout, and
          organizer override to move an exhibitor from one booth to another after the fact.
        </>
      }
      needs={
        <>
          A <code>booths</code> collection with a status per booth, an image with mapped coordinates, and — the
          part that is not routine — a genuine reservation with an expiry, taken in a Firestore
          transaction before the Stripe redirect and released if payment never completes. That is a
          distributed lock with a timeout, which is the one shape this codebase has so far avoided
          on purpose.
        </>
      }
      size="6–10 days, and the reservation logic deserves its own tests before it takes money"
      refs={
        <>
          <code>packages/shared/src/models.ts</code>, the warning on{' '}
          <code>TicketTypeDoc.quantitySold</code> — it explains why no lock exists today and what
          accepting overselling was traded for.
        </>
      }
      notBuilt={[
        <li key="plan">
          <strong>Floor-plan upload and hotspot mapping.</strong> An image plus coordinates; the
          mapping editor is the fiddly half.
        </li>,
        <li key="hold">
          <strong>Holding a booth during checkout.</strong> The correctness-critical piece. Without
          it, selection is advisory and two exhibitors can buy the same booth.
        </li>,
        <li key="assign">
          <strong>Organizer reassignment.</strong> Moving an exhibitor after purchase, which is what
          organizers spend the last fortnight doing.
        </li>,
        <li key="app">
          <strong>Booth numbers in the attendee app.</strong> The exhibitor list in the app has no
          booth field to show, so even a solved floor plan would stop at the dashboard.
        </li>,
      ]}
    />
  );
}
