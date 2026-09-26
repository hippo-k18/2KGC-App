import Link from 'next/link';
import { allowlist, requireOwner } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { dayOfInstant } from '@/lib/time';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { listMembers } from '@/lib/team';
import { ROLE_LABELS, TEAM_ROLES } from '@/lib/team-core';
import { SettingsReach } from '../../settings-reach';
import { Email, GapPanel, PageHeader, Panel, Table, Tag } from '../../ui';
import { AdminSettingsForm } from './form';
import { InviteForm, MemberActions, type RoleOption } from './team';
import { BlogInviteForm, BlogRowActions } from './blog';
import { listBlogPeople } from '@/lib/blog-access';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Admin Settings.
 *
 * Whova's version is an admin roster — 30 admins on a paid event, 10 otherwise
 * — plus check-in staff, an event invitation code and share templates. Whova
 * also states plainly that the admin *roles* are cosmetic: every admin has
 * identical privileges whatever role is selected. Ours are not. A role here is
 * a set of branches of the nav tree, and `requireAccess()` in `lib/auth.ts`
 * refuses everything outside them, for a screen and for a server action alike.
 *
 * ── Two kinds of row in one table ───────────────────────────────────────────
 *
 * Owners come from `CONSOLE_ALLOWLIST` and are read-only here: changing them means editing an env var and redeploying,
 * which is a worse experience and a better last resort than a form that can
 * remove the last person able to use it. Everybody else is a `teamMembers`
 * document an owner made on this screen, limited by role and removable with
 * immediate effect. Everybody signs in the same way, with a code emailed to
 * them. This screen is itself owners-only.
 *
 * The Blog panel manages the other list, `blogMembers`: who can sign in to the
 * blog editor. It lives here, not in the blog, at the owner's request
 * (2026-09-26), so both access lists are managed in one place.
 *
 * The attendee switches further down are stored and not enforced, and the
 * screen says so in those words. An attendee-privacy setting that looks
 * configured and is not is exactly the defect AGENTS.md counts fourteen
 * instances of.
 */
