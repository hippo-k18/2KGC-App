import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { pageReadiness, publicUrl } from '@/lib/webpages';
import { listTicketTypes } from '@/lib/commerce';
import { findConflicts } from '@/lib/conflicts';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../ui';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Publish — the pre-flight check.
 *
 * Whova's Publish tab is a button that makes your event live. Ours has nothing
 * to switch on: the website is already deployed, the app already reads
 * Firestore, and a session becomes public the moment its status is `published`.
 *
 * So this is the more useful thing that button implies — **is the event
 * actually ready to be seen?** Every check below is computed from real data and
 * links to the screen that fixes it. It is the one screen an organizer should
 * open the week before doors open.
 */

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  href: string;
  /** A blocker stops the event working; a warning is worth knowing. */
  blocking: boolean;
}

export default async function PublishPage() {
  await requireOrganizer();

  const [pages, tickets, conflicts] = await Promise.all([
    pageReadiness(),
    listTicketTypes(),
    findConflicts(),
  ]);

  const sellable = tickets.filter((t) => t.visible);

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
          : 'Stripe is in TEST mode — no real money will move. Switch keys before doors open.'
        : 'No Stripe key. The website completes purchases as clearly-labelled tests and takes no money.',
      href: ROUTES.ordersSummary,
      blocking: true,
    },
    {
      label: 'The programme has no clashes',
      ok: conflicts.errors === 0,
      detail:
        conflicts.errors === 0
          ? `${conflicts.sessionsChecked} sessions checked, nothing double-booked.`
          : `${conflicts.errors} to fix — a speaker or room booked twice, or a published session with no room.`,
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
          ? `${pages.speakers.published} speakers, nothing missing.`
          : pages.speakers.problems.map((p) => `${p.count} ${p.label}`).join(', ') + '.',
      href: ROUTES.messageSpeakers,
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
  ];

  const blockers = checks.filter((c) => !c.ok && c.blocking);
  const warnings = checks.filter((c) => !c.ok && !c.blocking);

  return (
    <>
      <PageHeader
        title="Publish"
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
      />

      <Banner kind="info">
        <strong>There is no publish button, because there is nothing to switch on.</strong> The
        website is deployed, the app reads the same database, and a session goes public the moment
        its status is <code>published</code>. This is the check that button would have implied.
      </Banner>

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

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not checked here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Whether rules and indexes are deployed.</strong> They are written and tested
            against the emulator but have never been pushed to the real project — see AGENTS.md.
            Nothing in this dashboard can tell you the state of the live project.
          </li>
          <li>
            <strong>Whether the Stripe webhook works.</strong> It has never received a live event.
            <code> SETUP-PAYMENTS.md</code> §4 closes that in about ten minutes and it should happen
            before any real money does.
          </li>
          <li>
            <strong>Whether anyone can actually install the app.</strong> Distribution is Expo Go
            and TestFlight, not the app stores.
          </li>
        </ul>
      </Panel>
    </>
  );
}
