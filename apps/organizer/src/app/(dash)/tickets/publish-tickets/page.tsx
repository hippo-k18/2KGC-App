import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listOrders, listTicketTypes, money } from '@/lib/commerce';
import { getForm } from '@/lib/question-forms';
import { stripeEnabled, stripeIsLive } from '@/lib/stripe';
import { publicUrl } from '@/lib/webpages';
import { emailEnabled } from '@kgc/scripts/src/lib/email';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Publish Tickets.
 *
 * ── There is no publish button, and that is the finding, not the gap ───────
 *
 * Whova has a publish step because Whova hosts your registration page: nothing
 * is reachable until you press it. Here, `visible: true` on a ticket type puts
 * it on the public page at the next request, with no deploy and no switch — so
 * a button labelled &ldquo;Publish&rdquo; would either do nothing or be a
 * fourth place that decides whether a tier is on sale. Three is already one
 * too many.
 *
 * What Whova&rsquo;s publish step is actually *for* is the moment before: the
 * last check that the thing about to become reachable is not embarrassing or
 * broken. That is computable, and it is what this screen does.
 *
 * ── Blocking versus advisory ───────────────────────────────────────────────
 *
 * A blocker means somebody will hand over money and something will go wrong: no
 * confirmation email, no payment processor, a free ticket published by mistake.
 * A warning means it will work and look unfinished. Mixing the two into one
 * &ldquo;ready&rdquo; light is how a real blocker gets ignored.
 */

interface Check {
  label: string;
  detail: React.ReactNode;
  state: 'pass' | 'warn' | 'fail';
}

