import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TicketAudience } from '@kgc/shared';
import { listOrders, listTicketTypes, money, recentEmails } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../ui';
import { PUBLIC_PAGE } from './audience-catalogue';

/**
 * The registration page, widget, settings and confirmation screens, for one
 * audience.
 *
 * Whova ships four of these per audience — 1.4/1.5/1.7/1.3 for attendees,
 * 2.7/2.8/registration-settings/2.4 for exhibitors, and an unnumbered set for
 * sponsors — which is twelve screens that differ only in which slice of
 * `ticketTypes` they read. Writing twelve files would guarantee that a column
 * added to one of them is missing from the other eleven within a month, so
 * there are four components here and twelve thin pages that supply copy.
 *
 * ── What is real on each ────────────────────────────────────────────────────
 *
 * The page and settings screens read live tier data and describe rules that are
 * genuinely enforced — sales windows and capacity are evaluated at read time by
 * `apps/web`'s `availability()` and again inside `startCheckout`, so closing a
 * tier closes it for somebody who kept an old page open. The confirmation
 * screen reads `emailLog`, which is written per recipient, so "did their
 * receipt actually send?" has an answer rather than an assumption.
 *
 * The widget screen is the one with nothing behind it, and it says so.
 */

/** Origin of the public site. Separate deployments; the dashboard is told, not clever. */
function publicOrigin(): string {
  return (process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3200').replace(/\/$/, '');
}

const AUDIENCE_LABEL: Record<TicketAudience, string> = {
  attendee: 'attendee',
  exhibitor: 'exhibitor',
  sponsor: 'sponsor',
};

// ---------------------------------------------------------------------------
// Registration page
// ---------------------------------------------------------------------------

export async function AudienceRegistrationPage({
  audience,
  title,
  links,
}: {
  audience: TicketAudience;
  title: string;
  links?: ReactNode[];
}) {
  const noun = AUDIENCE_LABEL[audience];
  const path = PUBLIC_PAGE[audience];
  const tiers = (await listTicketTypes()).filter((t) => t.audience === audience);
  const listed = tiers.filter((t) => t.visible);
  const href = `${publicOrigin()}${path}`;

  return (
    <>
      <PageHeader
        title={title}
        tags={
          <Tag color={listed.length > 0 ? 'green' : 'grey'} fill="outline">
            {listed.length} listed
          </Tag>
        }
        links={[
          <a key="v" href={href} target="_blank" rel="noreferrer">
            View the live page ↗
          </a>,
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          ...(links ?? []),
        ]}
      />

      {listed.length === 0 ? (
        <Banner kind="warning">
          <strong>
            <code>{path}</code> renders, but it has nothing to sell.
          </strong>{' '}
          The page tells a visitor that {noun} packages are not open yet and offers an email
          address, which is the honest thing for it to do — but it is not a registration page until
          a tier is listed.
        </Banner>
      ) : (
        <Banner kind="info">
          <strong>
            This page is live at <code>{path}</code>.
          </strong>{' '}
          Everything on it that is data — the packages, prices, inclusion lists, sold-out state and
          sales windows — is read from <code>ticketTypes</code> on every request. Edit a price in{' '}
          <Link href={ROUTES.createTickets}>Create Tickets</Link> and the page changes on the next
          load, with no deploy.
        </Banner>
      )}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a visitor sees right now</h2>
        <Table
          cols={[
            { key: 'n', label: 'Package', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'o', label: 'Order', className: 'cell-xs' },
            { key: 's', label: 'State', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            <span key="n">
              {t.name}
              {t.featured ? (
                <>
                  {' '}
                  <Tag color="purple" small>
                    featured
                  </Tag>
                </>
              ) : null}
            </span>,
            money(t.priceCents, t.currency),
            t.sortOrder,
            t.visible ? (
              <span key="s">
                In the list
                {typeof t.quantityTotal === 'number' ? (
                  <span className="muted">
                    {' '}
                    · {t.quantitySold}/{t.quantityTotal} sold
                  </span>
                ) : null}
              </span>
            ) : (
              <span key="s" className="muted">
                Hidden — purchasable by direct link only
              </span>
            ),
          ])}
          empty={`No ${noun} packages exist. Create one in Create Tickets with the audience set to ${noun}.`}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does that this does not</h2>
        <p className="body-2">
          Hosts the page with a theme editor — banner image, brand colours, arbitrary content
          sections, a terms checkbox. Ours is a React component in <code>apps/web</code>, so the
          headings and the surrounding argument change with a deploy while the prices change
          instantly. That split is deliberate: the part that costs money to get wrong is the part
          that is editable without a release.
        </p>
        <p className="body-2">
          The genuinely missing piece is a <strong>content editor for the copy</strong>, which is
          Phase 5 of <code>ROADMAP.md</code> and is a content-management project rather than a
          screen. Until it exists, the {noun} pitch on that page is written by whoever last edited{' '}
          <code>apps/web/src/app/tickets/{audience === 'attendee' ? 'page.tsx' : `${audience}/page.tsx`}</code>.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No copy editor and no theming.</strong> Headings, ordering and the argument for
            buying are code.
          </li>
          <li>
            <strong>No preview inside this dashboard.</strong> The link above opens the site, which
            is a separate deployment on port 3200 — the two apps share a database and nothing else.
          </li>
          <li>
            <strong>No terms-acceptance record.</strong> A checkbox is easy; storing who accepted
            which version of the terms, and when, is a legal record and belongs with Release &amp;
            Consent Forms.
          </li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Registration widget
// ---------------------------------------------------------------------------

export async function AudienceRegistrationWidget({
  audience,
  title,
  links,
}: {
  audience: TicketAudience;
  title: string;
  links?: ReactNode[];
}) {
  const noun = AUDIENCE_LABEL[audience];
  const path = PUBLIC_PAGE[audience];

  return (
    <>
      <PageHeader
        title={title}
        tags={<Tag color="grey">No embed</Tag>}
        links={[
          <Link key="p" href={`${path === '/tickets' ? '/tickets/ticket-setup/1-4-registration-pages' : ''}`}>
            Registration Page
          </Link>,
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          ...(links ?? []),
        ].filter(Boolean)}
      />

      <Banner kind="warning">
        <strong>There is no embeddable widget and no snippet to copy.</strong> A code block here
        would be pasted into a real site and render nothing, so there is not one — a copyable code
        block is the most convincing possible lie.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why the need is smaller here</h2>
        <p className="body-2">
          Whova&rsquo;s widget bridges two systems: your website, and their ticketing. This project
          has one — <code>apps/web</code> serves the marketing pages, the agenda and the checkout
          from a single deployment reading a single Firestore database. Anywhere a widget would go,
          a link to <code>{path}</code> goes instead, and it is faster, accessible, and impossible
          to break by upgrading a host page&rsquo;s CSS.
        </p>
        <p className="body-2">
          The case that would genuinely need one for {noun}s is a <em>partner</em> site selling KGC
          packages — an association&rsquo;s events page, a co-marketing partner. That is worth
          building when such a partner exists, and its requirements come from them.
        </p>

        <h2 className="section-header">What it would take, if a partner asked</h2>
        <p className="body-2">
          A public JSON endpoint for the catalogue (there is none — <code>catalogue.ts</code> is{' '}
          <code>server-only</code> and reads with the Admin SDK), an iframe route with a frame
          policy naming permitted origins, and a decision about where checkout opens. The last is
          the awkward one: Stripe&rsquo;s hosted Checkout will not run inside a cross-origin iframe,
          so the buy button has to break out to a top-level navigation — exactly the thing an embed
          was adopted to avoid.
        </p>
        <p className="body-2">
          A <strong>link with a campaign parameter</strong> does most of what a partner actually
          wants, which is credit for the sale. That is{' '}
          <Link href="/tickets/ticket-marketing/campaign-link-tracking">Campaign Link Tracking</Link>
          , and it is built.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No embed snippet, iframe route or script tag.</strong> Nothing in{' '}
            <code>apps/web</code> is designed to render inside another origin.
          </li>
          <li>
            <strong>No public catalogue API.</strong> Every read of <code>ticketTypes</code> is
            server-side with the Admin SDK, and the collection has no{' '}
            <code>firestore.rules</code> match block on purpose.
          </li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Registration settings
// ---------------------------------------------------------------------------

export async function AudienceRegistrationSettings({
  audience,
  title,
  links,
  extraGaps,
}: {
  audience: TicketAudience;
  title: string;
  links?: ReactNode[];
  /** Audience-specific rows for the "settings with no home" table. */
  extraGaps?: [string, string][];
}) {
  const noun = AUDIENCE_LABEL[audience];
  const tiers = (await listTicketTypes()).filter((t) => t.audience === audience);
  const fmt = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

  return (
    <>
      <PageHeader
        title={title}
        tags={<Tag color="blue">{tiers.length} packages</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          ...(links ?? []),
        ]}
      />

      <Banner kind="info">
        <strong>These settings live on the package, not on the event.</strong> Sales windows,
        capacity and visibility are per tier, checked on every catalogue read and again at
        checkout — so closing a package closes it for somebody who kept the page open. Edit them in{' '}
        <Link href={ROUTES.createTickets}>Create Tickets</Link>.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Per-package settings that are enforced</h2>
        <Table
          cols={[
            { key: 'n', label: 'Package', className: 'cell-md' },
            { key: 'o', label: 'Opens', className: 'cell-sm' },
            { key: 'c', label: 'Closes', className: 'cell-sm' },
            { key: 'q', label: 'Capacity', className: 'cell-sm' },
            { key: 'v', label: 'Listing', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            t.name,
            fmt(t.salesOpenAt),
            fmt(t.salesCloseAt),
            typeof t.quantityTotal === 'number' ? (
              <span key="q">
                {t.quantitySold}/{t.quantityTotal}
              </span>
            ) : (
              <span key="q" className="muted">
                unlimited
              </span>
            ),
            t.visible ? (
              <Tag key="v" color="green" small>
                listed
              </Tag>
            ) : (
              <Tag key="v" color="grey" small>
                link only
              </Tag>
            ),
          ])}
          empty={`No ${noun} packages exist yet.`}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Sold out is <code>quantitySold &gt;= quantityTotal</code>, and <code>quantitySold</code>{' '}
          is incremented server-side at fulfilment — not from a client, and not from a count of
          orders that would double-count a partially refunded one. ⚠️ It is a counter, not a
          reservation: two buyers can pass the check and both pay for the last one.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Event-level settings that have no home</h2>
        <Table
          cols={[
            { key: 's', label: 'Setting', className: 'cell-md' },
            { key: 'n', label: 'Where it would have to live', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Waitlist when sold out',
              'A collection of hopefuls plus a rule for who gets released capacity. Sold out today is a dead end with a message on it.',
            ],
            [
              'Transfer to another person',
              'The registration is keyed by a hash of the email address, so a transfer is a new registration and a revoked qrSecret — not an edit. Worth designing before it is needed at the door.',
            ],
            [
              'Refund policy and self-service refunds',
              'Refunds are issued by an organizer from Attendee Orders. Letting a buyer trigger one needs a policy window and an authenticated path that does not exist.',
            ],
            ...(extraGaps ?? []),
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No form on this screen, on purpose.</strong> The fields it would edit belong to
            the package and are edited where the package is. A second editor is a second answer to
            &ldquo;when does this close&rdquo;.
          </li>
          <li>
            <strong>No waitlist, no transfers, no buyer-initiated refunds.</strong> Each is a policy
            decision first and a screen second.
          </li>
        </ul>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirmation emails
// ---------------------------------------------------------------------------

export async function AudienceConfirmationEmails({
  audience,
  title,
  links,
}: {
  audience: TicketAudience;
  title: string;
  links?: ReactNode[];
}) {
  const noun = AUDIENCE_LABEL[audience];
  const [allTiers, orders, all] = await Promise.all([
    listTicketTypes(),
    listOrders(),
    recentEmails(400),
  ]);

  const tiers = allTiers.filter((t) => t.audience === audience);
  const audienceOf = new Map(allTiers.map((t) => [t.id, t.audience]));

  /**
   * `emailLog` carries no ticket type, so the join runs through the order:
   * `emailLog.orderId` → `OrderRow.ticketTypeIds` → the tier's audience. A row
   * with no `orderId` is a bulk message rather than a receipt and is out of
   * scope here by definition.
   *
   * An order whose lines resolve to no known tier is *excluded*, not defaulted
   * to attendee. A deleted tier is the usual cause, and quietly filing its
   * receipts under one audience would be inventing a fact.
   */
  const audienceOrderIds = new Set(
    orders
      .filter((o) => o.ticketTypeIds.some((id) => audienceOf.get(id) === audience))
      .map((o) => o.id),
  );

  const mine = all.filter((e) => e.orderId && audienceOrderIds.has(e.orderId));
  const failed = mine.filter((e) => e.status === 'failed');

  /** Which packages each receipt was for. Rendered per row, and only ours. */
  const packagesFor = (orderId?: string) => {
    const o = orderId ? orders.find((x) => x.id === orderId) : undefined;
    if (!o) return '—';
    return (
      o.ticketNames.filter((_, i) => audienceOf.get(o.ticketTypeIds[i]) === audience).join(', ') ||
      '—'
    );
  };

  return (
    <>
      <PageHeader
        title={title}
        tags={
          failed.length > 0 ? (
            <Tag color="red" fill="solid">
              {failed.length} failed
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              {mine.length} sent
            </Tag>
          )
        }
        links={[
          <Link key="t" href={ROUTES.transactionHistory}>
            Transaction History
          </Link>,
          <Link key="a" href="/tickets/ticket-setup/1-3-confirmation-emails">
            All confirmation emails
          </Link>,
          ...(links ?? []),
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Receipts sent', value: mine.length, sub: `to ${noun} buyers` },
          { label: 'Failed', value: failed.length, sub: failed.length ? 'needs attention' : 'none' },
          { label: 'Packages', value: tiers.length, sub: 'matched by name' },
        ]}
      />

      <Banner kind="info">
        <strong>{noun[0].toUpperCase() + noun.slice(1)} receipts are the same three templates.</strong>{' '}
        A {noun} purchase goes through the same checkout, the same webhook and the same
        `sendPurchaseConfirmation` as an attendee one — so it gets the same claim code and the same
        capability-token order link, and it writes the same per-recipient row to{' '}
        <code>emailLog</code>. There is no separate {noun} template, and inventing one would mean
        two places to break the claim code.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Receipts for {noun} packages</h2>
        <Table
          cols={[
            { key: 'to', label: 'To', className: 'cell-md' },
            { key: 'tt', label: 'Package', className: 'cell-md' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'w', label: 'When', className: 'cell-fill' },
          ]}
          rows={mine.map((e) => [
            e.to,
            packagesFor(e.orderId),
            <Tag
              key="s"
              color={e.status === 'sent' ? 'green' : e.status === 'failed' ? 'red' : 'grey'}
              small
            >
              {e.status}
            </Tag>,
            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {e.at.slice(0, 16).replace('T', ' ')}
              {e.error ? <span style={{ color: '#c0392b' }}> · {e.error}</span> : null}
              {e.reason ? <span> · {e.reason}</span> : null}
            </span>,
          ])}
          empty={`No ${noun} package has been bought yet, so no receipt has been sent for one.`}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No copy editor.</strong> The templates are TypeScript in{' '}
            <code>scripts/src/lib/email.ts</code>, shared by the website and this dashboard because
            neither can import the other. They are code because the confirmation carries the claim
            code that turns a purchase into an account, and a WYSIWYG editor over a message
            containing a credential is a way to accidentally delete the credential.
          </li>
          <li>
            <strong>No {noun}-specific content.</strong> A booth number, a load-in time or a
            sponsorship deliverables checklist would each be genuinely useful in this receipt, and
            none of them exists as data yet.
          </li>
          <li>
            <strong>No resend from this screen.</strong> A failed row names the reason; re-sending
            means fixing the address on the registration and re-running fulfilment.
          </li>
        </ul>
      </Panel>
    </>
  );
}
