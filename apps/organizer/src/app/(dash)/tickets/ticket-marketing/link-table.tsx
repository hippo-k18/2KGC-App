import type { LinkRow } from '@/lib/campaigns';
import { money } from '@/lib/commerce';
import { Table, Tag } from '../../ui';
import { toggleLinkAction } from './link-actions';

/**
 * The tracked-link table, shared by the three screens that show one.
 *
 * ── Conversion is absent, not zero, when nothing has clicked ────────────────
 *
 * "0%" on a link nobody has opened reads as a failed campaign. It is an unsent
 * one, and the difference decides whether an organizer rewrites the copy or
 * checks whether the email actually went out.
 *
 * ── Revenue here is net of refunds ──────────────────────────────────────────
 *
 * A referral contest paid out on gross would reward a link that brought in
 * three purchases and three refunds. `netCents` is what the event kept.
 */
export function LinkTable({
  links,
  publicOrigin,
  showOwner,
  emptyMessage,
}: {
  links: LinkRow[];
  publicOrigin: string;
  showOwner?: boolean;
  emptyMessage: string;
}) {
  return (
    <Table
      cols={[
        { key: 'l', label: 'Link', className: 'cell-fill' },
        ...(showOwner ? [{ key: 'o', label: 'Credit', className: 'cell-md' }] : []),
        { key: 'c', label: 'Clicks', className: 'cell-sm' },
        { key: 'n', label: 'Orders', className: 'cell-sm' },
        { key: 'r', label: 'Net', className: 'cell-sm' },
        { key: 'a', label: '', className: 'cell-sm' },
      ]}
      rows={links.map((l) => [
        <div key="l">
          <div>
            <a href={`${publicOrigin}/r/${l.code}`} target="_blank" rel="noreferrer">
              /r/{l.code}
            </a>{' '}
            {!l.active && (
              <Tag color="grey" small>
                retired
              </Tag>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {l.label} → {l.destination}
            {l.channel ? ` · ${l.channel}` : ''}
          </div>
        </div>,

        ...(showOwner
          ? [
              <span key="o" style={{ fontSize: 12 }}>
                {l.owner || <span className="muted">unattributed</span>}
              </span>,
            ]
          : []),

        <div key="c">
          <strong>{l.clicks}</strong>
          {l.lastClickedAt ? (
            <div className="muted" style={{ fontSize: 11 }}>
              last {l.lastClickedAt.slice(0, 10)}
            </div>
          ) : null}
        </div>,

        <div key="n">
          {l.orders}
          {l.conversion !== undefined ? (
            <div className="muted" style={{ fontSize: 11 }}>
              {(l.conversion * 100).toFixed(1)}%
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11 }}>
              no clicks yet
            </div>
          )}
        </div>,

        <strong key="r">{l.revenueCents > 0 ? money(l.revenueCents, l.currency) : '—'}</strong>,

        /*
          Retiring, not deleting. The clicks and the attributed orders are the
          only record of what a campaign achieved, and deleting the link deletes
          the explanation for a month's sales. A retired link 404s.
        */
        <form key="a" action={toggleLinkAction}>
          <input type="hidden" name="code" value={l.code} />
          <input type="hidden" name="active" value={l.active ? '0' : '1'} />
          <button type="submit" className="linkish">
            {l.active ? 'Retire' : 'Restore'}
          </button>
        </form>,
      ])}
      empty={emptyMessage}
    />
  );
}

/** The pages worth pointing a campaign at. Kept here so all three screens agree. */
export const DESTINATIONS = [
  { path: '/tickets', label: 'Attendee tickets' },
  { path: '/tickets/exhibitor', label: 'Exhibitor packages' },
  { path: '/tickets/sponsor', label: 'Sponsorship' },
  { path: '/agenda', label: 'Agenda' },
  { path: '/speakers', label: 'Speakers' },
  { path: '/', label: 'Home' },
  { path: '/call-for-posters', label: 'Call for posters' },
  { path: '/startup-pitch', label: 'Startup pitch' },
];
