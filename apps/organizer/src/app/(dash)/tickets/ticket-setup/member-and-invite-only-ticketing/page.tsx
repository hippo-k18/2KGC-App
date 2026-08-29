import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › Member & Invite-Only Ticketing.
 *
 * Two different things sharing a nav entry, and they fail differently here.
 *
 * **Invite-only** is nearly free and half-exists: a hidden tier
 * (`visible: false`) stays purchasable by direct link but never renders in the
 * catalogue, which is how a comp rate or a late speaker rate works without a
 * separate code path. That is obscurity, not access control, and the difference
 * matters enough to say on screen — the link is the credential, and links get
 * forwarded.
 *
 * **Member-only** is not close. It means verifying membership against somebody
 * else's system (MemberClicks, iMIS, YourMembership, Neon), and `ROADMAP.md` is
 * right that Whova's four connection guides are documentation pages rather than
 * features. What they document is an integration we do not have.
 */
export default async function MemberAndInviteOnlyTicketingPage() {
  await requireOrganizer();
  const tiers = await listTicketTypes();
  const hidden = tiers.filter((t) => !t.visible);

  return (
    <>
      <PageHeader
        title="Member & Invite-Only Ticketing"
        tags={
          <Tag color={hidden.length > 0 ? 'orange' : 'grey'} fill="outline">
            {hidden.length} hidden {hidden.length === 1 ? 'tier' : 'tiers'}
          </Tag>
        }
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="d" href={ROUTES.discountCodes}>
            Discount Codes
          </Link>,
          <Link key="m" href="/tickets/ticket-setup/memberclicks-connection-guide">
            MemberClicks guide
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>A hidden tier is unlisted, not restricted.</strong> Anyone who has the link can buy
        it, and nothing checks who they are. That is fine for a speaker comp rate circulated by
        email and wrong for anything where the restriction has to hold.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Tiers not shown in the catalogue</h2>
        <Table
          cols={[
            { key: 'n', label: 'Tier', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'a', label: 'Audience', className: 'cell-sm' },
            { key: 't', label: 'Tagline', className: 'cell-fill' },
          ]}
          rows={hidden.map((t) => [t.name, money(t.priceCents, t.currency), t.audience, t.tagline || '—'])}
          empty="Every tier is public. Set visible: false on a ticket type to make it link-only."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The three ways to restrict a ticket, ranked by what we have</h2>
        <Table
          cols={[
            { key: 'w', label: 'Mechanism', className: 'cell-md' },
            { key: 's', label: 'State', className: 'cell-sm' },
            { key: 'n', label: 'What it really gives you', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Hidden tier',
              <Tag key="s" color="green" small>works</Tag>,
              'Unlisted URL. No identity check at all. Good enough for comps circulated by email.',
            ],
            [
              'Promotion code',
              <Tag key="s" color="green" small>works</Tag>,
              'Stripe owns the code, its redemption limit and its expiry. Restricts the price, not the right to attend — and a code with a limit of one is the closest thing to an invite this project has today.',
            ],
            [
              'Membership check',
              <Tag key="s" color="grey" small>absent</Tag>,
              'Verify the buyer against an association database before allowing the purchase. Needs an API credential for someone else’s system, a lookup on the public form, and an answer for what happens when their API is down mid-sale.',
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No invite list and no per-person invite code.</strong> Whova mails a
            single-use code to a named list and tracks who redeemed it. Ours has one shared code per
            promotion, held by Stripe.
          </li>
          <li>
            <strong>No membership integration.</strong> There is no credential for any AMS in this
            repo, and the four connection-guide screens document a capability that does not exist.
          </li>
          <li>
            <strong>No allowlisted email domains.</strong> The cheapest real restriction — sell this
            tier only to <code>@cornell.edu</code> — would be a field on the ticket type and a check
            in <code>startCheckout</code>, and would be worth doing before any AMS integration.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
