import { signingLink, signingLinksAvailable, type ConsentRegister } from '@/lib/consents';
import { Banner, EmptyState, Panel, StatTiles, Table, Tag } from '../../ui';

/**
 * The register: who is expected to sign one form, and who has.
 *
 * Rendered by both consent screens — Attendees and Speaker Center — because
 * Whova nests the same screen twice and the two differ only in which audience
 * their form is for. The same arrangement `SurveyScreen` has for Surveys and
 * Session Feedback, and for the same reason: one shape, two places in the
 * navigation tree.
 *
 * ── Three states, not two ───────────────────────────────────────────────────
 *
 * `signed`, `outdated`, `unsigned`. The middle one is the reason this screen is
 * worth building rather than counting: somebody who signed version 2 of a form
 * that is now at version 3 has genuinely signed something, and it is genuinely
 * not this. Reporting them as signed overstates what has been collected;
 * reporting them as unsigned is unfair to them and hides that the wording moved.
 *
 * ── The link column ─────────────────────────────────────────────────────────
 *
 * A capability link per person, for anybody who cannot sign in the app —
 * speakers, who have no account at all, and ticket holders who have not opened
 * it yet. Minted on render rather than stored: the token *is* the
 * authorisation, so there is no row to clean up and nothing to leak from the
 * database. ⚠️ Nothing here **sends** them. `scripts/src/lib/email.ts` composes
 * the transactional mail this project sends and has no consent template, so
 * today an organizer copies a link into a message they write themselves. That is
 * the honest state and the gap panel says so.
 */
export function ConsentRegisterView({ register }: { register: ConsentRegister }) {
  const { form, rows, totals, orphans, audienceUnavailable } = register;
  const linksWork = signingLinksAvailable();

  if (audienceUnavailable) {
    return (
      <Panel>
        <EmptyState icon="◌">
          <strong>There is nobody to show a register against.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            This form is for <strong>{form.audience}s</strong>, and this project has no{' '}
            <code>volunteers</code> collection and no volunteer role — so there is no list of people
            to mark signed or unsigned. The form itself is real and can be signed by anybody sent a
            link; what is missing is the roster to measure it against. An empty register and a
            register showing nobody outstanding look identical and mean opposite things, which is
            why this says which one it is.
          </div>
        </EmptyState>
      </Panel>
    );
  }

  return (
    <>
      <StatTiles
        tiles={[
          {
            label: 'Signed',
            value: totals.signed,
            sub: `of ${totals.expected}, at version ${form.version}`,
          },
          {
            label: 'Outstanding',
            value: totals.unsigned,
            sub: 'have never signed this form',
          },
          {
            label: 'Signed an older version',
            value: totals.outdated,
            sub: totals.outdated > 0 ? 'the wording moved under them' : 'nothing superseded',
          },
        ]}
      />

      {totals.outdated > 0 && (
        <Banner kind="warning">
          <strong>
            {totals.outdated} {totals.outdated === 1 ? 'person has' : 'people have'} signed an
            earlier version of this wording.
          </strong>{' '}
          Their agreement stands for the text they actually read, and it does not cover version{' '}
          {form.version}. Treat them as unsigned for anything the new wording added.
        </Banner>
      )}

      <Table
        cols={[
          { key: 'name', label: 'Name', className: 'cell-fill' },
          { key: 'email', label: 'Email', className: 'cell-md' },
          { key: 'status', label: 'Status', className: 'cell-sm' },
          { key: 'signed', label: 'Signed', className: 'cell-sm' },
          { key: 'link', label: 'Signing link', className: 'cell-sm' },
        ]}
        rows={rows.map((r) => [
          <span key="n">
            {r.name}
            {r.note ? (
              <div className="muted" style={{ fontSize: 11 }}>
                {r.note}
              </div>
            ) : null}
          </span>,
          r.email ? <span key="e" style={{ fontSize: 12 }}>{r.email}</span> : <span key="e" className="muted">—</span>,
          r.status === 'signed' ? (
            <Tag key="s" color="green">signed v{r.signedVersion}</Tag>
          ) : r.status === 'outdated' ? (
            <Tag key="s" color="orange">v{r.signedVersion} only</Tag>
          ) : (
            <Tag key="s" color="grey">not signed</Tag>
          ),
          <span key="d" style={{ fontSize: 12 }}>
            {r.signedAt ? (
              <>
                {new Date(r.signedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                <div className="muted" style={{ fontSize: 11 }}>
                  as {r.signedName} · {r.channel === 'link' ? 'by link' : 'in the app'}
                </div>
              </>
            ) : (
              <span className="muted">—</span>
            )}
          </span>,
          r.status === 'signed' ? (
            <span key="l" className="muted" style={{ fontSize: 12 }}>
              —
            </span>
          ) : linksWork ? (
            <a
              key="l"
              href={signingLink(form.id, r.key)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12 }}
              /* Right-click, copy link, paste into whatever you are writing.
                 There is no sender for this mail — see the component docblock. */
              title="Opens the page this person would sign. Copy the link to send it to them."
            >
              Open / copy
            </a>
          ) : (
            <span key="l" className="muted" style={{ fontSize: 11 }}>
              needs WEB_CONSENT_SECRET
            </span>
          ),
        ])}
        empty="Nobody is in this audience yet."
      />

      {!linksWork && (
        <Banner kind="warning">
          <strong>Signing links cannot be minted on this deployment.</strong> Neither{' '}
          <code>WEB_CONSENT_SECRET</code> nor <code>WEB_ORDER_SECRET</code> is set here, and one of
          them signs the capability token in the URL. Set the same value the website has, or every
          link this screen produces would 404 on it.
        </Banner>
      )}

      {orphans.length > 0 && (
        <Panel>
          <h2 className="section-header">
            {orphans.length} {orphans.length === 1 ? 'signature matches' : 'signatures match'}{' '}
            nobody in this audience
          </h2>
          <p className="body-2">
            Real signatures with no row to sit on — usually somebody removed from the programme
            after signing, or an address corrected afterwards. They are shown rather than dropped:
            a register that quietly discarded them would understate what has actually been
            collected, and nothing in this project can delete one.
          </p>
          <Table
            cols={[
              { key: 'who', label: 'Signed as', className: 'cell-fill' },
              { key: 'email', label: 'Email', className: 'cell-md' },
              { key: 'v', label: 'Version', className: 'cell-sm' },
              { key: 'when', label: 'When', className: 'cell-sm' },
            ]}
            rows={orphans.map((o) => [
              o.signedName,
              o.email ?? '—',
              `v${o.formVersion}`,
              o.signedAt
                ? new Date(o.signedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—',
            ])}
          />
        </Panel>
      )}
    </>
  );
}
