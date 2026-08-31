import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { pageReadiness, publicUrl, type PageReadiness } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../ui';

/**
 * One screen, rendered for each public page: Agenda, Speakers, Sponsors.
 *
 * ── Why this is a readiness report and not a page builder ───────────────────
 *
 * Whova's Event Webpages generate hosted pages from event data on a whova.com
 * URL, plus an embed snippet for your real site. **We already have those
 * pages** — apps/web renders /agenda, /speakers and /sponsor from the same
 * Firestore documents, on knowledgegraph.tech, in the conference's own design.
 *
 * So a WYSIWYG editor here would be work spent making the product worse. What
 * an organizer actually needs to know about a public page is whether it is
 * embarrassing yet: a speakers page with eleven missing headshots, an agenda
 * with four sessions in no room. That is computable, and it is what this shows.
 */
export async function WebpageScreen({
  which,
  title,
  editorHref,
  editorLabel,
  notBuilt,
}: {
  which: 'agenda' | 'speakers' | 'sponsors';
  title: string;
  editorHref: string;
  editorLabel: string;
  notBuilt: string[];
}) {
  await requireOrganizer();
  const readiness = await pageReadiness();
  const p: PageReadiness = readiness[which];

  const url = publicUrl(p.path);
  const clean = p.problems.length === 0;
  const pct = p.total === 0 ? 0 : Math.round((p.published / p.total) * 100);

  return (
    <>
      <PageHeader
        title={title}
        tags={
          // A page carrying a note is not "ready" — it is not rendering these
          // records at all, and a green tag would say the opposite.
          p.note ? (
            <Tag color="grey" fill="outline">
              not this collection
            </Tag>
          ) : clean ? (
            <Tag color="green" fill="outline">
              ready
            </Tag>
          ) : (
            <Tag color="orange" fill="outline">
              {p.problems.reduce((n, x) => n + x.count, 0)} things to fix
            </Tag>
          )
        }
        actions={
          <a href={url} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live page ↗
          </a>
        }
        links={[
          <Link key="e" href={editorHref}>
            {editorLabel}
          </Link>,
        ]}
      />

      {p.note ? (
        <Banner kind="warning">
          This page is <strong>already live</strong> at{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
          , but it is <strong>not</strong> rendered from the records you edit in {editorLabel}.{' '}
          {p.note} Editing them changes nothing a visitor sees until that source is switched over.
        </Banner>
      ) : (
        <Banner kind="info">
          This page is <strong>already live</strong> at{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
          , rendered from the same records you edit in {editorLabel}. There is nothing to publish and
          no cache to clear — a change there appears here on the next page load.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Published', value: p.published, sub: p.total === p.published ? 'all of them' : `of ${p.total}` },
          { label: 'Ready', value: clean ? 'yes' : 'not yet', sub: clean ? 'nothing missing' : 'see below' },
          { label: 'Completeness', value: `${pct}%`, sub: 'published share' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Would a visitor notice anything missing?</h2>
        {clean ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No. Every record behind this page has what the page renders.
          </p>
        ) : (
          <>
            <ProgressBar pct={pct} />
            <Table
              cols={[
                { key: 'p', label: 'Problem', className: 'cell-fill' },
                { key: 'n', label: 'Records', className: 'cell-sm' },
                { key: 'a', label: '', className: 'cell-sm' },
              ]}
              rows={p.problems.map((x) => [
                x.label,
                x.count,
                <Link key="a" href={editorHref} style={{ fontSize: 12 }}>
                  Fix in {editorLabel}
                </Link>,
              ])}
            />
            {/*
              Ordered by how visible each problem is to a stranger, not by count.
              A missing headshot leaves a hole in a grid; a missing company line
              is invisible unless you are looking for it.
            */}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
              Listed by how obvious each one is to a visitor, not by how many there are.
            </p>
          </>
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          {notBuilt.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            <strong>An embed snippet.</strong> Whova gives you an iframe to paste into a WordPress
            site. Ours <em>is</em> the site, so there is nothing to embed it into.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
