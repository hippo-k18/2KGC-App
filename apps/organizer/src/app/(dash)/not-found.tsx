import Link from 'next/link';
import { NAV, ROUTES, counts } from '@/lib/nav';
import { Banner, PageHeader, Panel } from './ui';

/**
 * The 404, inside the shell.
 *
 * It lives in the `(dash)` group rather than at the root so that a mistyped URL
 * still paints the utility bar, the masthead, the tab strip and the rail. Next's
 * default 404 is a black centred slab; rendered inside this chrome it reads as
 * the dashboard itself having broken, which is a worse lie than the missing
 * page.
 *
 * "Page not found" is not worth saying here. The catch-all at
 * `[...slug]/page.tsx` resolves every node in `nav.ts`, so a path that reaches
 * this file is genuinely outside the tree — and the useful answer is the tree,
 * not the apology. Hence the section index below: it is the same `.index-grid`
 * shape the catch-all renders for a group header, so landing here looks like
 * arriving one level up rather than falling off the product.
 */

export default function DashNotFound() {
  const { total, implemented } = counts();

  return (
    <>
      <PageHeader
        title="No screen at this address"
        links={[
          <Link key="attendees" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="agenda" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="report" href={ROUTES.report}>
            Report
          </Link>,
        ]}
      />

      <Panel>
        <Banner kind="info">
          <div>
            <strong>Nothing is routed here.</strong> This dashboard carries {total} navigation
            paths and every one of them resolves — a section renders an index of its children, a
            leaf renders its screen. So an address that lands on this page is not in the navigation
            at all: a typed URL, an old bookmark, or a record that has since been deleted.
          </div>
        </Banner>

        <h2 className="section-header">Start from a section</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          The nine tabs above, with what is under each. {implemented} of {total} screens read real
          data. Feature search in the dark bar at the top matches any title in the tree.
        </p>

        <div className="index-grid">
          {NAV.map((tab) => (
            <Link key={tab.slug} className="index-card" href={`/${tab.slug}`}>
              <span className="index-title">
                {tab.title}
                {tab.tag ? (
                  <span className={`menu-tag ${tab.tag}`}>{tab.tagLabel ?? tab.tag}</span>
                ) : null}
              </span>
              <span className="index-sub">
                {tab.children ? `${tab.children.length} groups` : 'One screen'}
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
