import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { GAPS } from '@/lib/gaps';
import { IMPLEMENTED, resolve, type NavNode } from '@/lib/nav';
import { Banner, PageHeader, Panel } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Every nav path that has no screen file of its own.
 *
 * Next gives a static route segment precedence over a catch-all, so the nine
 * real screens win automatically and everything else lands here — which means
 * nothing in a 250-node navigation tree 404s, and an organizer clicking around
 * to see whether their workflow survived the move always gets an answer.
 *
 * Two shapes come out of this file. A node with children renders an index of
 * them, because that is what Whova does when you click a group header. A leaf
 * renders the gap note: what Whova does there, what this repo would need, how
 * big that is. Writing "coming soon" instead would be both less useful and less
 * honest.
 */

function Index({ node, base }: { node: NavNode; base: string }) {
  return (
    <div className="index-grid">
      {(node.children ?? []).map((c) => {
        const href = `${base}/${c.slug}`;
        const built = IMPLEMENTED.has(href.slice(1));
        return (
          <Link key={c.slug} className="index-card" href={href}>
            <span className="index-title">
              {c.title}
              {c.tag ? <span className={`menu-tag ${c.tag}`}>{c.tagLabel ?? c.tag}</span> : null}
            </span>
            <span className="index-sub">
              {built
                ? 'Built — real data'
                : c.children
                  ? `${c.children.length} screens`
                  : 'In the nav, not yet built'}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default async function CatchAll({ params }: { params: Promise<{ slug: string[] }> }) {
  await requireOrganizer();

  const { slug } = await params;
  const found = resolve(slug);
  if (!found) notFound();

  const { node, trail, path } = found;
  const base = `/${slug.join('/')}`;
  const gap = GAPS[path];

  return (
    <>
      <PageHeader
        title={node.title}
        tags={
          node.tag ? <span className={`menu-tag ${node.tag}`}>{node.tagLabel ?? node.tag}</span> : null
        }
        links={
          trail.length
            ? [
                <span key="trail" className="muted">
                  {trail.map((t, i) => (
                    <span key={t.slug}>
                      {i > 0 ? ' › ' : ''}
                      <Link href={`/${slug.slice(0, i + 1).join('/')}`}>{t.title}</Link>
                    </span>
                  ))}
                </span>,
              ]
            : undefined
        }
      />

      <Panel>
        {node.children ? (
          <>
            <p className="body-2" style={{ marginTop: 0 }}>
              {node.children.length} screens under {node.title}.
            </p>
            <Index node={node} base={base} />
          </>
        ) : (
          <>
            <Banner kind="warning">
              <strong>Not built.</strong> This screen exists in the navigation because it exists in
              Whova, and clicking it should tell you where you stand rather than nothing at all.
            </Banner>

            <dl className="gap-grid">
              <dt>Whova does</dt>
              <dd>{gap?.whova ?? `Whova ships a full ${node.title} screen here.`}</dd>
              <dt>We would need</dt>
              <dd>
                {gap?.needs ??
                  'A Firestore collection, an organizer-side editor and a read path in the attendee app. None of the three exists yet.'}
              </dd>
              {gap?.size ? (
                <>
                  <dt>Rough size</dt>
                  <dd>{gap.size}</dd>
                </>
              ) : null}
              <dt>Read</dt>
              <dd>
                {gap?.refs ?? (
                  <>
                    <code>whova-rebuild/research/02-organizer-backend.md</code> for what the real
                    screen does, and <code>whova-rebuild/GAPS-CONSOLE.md</code> for the estimate.
                  </>
                )}
              </dd>
              <dt>Whova&apos;s key</dt>
              <dd>
                <code>{node.name}</code>
              </dd>
            </dl>
          </>
        )}
      </Panel>
    </>
  );
}
