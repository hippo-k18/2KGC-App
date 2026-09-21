import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { SettingsReach } from '../../../settings-reach';
import { PageHeader, Panel } from '../../../ui';
import { CodeAccessForm } from '../access-form';

export const dynamic = 'force-dynamic';

/**
 * Tools › Admin Control › Code Access Control.
 *
 * ── The app asks for the code. It is not what lets anybody in ───────────────
 *
 * Whova's event code is how an attendee proves they belong when the guest list
 * is loose. Ours is not loose: the gate is the `registered` custom claim, minted
 * only for people who hold a ticket, and `firestore.rules` reads it on every
 * request. A shared code is *weaker* than what already runs — one string, known
 * to a thousand people, that leaks the first time somebody photographs a slide.
 *
 * So the app prompts for it once, at first sign-in, and records the answer on
 * the attendee's own profile; `firestore.rules` does not read the code and must
 * not be made to. That split is the honest one: the prompt is a front door on a
 * building whose locks are elsewhere, and it is worth having for the reason a
 * front door is — it is the thing an organizer reads out from the stage.
 */
export default async function CodeAccessControlPage() {
  await requireOrganizer();
  const s = await readSettings(SETTINGS_KEYS.access);

  return (
    <>
      <PageHeader
        title="Code Access Control"
        info={
          <>
            <strong>The event code is not what lets people in</strong>
            <p>
              Only ticket holders can open the app. The code is asked for once, the first time
              somebody signs in, and it is a welcome step rather than a lock.
            </p>
          </>
        }
        links={[
          <Link key="p" href="/tools/admin-control/post-event-access-duration">
            Post Event Access
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Event code</h2>
        <CodeAccessForm eventCode={s.eventCode} codeRequired={s.codeRequired} />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How an attendee gets in</h2>
        <ol className="muted" style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, marginBottom: 0 }}>
          <li>They buy a ticket with their email address.</li>
          <li>
            They sign in to the app with that same address and enter the <strong>claim code</strong>{' '}
            from their confirmation email. That code is personal. It is not the event code above.
          </li>
          <li>Their account is given access to the app.</li>
        </ol>
        {/*
          Kept on the page rather than moved into the `info` tip, because it is
          not a caveat about the software — it is a step somebody on the team
          has to actually perform before an attendee can read anything. An
          organizer who does not know this waits for a claim that is never
          minted while the attendee stands there.

          The trigger that would do it automatically is written and tested; it
          is undeployed pending one IAM grant (`iam.serviceAccounts.ActAs`,
          OWNER-ACTIONS.md §3). That is neither the Blaze plan nor the old
          `serviceusage` 403 Both of those are resolved… and this line said
          "Blaze" until it was corrected.
        */}
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          ⚠️ Step 3 is done by hand today. Until someone on the team has done it, a new attendee
          cannot read anything in the app.
        </p>
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.access}
        fields={['eventCode', 'codeRequired']}
        style={{ marginTop: 16 }}
      />
    </>
  );
}
