import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireOrganizer } from '@/lib/auth';
import { Banner, PageHeader, Panel, Table } from './ui';

/**
 * The shape every connection guide shares.
 *
 * ── These are documentation screens in Whova too ────────────────────────────
 *
 * "MemberClicks connection guide", "iMIS connection guide", "Export to AMS/CRM"
 * — nine nav entries across Tickets and Attendees that are *help articles* in
 * Whova's own product, not features. Whova's version tells you which fields map
 * to which and where to paste an API key.
 *
 * So reproducing them as honest documentation is not a shortcut; it is what
 * they are. What ours say is different, because our answer is different: none
 * of these integrations exist here, and for most of them the useful reply is
 * "export a CSV and import it there", which genuinely works today.
 *
 * ⚠️ The one thing these must never do is imply a connection exists. An
 * organizer who believes MemberClicks is syncing will stop checking, and the
 * first sign otherwise is a member who paid the member rate and is not on the
 * list.
 */
export async function IntegrationGuide({
  title,
  vendor,
  whatItIs,
  whovaDoes,
  ourAnswer,
  steps,
  effort,
  links,
}: {
  title: string;
  vendor: string;
  whatItIs: string;
  whovaDoes: string;
  ourAnswer: ReactNode;
  /** The workaround that actually works today, in order. */
  steps?: ReactNode[];
  effort: string;
  links?: { label: string; href: string }[];
}) {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title={title}
        links={(links ?? []).map((l, i) => (
          <Link key={i} href={l.href}>
            {l.label}
          </Link>
        ))}
      />

      <Banner kind="warning">
        <strong>Nothing is connected to {vendor}.</strong> This is a guide, not an integration —
        the same as it is in Whova, except that theirs ends in a setup form and ours ends in a
        workaround. Do not assume anything is syncing.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What {vendor} is</h2>
        <p className="body-2">{whatItIs}</p>

        <h2 className="section-header">What Whova does with it</h2>
        <p className="body-2">{whovaDoes}</p>

        <h2 className="section-header">What we do instead</h2>
        <div className="body-2">{ourAnswer}</div>
      </Panel>

      {steps && steps.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>How to do it today</h2>
          <ol className="body-2" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>If we built it properly</h2>
        <Table
          cols={[
            { key: 'k', label: '', className: 'cell-md' },
            { key: 'v', label: '', className: 'cell-fill' },
          ]}
          rows={[
            ['Rough size', effort],
            [
              'Worth it when',
              'KGC actually uses this system. Building an integration against a product nobody here has an account for is the most expensive way to write untested code.',
            ],
            [
              'Prerequisite',
              'A generic importer with column mapping and row-level errors — ROADMAP.md Phase 2. Every one of these guides collapses into "map these columns" once that exists.',
            ],
          ]}
        />
      </Panel>
    </>
  );
}
