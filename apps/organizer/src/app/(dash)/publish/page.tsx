import Link from 'next/link';
import { PAGE_CONTENT_KEYS, type PageContentKey } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { pageReadiness, publicUrl } from '@/lib/webpages';
import { listTicketTypes, salesSummary } from '@/lib/commerce';
import { listSpeakers } from '@/lib/data';
import { readPageContentMeta } from '@/lib/page-content';
import { findConflicts } from '@/lib/conflicts';
import { ROUTES } from '@/lib/nav';
import { PageHeader, Panel, StatTiles, Table, Tag } from '../ui';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Publish — the pre-flight check.
 *
 * ── There is no publish flag, and that was checked rather than assumed ──────
 *
 * Whova's Publish tab flips a hosted event from private to public. The question
 * for us is whether an equivalent switch exists to be built, and the answer is
 * no: `SETTINGS_KEYS` in `@kgc/shared` has three bags — `branding`, `access`
 * and `logistics` — and none of them gates a surface. `apps/web` is a deployed
 * marketing site whose pages render whatever Firestore holds, and the app reads
 * the same documents. What actually decides whether the public sees a thing is
 * per record and already exists: `SessionDoc.status`, `TicketTypeDoc.visible`,
 * `ExhibitorDoc.status`, `DocumentDoc.visibleToTicketTypes`.
 *
 * Adding a global `published` flag on top of those would be a fourth kind of
 * hidden — and the failure mode is the one that matters: a switch that has to
 * be read by two installs neither of which currently reads settings at request
 * time, so the day somebody flips it off the site keeps serving. A switch that
 * does not switch anything is worse than no switch.
 *
 * ── So this is the checklist that button implied ────────────────────────────
 *
 * Every row is computed from live data and links to the screen that fixes it.
 * Blocking means the event does not work; the rest are things a visitor would
 * notice. It is the one screen worth opening the week before doors open.
 */

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  href: string;
  /** A blocker stops the event working; a warning is worth knowing. */
  blocking: boolean;
}

/** The three public pages whose copy goes stale between editions. */
const COPY_PAGES: { key: PageContentKey; title: string }[] = [
  { key: PAGE_CONTENT_KEYS.codeOfConduct, title: 'Code of conduct' },
  { key: PAGE_CONTENT_KEYS.callForPosters, title: 'Call for posters' },
  { key: PAGE_CONTENT_KEYS.startupPitch, title: 'Startup pitch' },
];

const WEBSITE_COPY = '/content/basics/website-copy';

