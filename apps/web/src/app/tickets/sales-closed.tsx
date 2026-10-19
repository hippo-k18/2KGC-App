import { siteEvent } from '@/lib/data';
import { SITE } from '@/lib/site';

/**
 * What every ticket page renders while Marketing > Event Website has ticket
 * sales switched off. Prices are not decided yet, so nothing may show one.
 *
 * Each page checks `ticketSalesOpen()` itself and returns this before it reads
 * the catalogue. A layout cannot do it: Next still renders the page under a
 * layout that drops `children`, and ships that page's data, prices included.
 * The checkout and invoice actions check the same switch, because hiding a form
 * does not stop a post to it.
 */
export async function TicketSalesClosed() {
  const ev = await siteEvent();
  return (
    <section className="band">
      <div className="wrap">
        <div className="checkout checkout-closed">
          <h1 style={{ fontSize: '1.4rem' }}>Tickets are not on sale yet</h1>
          <p>
            Ticket sales for {ev.name} have not opened. Write to{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will tell you
            when they do.
          </p>
        </div>
      </div>
    </section>
  );
}
