import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { DEFAULT_LIST_ID, listRegistrations, listStations, recentCheckIns } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { Banner, NotBuilt, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Self Check-in.
 *
 * ── This one is absent by decision, not by backlog ──────────────────────────
 *
 * Whova publishes a self-check-in URL and a printable QR poster: an attendee
 * scans the poster on arrival and checks themselves in. Building that here
 * means letting a client write under `checkInLists`, and `firestore.rules`
 * denies exactly that write to every client including organizers — with a test
 * naming the guarantee — precisely so that attendance cannot be self-asserted.
 * The console writes it with the Admin SDK and bypasses rules entirely.
 *
 * So the honest note is not "we ran out of time". It is that the door scanner
 * and self check-in disagree about what a check-in means: one is a fact
 * witnessed by a member of staff, the other is a claim made by whoever is
 * holding a phone. Opening the rule is a decision about which of those the
 * headcount is, and it should be made deliberately rather than by an agent
 * building the screen that assumes it.
 */
export default async function SelfCheckInPage() {
  await requireOrganizer();

  // Single `where('eventId', '==', …)` per collection and no `orderBy` beside
  // it: a composite index this repo does not declare would pass on the emulator
  // and fail live with `failed-precondition`. Counting happens in memory.
  const [registrations, stations] = await Promise.all([listRegistrations(), listStations()]);
  const rows = registrations.map((r) => r.row);
  const { total: checkedIn } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);
  const active = rows.filter((r) => r.status === 'active').length;

  return (
    <>
      <PageHeader
        title="Self Check-in"
        tags={<Tag color="grey">not built</Tag>}
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="k" href="/attendees/check-in-and-checkout/kiosk-check-in">
            Kiosk Check-in
          </Link>,
        ]}
      />

      <Banner kind="danger">
        <strong>Attendees cannot check themselves in, and that is enforced.</strong> Every write
        under <code>checkInLists</code>, <code>scanEvents</code> and <code>checkInStations</code> is
        denied to every client by <code>firestore.rules</code>, with a test asserting it. There is
        no page to enable, no toggle here that would do anything, and no partially-working version
        of this behind a flag.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Checked in', value: checkedIn, sub: 'all of them by a member of staff' },
          { label: 'Active registrations', value: active, sub: 'the denominator at the door' },
          { label: 'Self check-ins', value: 0, sub: 'the rule denies the write' },
        ]}
      />

      <Panel>
        <h2 className="section-header">What it would actually take</h2>
        <p className="body-2">
          Not a rule change on its own. A public URL that accepts a scan is a URL anyone can open,
          so the thing it accepts has to be a credential — which is <code>qrSecret</code>, and{' '}
          <code>qrSecret</code> is a long-lived bearer token that AGENTS.md accepts precisely
          <em> because</em> stealing it only gets you checked in as somebody who is then told
          &ldquo;already checked in at 09:12 at Front desk 1&rdquo;. Remove the member of staff and
          that detection disappears with them: the real attendee arrives, is told they are already
          in, and nobody is standing there to ask why.
        </p>
        <p className="body-2">
          The workable shape is a trusted server rather than a client — a route in{' '}
          <code>apps/web</code>, which already holds Admin credentials for the ticketing path, that
          rate-limits by address and writes the same idempotent{' '}
          <code>checkIns/{'{registrationId}'}</code> document. That keeps the rule closed, keeps
          the write in one place, and makes the poster a link rather than a new client. It is
          perhaps two days. It is still the decision above.
        </p>
      </Panel>

      <NotBuilt
        whova="A self-check-in URL plus a printable QR poster attendees scan on arrival, feeding the same check-in counts as the desk."
        needs="A trusted-server route that accepts a scan, and a decision about whether an unwitnessed scan counts as attendance. The rules deny the client write on purpose."
        size="~2 days once the decision is made"
        refs="firestore.rules and AGENTS.md, “Security model” — “Attendees cannot check themselves in”"
      />

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>The poster.</strong> Trivial once there is a URL to encode — the QR encoder used
            by <Link href="/attendees/name-badges">Name Badges</Link> would draw it — and pointless
            before then, because a poster that scans to a page which cannot write is worse than no
            poster.
          </li>
          <li>
            <strong>Rate limiting and abuse controls.</strong> A public check-in endpoint is
            enumerable if it leaks a difference between a valid and an invalid code. Nothing here
            does that work today.
          </li>
          <li>
            <strong>Session self check-in.</strong> A separate screen and a separate problem — the
            scanner writes event-door check-ins only. See{' '}
            <Link href="/attendees/check-in-and-checkout/session-self-check-in">
              Session Self Check-in
            </Link>
            .
          </li>
        </ul>
      </Panel>
    </>
  );
}
