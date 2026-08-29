import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { QR_QUIET_ZONE, badgeQr, listBadgeRows } from '@/lib/badges';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, StatTiles, Tag, listParams, paginate } from '../../ui';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Name Badges.
 *
 * A printable sheet, not a designer. Whova sells a badge designer with ten
 * templates and a compatible-printer list; what an event actually needs the
 * night before is a stack of badges that scan, and that is one fixed template
 * rendered by the browser's own print path — no PDF library, no image
 * pipeline, nothing to install on the laptop at the desk.
 *
 * ── What is on the badge, and what is deliberately not ──────────────────────
 *
 * Name, company, job title, ticket type, and the QR. The QR payload is the
 * registration's `qrSecret` and nothing else — no envelope, no JSON, no
 * prefix — because the door scanner compares it byte-for-byte against
 * `registrations.qrSecret` and any wrapper would simply fail to match.
 *
 * The deeper reason is the threat model in AGENTS.md, which is worth restating
 * because a badge is the one artefact here that gets photographed by strangers.
 * An **email** on a badge turns a hall into a thousand harvestable addresses. A
 * **`registrationId`** looks opaque and is not: it is `reg_` + sha256(email), so
 * anyone holding an address can compute it. A **uid** joins one photograph to a
 * profile, a message history and a saved agenda. `qrSecret` is a bearer
 * credential for attendance alone — photograph it and you can be checked in as
 * that person, which is detected rather than silent, because the real
 * attendee's scan then returns "already checked in at 09:12 at Front desk 1".
 * That trade is accepted; the other three are not, and `BadgeRow` does not
 * carry the fields that would let this template make the mistake.
 *
 * ── Why the QR is inline SVG ────────────────────────────────────────────────
 *
 * Vector, so it is exactly as sharp as the printer is: a rasterised QR at the
 * wrong DPI grows half-modules along the edges, and a handheld reader in a
 * badly lit foyer is precisely where that starts to matter. It also means the
 * sheet is one self-contained HTML document with no image requests, so it
 * prints identically from a laptop with no network — which is the state of
 * every registration desk ever built.
 */
