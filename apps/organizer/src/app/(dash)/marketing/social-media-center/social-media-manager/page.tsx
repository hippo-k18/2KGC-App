import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { money } from '@/lib/commerce';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Social Media Center › Social Media Manager.
 *
 * ── This screen holds no copy of its own, and now holds numbers instead ─────
 *
 * Tools › App Adoption › Social Media writes the posts, keyed to the real
 * adoption figure, with character counts. Whova has two entry points to one
 * job; duplicating the copy here would give us two that drift, and the one an
 * organizer edits would be whichever they happened to open.
 *
 * What this screen can own is the half the copy screen cannot: whether any of
 * it worked. Every social link created on Social Sharing carries a `channel`
 * and is counted by the `/r/{code}` redirect itself, with purchases attributed
 * through `OrderDoc.campaignCode` — so "did LinkedIn do anything" is a real
 * question with a real answer, and none of it waits on a Cloud Function.
 *
 * It creates nothing. The builder lives on Social Sharing; a second copy of the
 * form would be a second place for the open-redirect check to drift out of.
 */
export default async function SocialMediaManagerPage() {
  await requireOrganizer();

  const links = await listLinks();
  const origin = publicSiteOrigin();

  // A social link is one that names the platform it was posted on. A campaign
  // link with no channel is an email or a partner placement, and belongs to the
  // screens that own those.
  const social = links.filter((l) => l.channel && l.channel !== 'partner');

  const byChannel = [...new Set(social.map((l) => l.channel))]
    .map((channel) => {
      const here = social.filter((l) => l.channel === channel);
      return {
        channel,
        links: here.length,
        clicks: here.reduce((n, l) => n + l.clicks, 0),
        orders: here.reduce((n, l) => n + l.orders, 0),
        revenueCents: here.reduce((n, l) => n + l.revenueCents, 0),
        currency: here.find((l) => l.revenueCents > 0)?.currency ?? 'usd',
      };
    })
    .sort((a, b) => b.clicks - a.clicks || a.channel.localeCompare(b.channel));

  const clicks = social.reduce((n, l) => n + l.clicks, 0);
  const orders = social.reduce((n, l) => n + l.orders, 0);
  const revenue = social.reduce((n, l) => n + l.revenueCents, 0);
  const currency = social.find((l) => l.revenueCents > 0)?.currency ?? 'usd';

  return (
    <>
      <PageHeader
        title="Social Media Manager"
        info={
          <>
            <strong>Nothing here posts for you</strong>
            <p>
              Connecting an account would mean this dashboard holding OAuth tokens behind a shared
              passphrase, so anyone who could open Marketing could post as the conference. The posts
              are written under App Adoption and pasted by a person.
            </p>
          </>
        }
        tags={
          social.length > 0 ? (
            <Tag color="green" fill="outline">
              {byChannel.length} {byChannel.length === 1 ? 'channel' : 'channels'} measured
            </Tag>
          ) : (
            <Tag color="grey" fill="outline">
              nothing tracked yet
            </Tag>
          )
        }
        actions={
          <Link href="/tools/app-adoption/social-media" className="whova-btn-main secondary">
            Go to the post copy
          </Link>
        }
        links={[
          <Link key="s" href="/tickets/ticket-marketing/social-sharing">
            Social sharing links
          </Link>,
          <Link key="c" href="/marketing/social-media-center/content-library">
            Content library
          </Link>,
          <Link key="g" href="/tools/app-adoption/downloadable-graphics">
            Downloadable graphics
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Social links',
            value: social.length,
            sub: social.length === 0 ? 'not inputted yet' : `across ${byChannel.length} channels`,
          },
          { label: 'Clicks', value: clicks, sub: 'counted by the redirect' },
          {
            label: 'Orders credited',
            value: orders,
            sub: clicks > 0 ? `${Math.round((orders / clicks) * 100)}% of clicks` : 'no clicks yet',
          },
          { label: 'Revenue credited', value: money(revenue, currency), sub: 'net of refunds' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Which channel did anything</h2>
        <Table
          cols={[
            { key: 'c', label: 'Channel', className: 'cell-md' },
            { key: 'l', label: 'Links', className: 'cell-sm' },
            { key: 'k', label: 'Clicks', className: 'cell-sm' },
            { key: 'o', label: 'Orders', className: 'cell-sm' },
            { key: 'r', label: 'Net', className: 'cell-sm' },
          ]}
          rows={byChannel.map((c) => [
            c.channel,
            c.links,
            c.clicks,
            c.orders,
            c.revenueCents > 0 ? money(c.revenueCents, c.currency) : <span className="muted">—</span>,
          ])}
          empty={
            <NotInputted
              what="social links"
              compact
              action={
                <Link className="btn btn-primary" href="/tickets/ticket-marketing/social-sharing">
                  Create one
                </Link>
              }
            />
          }
        />
      </Panel>

      {social.length > 0 ? (
        <Panel style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Every social link</h2>
          <Table
            cols={[
              { key: 'l', label: 'Link', className: 'cell-fill' },
              { key: 'c', label: 'Channel', className: 'cell-sm' },
              { key: 'k', label: 'Clicks', className: 'cell-sm' },
              { key: 'w', label: 'Last click', className: 'cell-md' },
            ]}
            rows={social.map((l) => [
              <span key="l">
                <a href={`${origin}/r/${l.code}`} target="_blank" rel="noreferrer">
                  /r/{l.code}
                </a>
                {!l.active ? (
                  <>
                    {' '}
                    <Tag color="grey" small>
                      retired
                    </Tag>
                  </>
                ) : null}
                <div className="muted" style={{ fontSize: 11 }}>
                  {l.label} → {l.destination}
                </div>
              </span>,
              l.channel,
              l.clicks,
              l.lastClickedAt ? (
                l.lastClickedAt.slice(0, 10)
              ) : (
                <span key="w" className="muted">
                  never
                </span>
              ),
            ])}
            empty={<NotInputted what="social links" compact />}
          />
        </Panel>
      ) : null}

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Connected accounts.</strong> No OAuth to any platform. The dashboard signs in
            with a shared passphrase and no per-person identity, so an audit log would record the
            passphrase rather than the person who posted.
          </li>
          <li>
            <strong>Scheduling and a queue.</strong> A queued post fires whether or not anybody is
            awake to stop it, and the posts most worth queueing — &ldquo;doors are open&rdquo; — are
            the ones most likely to need pulling. The same argument is recorded against scheduled
            announcements and scheduled bulk email.
          </li>
          <li>
            <strong>Likes, reposts and reach.</strong> Those come from the platform APIs, which need
            the connection above. Clicks and purchases are ours and are counted; impressions are
            not.
          </li>
          <li>
            <strong>Hashtag monitoring.</strong> There is no social wall to pull tagged posts into —
            see{' '}
            <Link href="/marketing/social-wall/social-wall-customization">
              Social Wall Customization
            </Link>
            .
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
