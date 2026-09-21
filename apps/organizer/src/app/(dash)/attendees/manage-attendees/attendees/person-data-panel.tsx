import Link from 'next/link';
import type { ReactNode } from 'react';
import { collectPerson, heldRows, resolvePerson } from '@/lib/person-data';
import { parsePersonRef } from '@/lib/person-data-core';
import { ROUTES } from '@/lib/nav';
import { Table, Tag } from '../../../ui';
import { ErasePersonForm } from './person-data-form';

/**
 * Everything held about one person, and the two things that can be done with
 * it: hand it over, or take it away.
 *
 * ── Why it counts before it offers the button ───────────────────────────────
 *
 * The walk runs on open, so the panel shows what is actually there —
 * "3 posts, 41 messages, 2 orders" — rather than a warning in the abstract. An
 * organizer answering a deletion request is deciding whether to destroy things
 * they cannot see, and the honest version of that screen is the inventory.
 *
 * It is also the check on the walk itself. A collection that stops being
 * reached shows as a zero here, on the screen, rather than as an export that
 * quietly leaves it out.
 *
 * The rows that read **Kept** or **Name removed** are the ones worth reading: a
 * payment stays on the books, a consent signature stays as evidence that
 * wording was agreed, and the organizer log stays because it records what
 * organizers did. Each says why in its own row.
 *
 * ⚠️ `ErasePersonForm` is a direct child of the frame in both states on
 * purpose. The deletion revalidates this screen, so everything above it is
 * replaced the moment it succeeds; holding its position is what lets it survive
 * that and report what it did. Moving it inside the branch below would unmount
 * it at the one moment it has something to say.
 */
export async function PersonDataPanel({ param }: { param: string }) {
  const ref = parsePersonRef(param);
  const identity = ref ? await resolvePerson(ref) : null;

  if (!identity) {
    return (
      <Frame title="Their data">
        <p className="body-2" style={{ marginBottom: 0 }}>
          Nothing is held about this person.
        </p>
        <ErasePersonForm refParam={param} email="" total={0} />
      </Frame>
    );
  }

  const rows = heldRows(await collectPerson(identity.keys));
  const total = rows.reduce((n, r) => n + r.count, 0);
  const download = identity.keys.registrationId
    ? `/export/person?rid=${encodeURIComponent(identity.keys.registrationId)}`
    : `/export/person?uid=${encodeURIComponent(identity.keys.uid ?? '')}`;

  return (
    <Frame title={`Data held for ${identity.name}`}>
      <div>
        <p className="body-2">
          {identity.email}
          {identity.hasTicket ? ' holds a ticket.' : ' has no ticket.'}
          {identity.signedIn
            ? ' They have signed into the app.'
            : ' They have not signed into the app.'}
        </p>

        <Table
          stackSm
          cols={[
            { key: 'w', label: 'What', className: 'cell-md' },
            // `cell-sm`, not `cell-xs`: at 60px the header wrapped to "Record s".
            { key: 'n', label: 'Records', className: 'cell-sm' },
            { key: 'f', label: 'If deleted', className: 'cell-sm' },
            { key: 'y', label: '', className: 'cell-fill' },
          ]}
          empty="Nothing is held about this person"
          rows={rows.map((r) => [
            r.label,
            String(r.count),
            <Tag key="f" color={r.fate === 'Deleted' ? 'red' : 'grey'} fill="outline" small>
              {r.fate}
            </Tag>,
            r.why ? (
              <span key="y" className="muted" style={{ fontSize: 12 }}>
                {r.why}
              </span>
            ) : (
              <span key="y" />
            ),
          ])}
        />

        <div className="toolbar" style={{ marginTop: 16 }}>
          {/*
            A plain link, not a form. The file needs a `Content-Disposition`
            header to save rather than render, and a server action cannot set
            one — the same reason every CSV on this screen is a route.
          */}
          <a className="btn btn-primary" href={download} download>
            Download everything as a file
          </a>
        </div>
        <p className="body-2" style={{ marginBottom: 0 }}>
          The file is JSON, one section per kind of record. Badge codes and sign-in codes are left
          out; each section says what was left out of it.
        </p>
      </div>

      <ErasePersonForm refParam={param} email={identity.email} total={total} />
    </Frame>
  );
}

/** The same bordered block the edit panel above it uses. */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      id="person-data"
      style={{
        background: 'var(--surface-alt)',
        border: '1px solid var(--hairline)',
        borderRadius: 4,
        marginBottom: 16,
        padding: 16,
      }}
    >
      <div
        style={{ alignItems: 'baseline', display: 'flex', gap: 12, justifyContent: 'space-between' }}
      >
        <h2 style={{ fontSize: 15, marginTop: 0 }}>{title}</h2>
        <Link href={ROUTES.attendees}>Close</Link>
      </div>
      {children}
    </div>
  );
}