export default async function AdminSettingsPage() {
  await requireOwner();

  const [s, members, blogPeople] = await Promise.all([
    readSettings(SETTINGS_KEYS.access),
    listMembers(),
    listBlogPeople(),
  ]);
  const admins = allowlist();
  // An address in both places is an owner: the allowlist is asked first.
  const team = members.filter((m) => !admins.includes(m.email));
  const people = admins.length + team.length;

  const options: RoleOption[] = TEAM_ROLES.map((role) => ({
    role,
    ...ROLE_LABELS[role],
  }));

  return (
    <>
      <PageHeader
        title="Admin Settings"
        info={
          <>
            <strong>Attendee settings are saved only</strong>
            <p>The two attendee settings are stored but do not change the app yet.</p>
          </>
        }
        tags={<Tag color="blue">
            {people} {people === 1 ? 'administrator' : 'administrators'}
          </Tag>}
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

      <Panel>
        <h2 className="section-header">Administrators</h2>
        <p className="body-2">
          Everyone who can sign in to this dashboard, and what each of them can open.
        </p>
        <Table
          stackSm
          cols={[
            { key: 'e', label: 'Identity', className: 'cell-md' },
            { key: 'r', label: 'Roles', className: 'cell-fill' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'a', label: 'Actions', className: 'cell-md' },
          ]}
          empty="No administrators. Nobody can sign in."
          rows={[
            ...admins.map((e) => [
              <strong key="e">{e}</strong>,
              <span key="r">
                {ROLE_LABELS.owner.label}
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {ROLE_LABELS.owner.covers}
                </span>
              </span>,
              <Tag key="s" color="green">
                Active
              </Tag>,
              <span key="a" className="muted" style={{ fontSize: 12 }}>
                Set in the server settings. Ask for a change there.
              </span>,
            ]),
            ...team.map((m) => [
              <span key="e">
                <strong><Email address={m.email} /></strong>
                {m.name ? (
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {m.name}
                  </span>
                ) : null}
              </span>,
              <span key="r">
                {m.roles.map((r) => ROLE_LABELS[r].label).join(', ')}
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  Invited by {m.invitedBy}
                  {m.invitedAt ? ` on ${dayOfInstant(m.invitedAt)}` : ''}
                  {m.lastSignInAt ? `. Last sign-in ${dayOfInstant(m.lastSignInAt)}` : ''}
                </span>
              </span>,
              m.status === 'active' ? (
                <Tag key="s" color="green">
                  Active
                </Tag>
              ) : (
                <Tag key="s" color="orange">
                  Invited
                </Tag>
              ),
              <MemberActions
                key={`a-${m.id}`}
                memberId={m.id}
                email={m.email}
                held={m.roles}
                options={options}
              />,
            ]),
          ]}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Invite a team member</h2>
        <p className="body-2">
          They get an email, then sign in with their address and a code we send them. They can
          open only what their roles cover.
        </p>
        <InviteForm options={options} />
      </Panel>

      <Panel>
        <h2 className="section-header">Blog</h2>
        <p className="body-2">
          Everyone who can sign in to the blog editor at{' '}
          <a href="https://blog.knowledgegraph.tech/write" target="_blank" rel="noreferrer">
            blog.knowledgegraph.tech/write
          </a>
          . Writers see only their own posts, and an editor reviews each one before it is published.
        </p>
        <Table
          stackSm
          cols={[
            { key: 'e', label: 'Identity', className: 'cell-md' },
            { key: 'r', label: 'Role', className: 'cell-fill' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'a', label: 'Actions', className: 'cell-md' },
          ]}
          empty="Nobody can sign in to the blog."
          rows={blogPeople.map((p) => [
            <span key="e">
              <strong><Email address={p.email} /></strong>
              {p.name ? (
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {p.name}
                </span>
              ) : null}
            </span>,
            <span key="r">
              {p.role === 'editor' ? 'Editor' : 'Writer'}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {p.role === 'editor' ? 'Edits and publishes any post' : 'Drafts their own posts for review'}
                {p.lastSignInAt ? `. Last sign-in ${dayOfInstant(p.lastSignInAt)}` : ''}
              </span>
            </span>,
            p.status === 'active' ? (
              <Tag key="s" color="green">
                Active
              </Tag>
            ) : (
              <Tag key="s" color="orange">
                Invited
              </Tag>
            ),
            p.fixed ? (
              <span key="a" className="muted" style={{ fontSize: 12 }}>
                Owner. Set up outside this screen.
              </span>
            ) : (
              // Keyed on the address: the table keys rows by position, and a
              // removal would otherwise hand this row's message to the next person.
              <BlogRowActions key={`a-${p.email}`} email={p.email} role={p.role} invited={p.status === 'invited'} />
            ),
          ])}
        />
        <h3 className="section-header" style={{ fontSize: 15, marginTop: 20 }}>
          Add someone to the blog
        </h3>
        <BlogInviteForm />
      </Panel>

      <Panel>
        <h2 className="section-header">Attendee settings</h2>
        <AdminSettingsForm
          attendeeListVisible={s.attendeeListVisible}
          contactSharingEnabled={s.contactSharingEnabled}
          attendeeMessagingEnabled={s.attendeeMessagingEnabled}
          staffNote={s.staffNote}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${dayOfInstant(s.updatedAt)}` : ''}.
          </p>
        )}
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.access}
        fields={['attendeeListVisible', 'contactSharingEnabled', 'attendeeMessagingEnabled', 'staffNote']}
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Enforcing the first two attendee switches.</strong> The People tab is
            unconditional in the app, and directory visibility is the attendee&rsquo;s own choice
            via <code>UserDoc.visibleInDirectory</code> — an organizer-level override would have to
            beat an attendee&rsquo;s privacy setting, which is a decision rather than a checkbox.
            The messaging switch beside them is enforced: it is projected into{' '}
            <code>settings/appAccess</code> and <code>firestore.rules</code> refuses a new thread
            or message while it is off.
          </li>
          <li>
            <strong>The event invitation code</strong> lives at{' '}
            <Link href="/tools/admin-control/code-access-control">Code Access Control</Link>, in
            this same settings document. The app asks for it once at first sign-in; it is a welcome
            step and not a gate, and that screen says so.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