export default async function PublishTicketsPage() {
  await requireOrganizer();

  const [tickets, orders, form] = await Promise.all([
    listTicketTypes(),
    listOrders(),
    getForm('attendee'),
  ]);

  const attendee = tickets.filter((t) => t.audience === 'attendee');
  const listed = attendee.filter((t) => t.visible);
  const now = Date.now();

  const openNow = listed.filter(
    (t) =>
      !(t.salesOpenAt && new Date(t.salesOpenAt).getTime() > now) &&
      !(t.salesCloseAt && new Date(t.salesCloseAt).getTime() < now) &&
      !(typeof t.quantityTotal === 'number' && t.quantitySold >= t.quantityTotal),
  );

  const freeAndVisible = listed.filter((t) => t.priceCents === 0);
  const noTagline = listed.filter((t) => !t.tagline);
  const noIncludes = listed.filter((t) => (t.includes ?? []).length === 0);
  const demoOrders = orders.filter((o) => o.channel === 'demo').length;

  const checks: Check[] = [
    {
      label: 'A ticket is on sale',
      state: openNow.length > 0 ? 'pass' : 'fail',
      detail:
        openNow.length > 0 ? (
          <>
            {openNow.length} of {attendee.length} attendee tiers are listed, inside their sales
            window and not sold out.
          </>
        ) : (
          <>
            Nothing is buyable right now. Every tier is hidden, outside its window, or at capacity —{' '}
            <Link href="/tickets/ticket-setup/1-1-create-tickets">check the catalogue</Link>.
          </>
        ),
    },
    {
      label: 'A payment processor is configured',
      state: stripeEnabled() ? (stripeIsLive() ? 'pass' : 'warn') : 'fail',
      detail: !stripeEnabled() ? (
        <>
          <code>STRIPE_SECRET_KEY</code> is unset. Purchases complete as clearly-labelled demos
          taking no money — fine for a walkthrough, not for selling.
        </>
      ) : stripeIsLive() ? (
        <>Live key. Cards will be charged.</>
      ) : (
        <>
          Test key (<code>sk_test_…</code>). Real cards are declined; test cards succeed and take no
          money. This is the right state for everything except selling.
        </>
      ),
    },
    {
      label: 'Confirmation email can send',
      state: emailEnabled() ? 'pass' : 'fail',
      detail: emailEnabled() ? (
        <>
          <code>RESEND_API_KEY</code> is set. Receipts carry the claim code that turns a purchase
          into an app account.
        </>
      ) : (
        <>
          No provider configured. Every send is logged as <code>skipped</code>, so a buyer gets a
          ticket and <strong>no claim code</strong> — which is a support ticket per sale.
        </>
      ),
    },
    {
      label: 'No free ticket is publicly listed',
      state: freeAndVisible.length === 0 ? 'pass' : 'fail',
      detail:
        freeAndVisible.length === 0 ? (
          <>Nothing on the public page is priced at zero.</>
        ) : (
          <>
            {freeAndVisible.map((t) => t.name).join(', ')} {freeAndVisible.length === 1 ? 'is' : 'are'}{' '}
            listed at no charge. A comp rate belongs hidden — it stays purchasable by direct link.
          </>
        ),
    },
    {
      label: 'Registration questions',
      state: form.fields.length === 0 ? 'warn' : form.active ? 'pass' : 'warn',
      detail:
        form.fields.length === 0 ? (
          <>
            No questions are asked. Dietary requirements and accessibility needs are catering and
            venue decisions with a deadline —{' '}
            <Link href="/tickets/ticket-setup/1-2-question-forms">worth asking before you sell</Link>
            , because collecting them afterwards means chasing everybody.
          </>
        ) : form.active ? (
          <>{form.fields.length} questions are asked before checkout.</>
        ) : (
          <>
            {form.fields.length} questions are written but switched off, so nobody is asked. Turn
            them on before the first sale or the answers are lost for everybody who buys early.
          </>
        ),
    },
    {
      label: 'Every listed tier explains itself',
      state: noTagline.length + noIncludes.length === 0 ? 'pass' : 'warn',
      detail:
        noTagline.length + noIncludes.length === 0 ? (
          <>Each listed tier has a tagline and an inclusion list.</>
        ) : (
          <>
            {noIncludes.length > 0 && (
              <>
                {noIncludes.length} listed{' '}
                {noIncludes.length === 1 ? 'tier has' : 'tiers have'} no inclusion list, so the page
                shows a price with nothing under it.{' '}
              </>
            )}
            {noTagline.length > 0 && <>{noTagline.length} have no tagline.</>}
          </>
        ),
    },
    {
      label: 'Demo orders are distinguishable',
      state: demoOrders === 0 ? 'pass' : 'warn',
      detail:
        demoOrders === 0 ? (
          <>No demo orders in the ledger.</>
        ) : (
          <>
            {demoOrders} demo {demoOrders === 1 ? 'order is' : 'orders are'} in the ledger. They
            carry <code>channel: &apos;demo&apos;</code> and are excluded from every takings figure
            — real, visible, and not counted as money.
          </>
        ),
    },
  ];

  const blockers = checks.filter((c) => c.state === 'fail');
  const warnings = checks.filter((c) => c.state === 'warn');

  return (
    <>
      <PageHeader
        title="Publish Tickets"
        tags={
          blockers.length > 0 ? (
            <Tag color="red" fill="solid">
              {blockers.length} blocking
            </Tag>
          ) : warnings.length > 0 ? (
            <Tag color="orange">{warnings.length} to look at</Tag>
          ) : (
            <Tag color="green" fill="outline">
              ready
            </Tag>
          )
        }
        links={[
          <a key="v" href={publicUrl('/tickets')} target="_blank" rel="noreferrer">
            The live page ↗
          </a>,
          <Link key="c" href="/tickets/ticket-setup/1-1-create-tickets">
            Create Tickets
          </Link>,
          <Link key="p" href="/publish">
            Publish the event
          </Link>,
        ]}
      />

      <Banner kind={blockers.length > 0 ? 'warning' : 'info'}>
        <strong>There is no publish button, and that is not a missing feature.</strong> A tier with{' '}
        <code>visible: true</code> is on the public page at the next request — no deploy, no switch.
        A button here would either do nothing or become a fourth place that decides whether a ticket
        is on sale.{' '}
        {blockers.length > 0 ? (
          <>
            What matters is the {blockers.length} blocking{' '}
            {blockers.length === 1 ? 'problem' : 'problems'} below: somebody will hand over money and
            something will go wrong.
          </>
        ) : (
          <>The checks below are the thing a publish step is actually for.</>
        )}
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Buyable now', value: openNow.length, sub: `of ${attendee.length} tiers` },
          { label: 'Blocking', value: blockers.length, sub: blockers.length ? 'money will go wrong' : 'none' },
          { label: 'Warnings', value: warnings.length, sub: 'works, looks unfinished' },
          {
            label: 'Cheapest on sale',
            value: openNow.length
              ? money(Math.min(...openNow.map((t) => t.priceCents)), openNow[0].currency)
              : '—',
            sub: 'entry price a visitor sees',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Pre-flight</h2>
        <Table
          cols={[
            { key: 's', label: '', className: 'cell-xs' },
            { key: 'c', label: 'Check', className: 'cell-md' },
            { key: 'd', label: '', className: 'cell-fill' },
          ]}
          rows={checks.map((c) => [
            <Tag
              key="s"
              small
              color={c.state === 'pass' ? 'green' : c.state === 'warn' ? 'orange' : 'red'}
            >
              {c.state === 'pass' ? 'ok' : c.state === 'warn' ? 'look' : 'stop'}
            </Tag>,
            <strong key="c">{c.label}</strong>,
            <span key="d" style={{ fontSize: 13 }}>
              {c.detail}
            </span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          <strong>stop</strong> means somebody will pay and something will go wrong.{' '}
          <strong>look</strong> means it will work and look unfinished. Collapsing the two into one
          &ldquo;ready&rdquo; light is how a real blocker gets clicked past.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a visitor can buy right now</h2>
        <Table
          cols={[
            { key: 'n', label: 'Tier', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'q', label: 'Left', className: 'cell-sm' },
            { key: 'w', label: 'Window', className: 'cell-fill' },
          ]}
          rows={openNow.map((t) => [
            t.name,
            money(t.priceCents, t.currency),
            typeof t.quantityTotal === 'number' ? (
              <span key="q">{t.quantityTotal - t.quantitySold}</span>
            ) : (
              <span key="q" className="muted">
                unlimited
              </span>
            ),
            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {t.salesOpenAt || t.salesCloseAt
                ? `${t.salesOpenAt?.slice(0, 10) ?? 'now'} → ${t.salesCloseAt?.slice(0, 10) ?? 'no end'}`
                : 'always'}
            </span>,
          ])}
          empty="Nothing is buyable. That is the blocking problem above, not an empty table."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No scheduled go-live.</strong> &ldquo;Open sales at 09:00 on Monday&rdquo; is
            already expressible — set <code>salesOpenAt</code> on the tier, which is evaluated at
            read time on every request rather than by a job that has to run.
          </li>
          <li>
            <strong>No preview of an unpublished page.</strong> A hidden tier is purchasable by
            direct link, which is the closest thing and is genuinely useful for a negotiated rate.
            There is no staging copy of the site.
          </li>
          <li>
            <strong>Nothing here checks the exhibitor or sponsor pages.</strong> They have their own
            catalogues and their own readiness, and folding three audiences into one light would
            hide a blocker on the one you are not looking at.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
