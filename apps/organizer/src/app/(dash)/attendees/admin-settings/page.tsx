import Link from 'next/link';
import { allowlist, requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { SettingsReach } from '../../settings-reach';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../ui';
import { AdminSettingsForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Admin Settings.
 *
 * Whova's version is an admin roster — 30 admins on a paid event, 10 otherwise
 * — plus check-in staff, an event invitation code and share templates. Whova
 * also states plainly that the admin *roles* are cosmetic: every admin has
 * identical privileges whatever role is selected. Ours is more honest about the
 * same fact, because there is only one privilege level and no pretence of a
 * second.
 *
 * ── One real thing and three recorded ones ──────────────────────────────────
 *
 * The administrator table is live: it is `CONSOLE_ALLOWLIST`, the env var
 * `requireOrganizer()` actually checks on every request, so what it lists is
 * precisely who can sign in right now. It is read-only here because changing it
 * means editing an env var and restarting — which is a worse experience and a
 * better security boundary than a form that edits its own access control.
 *
 * The switches below it are stored and not enforced, and the banner says so in
 * those words. An attendee-privacy setting that looks configured and is not is
 * exactly the defect AGENTS.md counts fourteen instances of.
 */
export default async function AdminSettingsPage() {
  await requireOrganizer();

  const s = await readSettings(SETTINGS_KEYS.access);
  const admins = allowlist();

  return (
    <>
      <PageHeader
        title="Admin Settings"
        tags={<Tag color="blue">{admins.length} administrators</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href="/tools/admin-control/code-access-control">
            Code Access Control
          </Link>,
          <Link key="k" href={ROUTES.checkIn}>
            Check-in
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>The switches below are saved and not enforced.</strong> They write a real audited
        document that this screen reads back, and nothing else reads it: the app decides for itself
        whether to show the attendee list, and <code>firestore.rules</code> knows nothing about
        either setting. The administrator table above them <em>is</em> live.
      </Banner>

      <Panel>
        <h2 className="section-header">Administrators</h2>
        <p className="body-2">
          Every identity in <code>CONSOLE_ALLOWLIST</code>, re-checked on every request — removing
          someone from the env var ends their live session too, not just their next sign-in. There
          is one privilege level: anybody on this list can refund an order, edit the agenda and
          check somebody in. Whova offers named roles and then says they grant identical rights;
          this offers no roles, which is the same thing without the suggestion.
        </p>
        <Table
          cols={[
            { key: 'e', label: 'Identity', className: 'cell-md' },
            { key: 'r', label: 'Privileges', className: 'cell-fill' },
          ]}
          empty="CONSOLE_ALLOWLIST is empty — nobody can sign in"
          rows={admins.map((e) => [
            <strong key="e">{e}</strong>,
            <span key="r" className="muted">
              Full — read, write, refund, check-in
            </span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Editing this from a browser is deliberately impossible. A screen that can add an
          administrator is a screen that can grant Admin-SDK write access to the whole event, and
          today the only credential in front of it is a shared passphrase — see the warning at the
          top of <code>src/lib/auth.ts</code>, which is unambiguous that this is not to be exposed
          beyond localhost before SSO and MFA land.
        </p>
      </Panel>

      <Panel>
        <h2 className="section-header">Attendee settings</h2>
        <AdminSettingsForm
          attendeeListVisible={s.attendeeListVisible}
          contactSharingEnabled={s.contactSharingEnabled}
          staffNote={s.staffNote}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.access}
        fields={['attendeeListVisible', 'contactSharingEnabled', 'staffNote']}
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Adding or removing an administrator.</strong> An env var and a redeploy, by
            design — <code>CONSOLE_ALLOWLIST</code> is re-read on every request, so a removal ends
            that person&rsquo;s live session as soon as the process picks up the new value. Real
            user management, with per-person credentials and an audit identity that means
            something, would need a different sign-in method; the shape of <code>signIn()</code> is
            chosen so that stays a change to one function.
          </li>
          <li>
            <strong>Roles that mean anything.</strong> There is one level of access. A check-in-only
            operator, which is the role an event genuinely wants, needs a second level and a rule
            for it.
          </li>
          <li>
            <strong>Enforcing the attendee switches.</strong> The People tab is unconditional in the
            app, and directory visibility is the attendee&rsquo;s own choice via{' '}
            <code>UserDoc.visibleInDirectory</code> — an organizer-level override would have to beat
            an attendee&rsquo;s privacy setting, which is a decision rather than a checkbox.
          </li>
          <li>
            <strong>The event invitation code</strong> lives at{' '}
            <Link href="/tools/admin-control/code-access-control">Code Access Control</Link>, in
            this same settings document. It is stored and not enforced there either, and that screen
            says so.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