export default async function PublishPage() {
  await requireOrganizer();

  const [pages, tickets, conflicts, speakers, sales, copyMeta] = await Promise.all([
    pageReadiness(),
    listTicketTypes(),
    findConflicts(),
    listSpeakers(),
    salesSummary(),
    Promise.all(COPY_PAGES.map((p) => readPageContentMeta(p.key))),
  ]);

  const sellable = tickets.filter((t) => t.visible);
  const noBio = speakers.filter((s) => !s.hasBio);
  /*
   * A page whose copy has never been saved for this edition is rendering last
   * edition's compiled-in constant — which is where the PLACEHOLDER deadlines
   * and the submission URLs still carrying `2026` live. `readPageContentMeta`
   * returns nothing for a document stamped with another `eventId`, so an
   * absent `updatedAt` is exactly "nobody has confirmed this for 2027".
   */
  const unconfirmedCopy = COPY_PAGES.filter((_, i) => !copyMeta[i].updatedAt);

  const checks: Check[] = [
    {
      label: 'Tickets are on sale',
      ok: sellable.length > 0,
      detail:
        sellable.length > 0
          ? `${sellable.length} ticket ${sellable.length === 1 ? 'type is' : 'types are'} visible on the website.`
          : 'No visible ticket types, so the website has nothing to sell and will show an error.',
      href: ROUTES.createTickets,
      blocking: true,
    },
    {
      label: 'Payments are configured',
      ok: stripeEnabled(),
      detail: stripeEnabled()
        ? stripeIsLive()
          ? 'Stripe is in live mode. Real cards will be charged.'
          : 'Stripe is in TEST mode, no real money will move. Switch keys before doors open.'
        : /*
           * ⚠️ This used to read "the website completes purchases as
           * clearly-labelled tests and takes no money", which described the
           * demo-mode branch deleted in August 2026. The purchase path fails
           * closed now: /tickets disables the button and the server action
           * refuses before it reads a tier. Saying otherwise on the one screen
           * an organizer opens to check readiness is the exact defect this
           * dashboard keeps having.
           */
          'No Stripe key is set, so the website refuses every purchase. Nothing can be bought until one is supplied.',
      href: ROUTES.ordersSummary,
      blocking: true,
    },
    {
      label: 'A purchase has completed end to end',
      ok: sales.paidOrders > 0,
      detail:
        sales.paidOrders > 0
          ? `${sales.paidOrders} paid ${sales.paidOrders === 1 ? 'order has' : 'orders have'} been fulfilled, so checkout and the webhook both work.`
          : 'No order has ever been fulfilled. Until one has, nothing has proved that the Stripe webhook reaches this project.',
      href: ROUTES.ordersSummary,
      blocking: false,
    },
    {
      label: 'The programme has no clashes',
      ok: conflicts.errors === 0,
      detail:
        conflicts.errors === 0
          ? `${conflicts.sessionsChecked} sessions checked, nothing double-booked.`
          : `${conflicts.errors} to fix. A speaker or room booked twice, or a published session with no room.`,
      href: ROUTES.conflictCheck,
      blocking: true,
    },
    {
      label: 'The agenda is published',
      ok: pages.agenda.published > 0 && pages.agenda.problems.length === 0,
      detail:
        pages.agenda.published === 0
          ? 'Nothing is published, so /agenda is empty.'
          : pages.agenda.problems.length === 0
            ? `${pages.agenda.published} sessions live.`
            : `${pages.agenda.published} live, but ${pages.agenda.problems.map((p) => `${p.count} ${p.label}`).join(', ')}.`,
      href: ROUTES.sessionManager,
      blocking: false,
    },
    {
      label: 'Speakers look finished',
      ok: pages.speakers.problems.length === 0,
      detail:
        pages.speakers.problems.length === 0
          ? `${pages.speakers.published} speakers, nothing the public page prints is missing.`
          : pages.speakers.problems.map((p) => `${p.count} ${p.label}`).join(', ') + '.',
      href: ROUTES.messageSpeakers,
      blocking: false,
    },
    {
      /*
       * Separate from the row above because they are about different surfaces.
       * `/speakers` renders a portrait, a name, a company and a job title and
       * stops there; the bio only appears on the speaker's profile in the app.
       * Folding them together would send an organizer to chase a bio for a page
       * that never shows one.
       */
      label: 'Speakers have a bio for the app',
      ok: noBio.length === 0,
      detail:
        noBio.length === 0
          ? `All ${speakers.length} speakers have a bio.`
          : `${noBio.length} of ${speakers.length} have none, so their profile in the app is a name and a job title.`,
      href: ROUTES.speakerManager,
      blocking: false,
    },
    {
      label: 'Sponsors look finished',
      ok: pages.sponsors.problems.length === 0,
      detail:
        pages.sponsors.problems.length === 0
          ? `${pages.sponsors.published} sponsors, nothing missing.`
          : pages.sponsors.problems.map((p) => `${p.count} ${p.label}`).join(', ') + '.',
      href: ROUTES.messageSponsors,
      blocking: false,
    },
    {
      label: 'Website copy is confirmed for this edition',
      ok: unconfirmedCopy.length === 0,
      detail:
        unconfirmedCopy.length === 0
          ? 'The reporting address, the submission links and the deadlines have all been saved for 2027.'
          : `${unconfirmedCopy.map((p) => p.title).join(', ')} still ${unconfirmedCopy.length === 1 ? 'renders' : 'render'} last edition’s built-in text, including its deadlines and submission links.`,
      href: WEBSITE_COPY,
      blocking: false,
    },
  ];

  const blockers = checks.filter((c) => !c.ok && c.blocking);
  const warnings = checks.filter((c) => !c.ok && !c.blocking);

  return (
    <>
      <PageHeader
        title="Publish"
        info={
          <>
            <strong>Nothing here to switch on</strong>
            <p>
              The website is deployed and the app reads the same database, so a session goes public
              the moment its status is <code>published</code>. This is the check that a publish
              button would have implied.
            </p>
          </>
        }
        tags={
          blockers.length === 0 ? (
            <Tag color="green" fill="solid">
              ready
            </Tag>
          ) : (
            <Tag color="red" fill="solid">
              {blockers.length} blocking
            </Tag>
          )
        }
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live site ↗
          </a>
        }
        links={[
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
          <Link key="c" href={WEBSITE_COPY}>
            Website Copy
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Blocking', value: blockers.length, sub: 'stop the event working' },
          { label: 'Worth fixing', value: warnings.length, sub: 'a visitor would notice' },
          { label: 'Passing', value: checks.filter((c) => c.ok).length, sub: `of ${checks.length}` },
        ]}
      />

      <Panel>
        <Table
          cols={[
            { key: 's', label: '', className: 'cell-xs' },
            { key: 'l', label: 'Check', className: 'cell-md' },
            { key: 'd', label: 'Detail', className: 'cell-fill' },
            { key: 'a', label: '', className: 'cell-sm' },
          ]}
          rows={checks.map((c) => [
            <Tag
              key="s"
              color={c.ok ? 'green' : c.blocking ? 'red' : 'orange'}
              fill="outline"
              small
            >
              {c.ok ? 'ok' : c.blocking ? 'fix' : 'check'}
            </Tag>,
            <strong key="l" style={{ fontSize: 13 }}>
              {c.label}
            </strong>,
            <span key="d" style={{ fontSize: 13 }}>
              {c.detail}
            </span>,
            c.ok ? (
              <span key="a" className="muted">
                —
              </span>
            ) : (
              <Link key="a" href={c.href} style={{ fontSize: 12 }}>
                Fix
              </Link>
            ),
          ])}
        />
      </Panel>
    </>
  );
}
