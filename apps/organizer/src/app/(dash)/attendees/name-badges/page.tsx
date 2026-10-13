import Link from 'next/link';
import { CATEGORY_COLOR_HEX } from '@kgc/shared';
import { attendeeCategories } from '@/lib/attendee-categories';
import { UNCATEGORISED, categoryLabel, inCategory } from '@/lib/attendee-categories-core';
import { requireOrganizer } from '@/lib/auth';
import { QR_QUIET_ZONE, badgeQr, listBadgeRows } from '@/lib/badges';
import { requiredConsentGaps } from '@/lib/consents';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, StatTiles, Tag, listParams, paginate } from '../../ui';
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
  const category = typeof sp.category === 'string' ? sp.category : undefined;
  const { page, baseParams } = listParams(sp);

  const [all, { categories }, consents] = await Promise.all([
    listBadgeRows(),
    attendeeCategories(),
    requiredConsentGaps(),
  ]);

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
    if (!inCategory(r, category)) return false;
    if (!needle) return true;
    return [r.name, r.company, r.title, r.ticketType, categoryLabel(categories, r)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const pageRows = paginate(matched, page, PER_PAGE);
  const tickets = [...new Set(printable.map((r) => r.ticketType).filter(Boolean))].sort() as string[];
  const withoutCompany = printable.filter((r) => !r.company).length;
  /*
    A required release nobody has signed, said on the row it belongs to.

    Printed badges are handed over at a desk, and the desk is where somebody can
    still ask. The note is screen-only — `@media print` hides it — because a
    badge worn all day must not announce what its wearer has not signed.
  */
  const unsignedNote = (registrationId: string): string | undefined => {
    const owed = consents.outstanding.get(registrationId);
    return owed?.length ? owed.join(', ') : undefined;
  };
  const unsigned = printable.filter((r) => unsignedNote(r.registrationId)).length;

  const href = (next: { q?: string; ticket?: string; category?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.ticket) p.set('ticket', next.ticket);
    if (next.category) p.set('category', next.category);
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
          position: relative;
          width: 3.5in;
        }
        /* The category, as a band a door volunteer can read from two metres. */
        .badge.has-band { padding-bottom: 0.46in; }
        .badge-band {
          bottom: 0;
          font-size: 13px;
          font-weight: 700;
          left: 0;
          letter-spacing: 1.5px;
          line-height: 0.32in;
          overflow: hidden;
          position: absolute;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
          right: 0;
          text-align: center;
          text-overflow: ellipsis;
          text-transform: uppercase;
          white-space: nowrap;
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
        .badge-unsigned {
          color: var(--kgc-orange, #f68621);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .5px;
          margin-top: 3px;
          text-transform: uppercase;
        }
        @media screen and (max-width: 767px) {
          .badge-sheet { grid-template-columns: minmax(0, 3.5in); }
          .badge { max-width: 100%; }
        }
        @media print {
          @page { margin: 0.4in; }
          /* Screen-only: a badge worn all day must not say what its wearer has
             not signed. The desk has the same note on the sheet it prints from. */
          .badge-unsigned { display: none; }
          body * { visibility: hidden; }
          .badge-sheet, .badge-sheet * { visibility: visible; }
          .badge-sheet { left: 0; position: absolute; top: 0; }
          .badge { break-inside: avoid; border-color: #999; }
        }
      `}</style>

      <PageHeader
        title="Name Badges"
        info={
          <>
            <strong>What the QR code holds</strong>
            <p>
              Only the check-in code. No email or sign-in code is printed. A photographed badge can
              be checked in as that person, and the duplicate shows in the scan log.
            </p>
          </>
        }
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
          ...(consents.forms.length > 0
            ? [
                {
                  label: 'Form not signed',
                  value: unsigned,
                  sub: unsigned > 0 ? 'marked on the badge below' : 'everybody has signed',
                },
              ]
            : []),
        ]}
      />

      <Panel>
        <form method="get" className="toolbar">
          {ticket ? <input type="hidden" name="ticket" value={ticket} /> : null}
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <SearchInput defaultValue={q} placeholder="Name, company, job title, ticket or category" />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={href({ ticket, category })}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="toolbar">
          <Link
            className={`whova-tag-main ${!ticket ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            href={href({ q, category })}
            style={{ textDecoration: 'none' }}
          >
            All tickets ({printable.length})
          </Link>
          {tickets.map((t) => (
            <Link
              key={t}
              className={`whova-tag-main ${t === ticket ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
              href={href({ q, ticket: t, category })}
              style={{ textDecoration: 'none' }}
            >
              {t} ({printable.filter((r) => r.ticketType === t).length})
            </Link>
          ))}
        </div>

        <div className="toolbar">
          <Link
            className={`whova-tag-main ${!category ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            href={href({ q, ticket })}
            style={{ textDecoration: 'none' }}
          >
            All categories
          </Link>
          {[...categories.map((c) => ({ id: c.id, name: c.name })), { id: UNCATEGORISED, name: 'No category' }].map(
            (c) => (
              <Link
                key={c.id}
                className={`whova-tag-main ${c.id === category ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
                href={href({ q, ticket, category: c.id })}
                style={{ textDecoration: 'none' }}
              >
                {c.name} ({printable.filter((r) => inCategory(r, c.id)).length})
              </Link>
            ),
          )}
        </div>

        <p className="body-2">
          Badges are 3.5 × 2.25 inches, two across, {PER_PAGE} to a sheet. Print prints the sheet
          on screen, so page through and print each one. The category prints as a coloured band.
          Turn on background graphics in the print dialog to print the colour.
        </p>

        <div className="badge-sheet">
          {pageRows.map((r) => {
            const qr = badgeQr(r.qrSecret);
            const span = qr.size + QR_QUIET_ZONE * 2;
            const cat = categories.find((c) => c.id === r.categoryId);
            const band = cat ? CATEGORY_COLOR_HEX[cat.color] : undefined;
            return (
              <div className={`badge${cat ? ' has-band' : ''}`} key={r.registrationId}>
                <div className="badge-fields">
                  <div className="badge-name">{r.name}</div>
                  {r.company ? <div className="badge-company">{r.company}</div> : null}
                  {r.title ? <div className="badge-title">{r.title}</div> : null}
                  <div className="badge-ticket">{r.ticketType ?? 'Attendee'}</div>
                  {unsignedNote(r.registrationId) ? (
                    <div className="badge-unsigned" title={unsignedNote(r.registrationId)}>
                      Form not signed
                    </div>
                  ) : null}
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
                {cat && band ? (
                  <div className="badge-band" style={{ background: band.band, color: band.text }}>
                    {cat.name}
                  </div>
                ) : null}
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
