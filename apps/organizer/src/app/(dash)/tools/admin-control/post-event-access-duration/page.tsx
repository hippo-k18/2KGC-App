import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { SettingsReach } from '../../../settings-reach';
import { PageHeader, Panel } from '../../../ui';
import { PostEventForm } from '../access-form';

export const dynamic = 'force-dynamic';

/**
 * Tools › Admin Control › Post Event Access Duration.
 *
 * ── This setting is enforced, as of 2026-09-20 ──────────────────────────────
 *
 * It used to store a number that nothing read, and the page said so at length.
 * Saving now also rewrites `settings/appAccess`, the projection the phone and
 * `firestore.rules` both read: the end of the event plus this many days,
 * resolved into epoch milliseconds in the event's own zone, because the rules
 * language cannot parse a date and has no clock but `request.time`.
 *
 * Of the two routes that were open here, this is the second one — the cutoff is
 * a published value compared in the rules, not an expiring custom claim. The
 * claim would have needed a scheduled job to re-mint a thousand tokens; this
 * needs one access call, it is editable from this screen with no deploy, and
 * it closes the *data* rather than hiding the screens. Read-only is the same
 * comparison against the second boundary, applied to the write paths the
 * checkbox below names: posts, replies, reactions, messages and questions.
 *
 * ⚠️ The rules that enforce it are in the working tree and are deployed
 * separately. Until `scripts/ops/deploy-rules.mjs` runs against the live
 * project, the app honours the window and the live database does not.
 */
export default async function PostEventAccessPage() {
  await requireOrganizer();
  const s = await readSettings(SETTINGS_KEYS.access);

  return (
    <>
      <PageHeader
        title="Post Event Access Duration"
        info={
          <>
            <strong>This closes the app</strong>
            <p>
              After the last day you set here, the app opens to one screen saying the event is
              over. Nothing else loads.
            </p>
          </>
        }
        links={[
          <Link key="c" href="/tools/admin-control/code-access-control">
            Code Access Control
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How long attendees keep the app</h2>
        <PostEventForm postEventDays={s.postEventDays} postEventReadOnly={s.postEventReadOnly} />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.access}
        fields={['postEventDays', 'postEventReadOnly']}
        style={{ marginTop: 16 }}
      />
    </>
  );
}
