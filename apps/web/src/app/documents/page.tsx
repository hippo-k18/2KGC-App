import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicDocuments, listPublicPages, siteVisibility, type PublicDocument } from '@/lib/data';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Documents',
  description:
    'Handouts, maps and travel notes for the Knowledge Graph Conference 2027.',
};

/**
 * Rendered once and reused for up to a minute, rather than from scratch on
 * every visit. Handouts and pages change when an organizer publishes one.
 *
 * Every page on this site was `force-dynamic`, so nothing was ever cached by
 * anybody: the agenda took 0.81 to 0.95 seconds to first byte on the live site
 * against 0.06 for a page that read nothing. No visitor now pays for a query
 * another visitor has already made.
 *
 * Thirty seconds and not sixty, because this window sits on top of the one in
 * `shared()` and the two add up. See `SHARED_SECONDS` in `lib/data.ts`: thirty
 * over thirty is a change on the site inside a minute, which is what an
 * organizer who saves and switches tab is waiting for.
 */
export const revalidate = 30;

/**
 * `/documents` — the handouts, for anyone.
 *
 * Whova calls this an "artifact webpage": the decks, posters and white papers
 * published so somebody who missed the talk can still read it. `documents` has
 * been a real collection with a real editor since August; nothing outside the
 * app rendered a single row of it.
 *
 * ── The one thing that must not go wrong here ───────────────────────────────
 *
 * `DocumentDoc.visibleToTicketTypes` restricts a document to holders of a
 * ticket type. Some of these records are workshop datasets that were paid for.
 * The obvious way to build this page — render the collection, mark the
 * restricted rows, hide them with CSS or behind a sign-in prompt — publishes
 * every one of them: the URL is in the HTML whether or not a browser draws it,
 * and these are links to files hosted elsewhere, so a leak is permanent and
 * this repo cannot revoke it.
 *
 * So the filter is in `listPublicDocuments()`, on the server, and it is not a
 * parameter: a restricted document never reaches this component at all. This
 * page has no branch for one because it can never hold one. If you find
 * yourself writing `visibleToTicketTypes` anywhere in this file, something has
 * gone wrong upstream.
 *
 * ── Every link points off-site, and the page says so ────────────────────────
 *
 * Nothing in this repo uploads a file — `DocumentDoc`'s own header says the
 * `url` is a link an organizer pasted, and file upload is a known gap rather
 * than an oversight. So each card prints the host it will send you to, and the
 * links carry `rel="noreferrer noopener"` like every other outbound link on
 * this site. Presenting a third-party CDN as though it were ours would be
 * exactly the "claims a capability it does not have" defect AGENTS.md counts.
 */

/**
 * The label under the title.
 *
 * `kind` is the organizer's own classification and is worth surfacing: "PDF"
 * versus "Video" changes whether somebody taps it on conference Wi-Fi. Spelled
 * out here rather than upper-casing the stored value, because `pdf` upper-cases
 * correctly and `slides` does not.
 */
const KIND_LABEL: Record<PublicDocument['kind'], string> = {
  pdf: 'PDF',
  slides: 'Slides',
  video: 'Video',
  link: 'Link',
};

export default async function DocumentsPage() {
  /*
   * The pages an organizer wrote themselves, listed beside the handouts because
   * a visitor looking for "where do I park" does not know whether the answer is
   * a PDF somebody uploaded or a page somebody typed. Each has its own address
   * at `/{slug}` and this is the index of them.
   */
  const [documents, pages, show] = await Promise.all([
    listPublicDocuments(),
    listPublicPages(),
    siteVisibility(),
  ]);

  return (
    <>
      <section>
        <div className="wrap">
          <h1>Documents</h1>
          <p className="lede">
            Maps, travel notes and handouts for {SITE.shortName} {SITE.year}.
          </p>
        </div>
      </section>

      {pages.length > 0 && (
        <section>
          <div className="wrap">
            <h2>Event information</h2>
            <ul className="doc-list">
              {pages.map((p) => (
                <li className="doc-card" key={p.id}>
                  <span className="tag">Page</span>
                  <div className="doc-body">
                    <h3>
                      <Link href={`/${p.slug}`}>{p.title}</Link>
                    </h3>
                    {p.summary && <p className="doc-desc">{p.summary}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="tint">
        <div className="wrap">
          {documents.length === 0 ? (
            /*
              The honest empty state. Most of the year there is nothing to hand
              out, and this is what the page looks like then — the treatment
              `/exhibitors` and `/sponsor` both give an empty collection, rather
              than a heading over nothing.
            */
            <>
              <h2>Nothing published yet</h2>
              <p>
                Handouts are added as the programme firms up.
                {show.agenda && (
                  <>
                    {' '}
                    The <Link href="/agenda">agenda</Link> is the thing to watch in the meantime.
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h2>
                {documents.length} {documents.length === 1 ? 'document' : 'documents'}
              </h2>

              <ul className="doc-list">
                {documents.map((d) => (
                  <li className="doc-card" key={d.id}>
                    <span className="tag">{KIND_LABEL[d.kind] ?? KIND_LABEL.link}</span>
                    <div className="doc-body">
                      <h3>
                        <a href={d.url} target="_blank" rel="noreferrer noopener">
                          {d.title}
                        </a>
                      </h3>
                      {d.description && <p className="doc-desc">{d.description}</p>}
                      {/*
                        Where the click actually goes. `listPublicDocuments()`
                        drops any row whose `url` will not parse, so a host is
                        present on everything that reaches here — but the guard
                        stays, because an empty string in a `<span>` is a stray
                        bullet nobody would notice in review.
                      */}
                      {d.host && <p className="doc-host">{d.host}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  );
}
