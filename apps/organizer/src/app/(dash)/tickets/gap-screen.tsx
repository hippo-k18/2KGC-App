import type { ReactNode } from 'react';
import { Banner, PageHeader, Panel } from '../ui';

/**
 * The shell every unbuilt Tickets screen shares.
 *
 * Fifteen of the exhibitor and sponsor setup screens have no implementation and
 * are not going to grow one by being written out fifteen times. What differs
 * between them is the *content* — what Whova does there, what this repo would
 * need, how big that is — so that is what each page supplies, and the furniture
 * lives here.
 *
 * This deliberately does not reuse the catch-all route&rsquo;s note. The
 * catch-all answers &ldquo;there is no file for this path&rdquo;; these paths
 * have files, because they are the ones an organizer evaluating the move
 * actually clicks, and each earns a specific answer rather than a generic one.
 *
 * Three slots, in the order an organizer reads them: what the real product does
 * (so the gap is measurable), what it would cost us (so it is decidable), and
 * then the flat list of things this screen must not be mistaken for.
 */
export function GapScreen({
  title,
  tags,
  links,
  lead,
  whova,
  needs,
  size,
  refs,
  notBuilt,
}: {
  title: string;
  tags?: ReactNode;
  links?: ReactNode[];
  /** One sentence, in the warning banner. The honest headline. */
  lead: ReactNode;
  whova: ReactNode;
  /** Prose intro to the &ldquo;Not built here&rdquo; list — the missing piece, named. */
  needs: ReactNode;
  size?: ReactNode;
  refs?: ReactNode;
  notBuilt: ReactNode[];
}) {
  return (
    <>
      <PageHeader title={title} tags={tags} links={links} />

      <Banner kind="warning">{lead}</Banner>

      <Panel>
        <h2 className="section-header">What Whova does here</h2>
        <dl className="gap-grid">
          <dt>Whova does</dt>
          <dd>{whova}</dd>
          {size ? (
            <>
              <dt>Rough size</dt>
              <dd>{size}</dd>
            </>
          ) : null}
          {refs ? (
            <>
              <dt>Read</dt>
              <dd>{refs}</dd>
            </>
          ) : null}
        </dl>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">Not built here</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginTop: 0 }}>
          {needs}
        </p>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          {notBuilt}
        </ul>
      </Panel>
    </>
  );
}
