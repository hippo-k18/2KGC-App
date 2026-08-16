import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { findNav, hrefOf, type NavNode } from '@/lib/nav';

export const dynamic = 'force-dynamic';

/**
 * Every nav entry that is not a real screen resolves here.
 *
 * Two jobs. A `section` node renders an index of its children, so a container
 * is never a dead click. A `placeholder` node renders the gap: what Whova does
 * there, what this repo would have to grow, roughly how big it is, and the
 * §-numbers in `whova-rebuild/research/02-organizer-backend.md` where the
 * detail lives.
 *
 * What it deliberately does *not* render is a table with no rows or a button
 * that does nothing. An organizer who sees an empty grid goes looking for the
 * import button that would fill it, finds nothing, and files a bug against a
 * feature that was never built. Saying "not built, here is why and here is what
 * it costs" takes the same amount of screen and is true.
 *
 * Next.js gives a static segment precedence over a catch-all, so every screen
 * that *is* built simply exists as a real file alongside this one and wins.
 * Anything not in `NAV` at all is a genuine 404.
 */
export default async function NavNodePage({ params }: { params: Promise<{ slug: string[] }> }) {
  await requireOrganizer();

  const { slug } = await params;
  const match = findNav(slug);
  if (!match) notFound();

  const { node, trail } = match;

  return (
    <>
      <p className="crumbs">
        {trail.slice(0, -1).map((n, i) => (
          <span key={n.slug}>
            <Link href={hrefOf(trail.slice(0, i + 1))}>{n.label}</Link>
            {' › '}
          </span>
        ))}
      </p>
      <h1>{node.label}</h1>
      {node.note ? <p className="muted">{node.note}</p> : null}

      {node.kind === 'section' ? (
        <SectionIndex node={node} trail={trail} />
      ) : (
        <Placeholder node={node} />
      )}
    </>
  );
}

/**
 * The nav prose is written with backticks around identifiers and `**` around
 * the two or three claims that matter, because it is read in the source at
 * least as often as in the browser. Twelve lines here is cheaper than either
 * stripping the markers out of `nav.ts` (making it worse to read where it is
 * maintained) or pulling in a markdown dependency to render two constructs.
 */
function Prose({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <p>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

function SectionIndex({ node, trail }: { node: NavNode; trail: NavNode[] }) {
  const children = node.children ?? [];
  const built = children.filter((c) => c.kind === 'implemented').length;

  return (
    <>
      <p className="muted">
        {children.length} entries, {built} of them built. Order and naming are Whova&apos;s (§1),
        not ours.
      </p>
      <ul className="index">
        {children.map((c) => (
          <li key={c.slug}>
            <Link href={hrefOf([...trail, c])}>{c.label}</Link>
            {c.kind === 'implemented' ? null : (
              <span className="tag">{c.kind === 'section' ? 'section' : 'not built'}</span>
            )}
            {c.ours ? <span className="tag ours">ours</span> : null}
            {c.note ? <div className="muted">{c.note}</div> : null}
            {c.kind === 'placeholder' && c.whova ? (
              <div className="muted">
                <Prose text={c.whova} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function Placeholder({ node }: { node: NavNode }) {
  return (
    <>
      <div className="gap">
        <h3>Not built</h3>
        <p>
          This screen exists in the navigation because it exists in Whova&apos;s, and an organizer
          looking for it should find out here that it is missing rather than conclude the console
          hides it somewhere else.
        </p>

        {node.whova ? (
          <>
            <h3>What Whova does here</h3>
            <Prose text={node.whova} />
          </>
        ) : null}

        {node.needs ? (
          <>
            <h3>What it would need here</h3>
            <Prose text={node.needs} />
          </>
        ) : null}

        {node.size ? (
          <>
            <h3>Roughly how big</h3>
            <Prose text={node.size} />
          </>
        ) : null}

        {node.refs ? (
          <>
            <h3>Where to read the detail</h3>
            <p>
              <code>whova-rebuild/research/02-organizer-backend.md</code> {node.refs}
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}
