import { requirePassphrase } from '@/lib/auth';
import {
  signingLink,
  signingLinksAvailable,
  signingSendPlan,
  type ConsentRegister,
} from '@/lib/consents';
import { Banner, EmptyState, Panel, StatTiles, Table, Tag } from '../../ui';
import { SendSigningLinksForm } from './send-links-form';

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
 * database.
 *
 * The same link is mailed in bulk by the panel above the table, and one at a
 * time by `sendRequiredLinksTo` when an attendee is added. This column is the
 * third round: one person, chased by hand, after both of those.
 *
 * ── The send panel ──────────────────────────────────────────────────────────
 *
 * It sits here rather than beside the editor because this is the screen that
 * knows who is outstanding. Publishing a form no longer mails anybody; it saves
 * the wording and says how many people are waiting, and this is where somebody
 * decides to write to them.
 */
export async function ConsentRegisterView({ register }: { register: ConsentRegister }) {
  const { form, rows, totals, orphans, audienceUnavailable } = register;
  const linksWork = signingLinksAvailable();
  const plan = linksWork ? await signingSendPlan(form.id) : null;

  if (audienceUnavailable) {
    return (
      <Panel>
        <EmptyState icon="◌">
          <strong>No list of {form.audience}s to check against.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            The form can still be signed by anyone you send a link to.
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
          They have not agreed to version {form.version}. Ask them to sign again.
        </Banner>
      )}

      {plan && form.status === 'published' && (
        <SendSigningLinksForm plan={plan} needsPassphrase={requirePassphrase()} />
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
          <strong>Signing links are not available.</strong> Ask your administrator to finish the
          website link setup.
        </Banner>
      )}

      {orphans.length > 0 && (
        <Panel>
          <h2 className="section-header">
            {orphans.length} {orphans.length === 1 ? 'signature matches' : 'signatures match'}{' '}
            nobody in this audience
          </h2>
          <p className="body-2">
            Usually somebody removed from the programme after signing, or an email corrected
            afterwards. Their signatures are kept.
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