export default async function NameBadgesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const ticket = typeof sp.ticket === 'string' ? sp.ticket : undefined;
  const { page, baseParams } = listParams(sp);

  const all = await listBadgeRows();

  /**
   * Cancelled and transferred registrations are excluded outright rather than
   * shown greyed out. A badge sheet is a physical thing that gets printed and
   * put in a box; a refunded attendee's badge sitting in that box is a badge
   * somebody eventually hands over.
   */
  const printable = all.filter((r) => r.status === 'active');

  const needle = (q ?? '').trim().toLowerCase();
  const matched = printable.filter((r) => {
    if (ticket && (r.ticketType ?? '') !== ticket) return false;
    if (!needle) return true;
    return [r.name, r.company, r.title, r.ticketType]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const pageRows = paginate(matched, page, PER_PAGE);
  const tickets = [...new Set(printable.map((r) => r.ticketType).filter(Boolean))].sort() as string[];
  const withoutCompany = printable.filter((r) => !r.company).length;

  const href = (next: { q?: string; ticket?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.ticket) p.set('ticket', next.ticket);
    const s = p.toString();
    return s ? `?${s}` : '/attendees/name-badges';
  };

  return (
    <>
      {/*
        Hiding everything else by visibility rather than `display: none` keeps
        the sheet's own layout intact — a display-none ancestor collapses the
        grid and the badges reflow into a single column mid-print.
      */}
      <style>{`
        .badge-sheet { display: grid; grid-template-columns: repeat(2, 3.5in); gap: 0.25in; }
        .badge {
          border: 1px solid var(--hairline);
          border-radius: 6px;
          box-sizing: border-box;
          display: flex;
          height: 2.25in;
          overflow: hidden;
          padding: 0.18in;
          width: 3.5in;
        }
        .badge-fields { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
        .badge-name {
          font-size: 21px;
          font-weight: 600;
          line-height: 1.15;
          overflow-wrap: anywhere;
        }
        .badge-company { font-size: 14px; font-weight: 500; margin-top: 4px; overflow-wrap: anywhere; }
        .badge-title { font-size: 11px; margin-top: 2px; overflow-wrap: anywhere; }
        .badge-ticket {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          margin-top: auto;
          text-transform: uppercase;
        }
        .badge-qr { flex: 0 0 1.1in; margin-left: 0.12in; }
        @media print {
          @page { margin: 0.4in; }
          body * { visibility: hidden; }
          .badge-sheet, .badge-sheet * { visibility: visible; }
          .badge-sheet { left: 0; position: absolute; top: 0; }
          .badge { break-inside: avoid; border-color: #999; }
        }
      `}</style>

      <PageHeader
        title="Name Badges"
        tags={<Tag color="blue">{matched.length} to print</Tag>}
        actions={<PrintButton count={pageRows.length} />}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href={ROUTES.checkIn}>
            Check-in
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Printable',
            value: printable.length,
            sub: `${all.length - printable.length} cancelled or transferred, excluded`,
          },
          { label: 'On this sheet', value: pageRows.length, sub: `page ${page}, ${PER_PAGE} per sheet` },
          {
            label: 'No company',
            value: withoutCompany,
            sub: withoutCompany > 0 ? 'badge prints name only' : 'every badge has one',
          },
        ]}
      />

      <Panel>
        <Banner kind="info">
          <strong>The QR is the attendee&rsquo;s <code>qrSecret</code>, alone.</strong> That is what
          the door scanner matches on, so a badge printed from this sheet works whether or not the
          attendee ever opens the app — which is the point of printing them. It is a bearer
          credential for <em>attendance</em>: a photograph of it can be checked in as that person,
          and the duplicate shows up in the scan log rather than passing silently. No email, no
          attendee id and no sign-in code is printed anywhere on the badge, and none of them is
          loaded onto this page to begin with.
        </Banner>

        <form method="get" className="toolbar">
          {ticket ? <input type="hidden" name="ticket" value={ticket} /> : null}
          <SearchInput defaultValue={q} placeholder="Enter name, company or job title" />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={href({ ticket })}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="toolbar">
          <Link
            className={`whova-tag-main ${!ticket ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            href={href({ q })}
            style={{ textDecoration: 'none' }}
          >
            All tickets ({printable.length})
          </Link>
          {tickets.map((t) => (
            <Link
              key={t}
              className={`whova-tag-main ${t === ticket ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
              href={href({ q, ticket: t })}
              style={{ textDecoration: 'none' }}
            >
              {t} ({printable.filter((r) => r.ticketType === t).length})
            </Link>
          ))}
        </div>

        <p className="body-2">
          Badges are 3.5 × 2.25 inches, two across, {PER_PAGE} to a sheet — the size that fits a
          standard clip holder without folding. Printing takes whichever sheet is on screen, so
          page through and print each one; the pager is a query parameter, so the sheet is also a
          link you can send to whoever is standing at the printer.
        </p>

        <div className="badge-sheet">
          {pageRows.map((r) => {
            const qr = badgeQr(r.qrSecret);
            const span = qr.size + QR_QUIET_ZONE * 2;
            return (
              <div className="badge" key={r.registrationId}>
                <div className="badge-fields">
                  <div className="badge-name">{r.name}</div>
                  {r.company ? <div className="badge-company">{r.company}</div> : null}
                  {r.title ? <div className="badge-title">{r.title}</div> : null}
                  <div className="badge-ticket">{r.ticketType ?? 'Attendee'}</div>
                </div>
                {/*
                  `shape-rendering: crispEdges` matters on screen, where a
                  module can land between device pixels and antialias into a
                  grey smear that a camera then reads as ambiguous. On paper the
                  printer resolves it, but the sheet is proofread on screen.
                */}
                <svg
                  className="badge-qr"
                  viewBox={`0 0 ${span} ${span}`}
                  role="img"
                  aria-label={`Check-in code for ${r.name}`}
                  shapeRendering="crispEdges"
                >
                  <rect width={span} height={span} fill="#fff" />
                  <path
                    d={qr.d}
                    fill="#000"
                    transform={`translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})`}
                  />
                </svg>
              </div>
            );
          })}
        </div>

        <Pagination total={matched.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A badge designer.</strong> Whova has ten templates, a drag-and-drop layout and
            segment fields printable on the badge. This is one fixed template.{' '}
            <code>badgeTemplates</code> is modelled and nothing writes it — and note it is not the
            same shape as this sheet: it holds raw ZPL for a thermal printer, which a browser
            cannot emit. A designer would have to produce both, or the two paths drift.
          </li>
          <li>
            <strong>Print-on-demand at check-in.</strong> A paid add-on in Whova, and here{' '}
            <code>badgePrintJobs</code> is modelled and inert. The scan that would trigger a print
            already works; nothing listens to it, and a hall printer needs a driver on a machine
            this dashboard cannot reach from a browser tab.
          </li>
          <li>
            <strong>No sign-in code on the badge.</strong> <code>claimCode</code> describes itself
            as printable, and it is left off on purpose: it is a <em>sign-in</em> credential while
            the QR grants attendance only. Both on one card means a photograph of a badge signs
            somebody in as its owner, which is a strictly larger threat than the one AGENTS.md
            accepts. Reinstating it is a decision about that trade, not a missing field.
          </li>
          <li>
            <strong>Sheet alignment for pre-cut badge stock.</strong> Sizes here are inches in CSS
            and the browser&rsquo;s own margins; matching a specific Avery layout means calibration
            against a real printer, which cannot be done from a comment.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
