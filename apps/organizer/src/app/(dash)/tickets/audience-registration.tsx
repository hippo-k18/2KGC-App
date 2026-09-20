import Link from 'next/link';
import type { ReactNode } from 'react';
import { publicSiteOrigin, type TicketAudience } from '@kgc/shared';
import { listOrders, listTicketTypes, money, recentEmails } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../ui';
import { PUBLIC_PAGE } from './audience-catalogue';
import { wrapCol } from './wrap-col';

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

const AUDIENCE_LABEL: Record<TicketAudience, string> = {
  attendee: 'attendee',
  exhibitor: 'exhibitor',
  sponsor: 'sponsor',
};

/**
 * Where each audience's registration-page screen lives in this dashboard.
 *
 * The widget screen used to build this link as `audience === 'attendee' ? path
 * : ''`, so on the exhibitor and sponsor copies it rendered an anchor with an
 * empty `href` — a link that reloads whatever page you are already on. Whova's
 * numbering means the three screens have unrelated paths, so they have to be
 * named rather than derived.
 */
const REGISTRATION_PAGE: Record<TicketAudience, string> = {
  attendee: '/tickets/ticket-setup/1-4-registration-pages',
  exhibitor: '/tickets/exhibitor-ticket-setup/2-7-registration-page',
  sponsor: '/tickets/sponsor-ticket-setup/registration-page',
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
  const href = `${publicSiteOrigin()}${path}`;

  return (
    <>
      <PageHeader
        title={title}
        info={
          <>
            <strong>What updates on this page</strong>
            <p>
              Packages, prices, inclusion lists, sold-out state and sales windows update as soon as
              they are edited in Create Tickets. Headings and other wording cannot be edited from
              the dashboard yet.
            </p>
          </>
        }
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

      {listed.length === 0 && (
        <Banner kind="warning">
          <strong>
            <code>{path}</code> is live and has nothing to sell.
          </strong>{' '}
          Visitors see a contact email address instead of a package. List a tier in{' '}
          <Link href={ROUTES.createTickets}>Create Tickets</Link> to open sales.
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
                Hidden: purchasable by direct link only
              </span>
            ),
          ])}
          empty={
            <NotInputted
              what={`${noun} packages`}
              compact
              action={
                <Link
                  className="btn btn-primary"
                  href={`${ROUTES.createTickets}?audience=${audience}`}
                >
                  Create one
                </Link>
              }
            />
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
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
        info={
          <>
            <strong>An embeddable widget is not available yet</strong>
            <p>Link to the registration page instead.</p>
          </>
        }
        tags={<Tag color="grey">No embed</Tag>}
        links={[
          <Link key="p" href={REGISTRATION_PAGE[audience]}>
            Registration Page
          </Link>,
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          ...(links ?? []),
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What to put on a partner&rsquo;s site</h2>
        <p className="body-2">
          A link to the {noun} registration page, with a tracked code on it so the partner can be
          credited for what it brings in.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'What', className: 'cell-md' },
            { key: 'v', label: 'Use this', className: 'cell-fill' },
          ]}
          rows={wrapCol([
            [
              'Plain link',
              <a key="v" href={`${publicSiteOrigin()}${path}`} target="_blank" rel="noreferrer">
                {publicSiteOrigin()}
                {path}
              </a>,
            ],
            [
              'Credited link',
              <span key="v">
                Give the partner their own tracked link on{' '}
                <Link href="/tickets/ticket-marketing/campaign-link-tracking">
                  Campaign Link Tracking
                </Link>
                . Clicks are counted, and a purchase within thirty days is credited to the link.
              </span>,
            ],
          ], 1)}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
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
}: {
  audience: TicketAudience;
  title: string;
  links?: ReactNode[];
}) {
  const noun = AUDIENCE_LABEL[audience];
  const tiers = (await listTicketTypes()).filter((t) => t.audience === audience);
  // The event's wall clock, not the UTC instant — see `TicketTypeRow`.
  const fmt = (local?: string) => (local ? local.slice(0, 10) : 'Always');

  return (
    <>
      <PageHeader
        title={title}
        info={
          <>
            <strong>These settings are set per package</strong>
            <p>
              Sales windows, capacity and visibility belong to each package. Edit them in{' '}
              <Link href={ROUTES.createTickets}>Create Tickets</Link>.
            </p>
          </>
        }
        tags={<Tag color="blue">{tiers.length} packages</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          ...(links ?? []),
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Per-package settings</h2>
        {tiers.length === 0 ? (
          <NotInputted what={`${noun} packages`} compact />
        ) : (
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
              fmt(t.salesOpenAtLocal),
              fmt(t.salesCloseAtLocal),
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
          />
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          A package sells out when the number sold reaches its capacity. Seats are not held during
          checkout, so two buyers at the same moment can both get the last one.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
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
        info={
          <>
            <strong>One set of templates, shared by every audience</strong>
            <p>
              A {noun} purchase sends the same receipt as an attendee one, with the same claim
              code. The wording cannot be edited from the dashboard yet.
            </p>
          </>
        }
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

      {failed.length > 0 && (
        <Banner kind="danger">
          <strong>
            {failed.length} {failed.length === 1 ? 'receipt' : 'receipts'} did not reach the buyer.
          </strong>{' '}
          Each failed row below names the reason. The buyer has paid and has no claim code, so
          they cannot create their account until the address is corrected and the receipt is sent
          again.
        </Banner>
      )}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Receipts for {noun} packages</h2>
        {mine.length === 0 ? (
          <NotInputted what={`${noun} receipts`} compact />
        ) : (
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
          />
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
