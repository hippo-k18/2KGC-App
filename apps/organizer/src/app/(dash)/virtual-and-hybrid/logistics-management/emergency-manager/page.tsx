import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { SettingsReach } from '../../../settings-reach';
import { Banner, GapPanel, PageHeader, Panel, Tag } from '../../../ui';
import { EmergencyForm } from '../emergency-form';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Logistics Management › Emergency Manager.
 *
 * The other screen in this cluster that survives the cut, and it survives for
 * the opposite reason to Event Checklist: it has nothing to do with streaming.
 * A thousand people in a building on Roosevelt Island need an assembly point
 * and one named person who decides, and that is true whether or not a single
 * session is broadcast.
 *
 * ── Why it is a settings form rather than a feature ─────────────────────────
 *
 * Whova's Emergency Manager can broadcast an alert to every phone. Ours cannot,
 * and the reason is specific rather than general: `apps/organizer/src/lib/push.ts`
 * really does send FCM from this dashboard, but nothing in the app ever writes
 * `users/{uid}/fcmTokens`, so the token list it queries is empty. A broadcast
 * button here would send successfully to nobody, which in an emergency is the
 * worst possible failure mode — it reports success.
 *
 * So this stores the plan and says plainly that the delivery mechanism is a
 * human with a microphone. That is what most conferences actually use.
 */
export default async function EmergencyManagerPage() {
  await requireOrganizer();
  const s = await readSettings(SETTINGS_KEYS.logistics);
  const ready = s.planReady;

  return (
    <>
      <PageHeader
        title="Emergency Manager"
        tags={
          <Tag color={ready ? 'green' : 'orange'} fill="outline">
            {ready ? 'Plan marked ready' : 'Draft'}
          </Tag>
        }
        links={[
          <Link key="c" href="/virtual-and-hybrid/logistics-management/event-checklist">
            Event Checklist
          </Link>,
          <Link key="a" href={ROUTES.announcements}>
            Announcements
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing here alerts anybody.</strong> This is a reference card the organizing team
        fills in and reads — it does not page, call, text or push. In a real incident the sequence
        is emergency services first, then venue security, then an announcement from the stage.
        Reaching phones would need push, and no device has ever registered a token (nothing in the
        app writes <code>fcmTokens</code>), so a broadcast button would silently reach zero people.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Emergency plan</h2>
        <EmergencyForm
          plan={{
            emergencyNumber: s.emergencyNumber,
            venueSecurity: s.venueSecurity,
            medicalPoint: s.medicalPoint,
            assemblyPoint: s.assemblyPoint,
            onSiteLead: s.onSiteLead,
            onSiteLeadPhone: s.onSiteLeadPhone,
            incidentProcedure: s.incidentProcedure,
            planReady: ready,
          }}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}. Every edit is in the audit log.
          </p>
        )}
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.logistics}
        fields={['emergencyNumber', 'assemblyPoint', 'onSiteLead', 'incidentProcedure', 'planReady']}
        style={{ marginTop: 16 }}
      />

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No alert broadcast.</strong> As above — the sender is real, the audience is
            empty. Push needs a development build of the app to receive it, which Expo Go cannot do.
          </li>
          <li>
            <strong>The plan is not visible to attendees — yet.</strong> It lives in the{' '}
            <code>settings</code> collection, which has no <code>match</code> block in{' '}
            <code>firestore.rules</code>, so the client SDK is denied by the default-closed
            posture. Reaching a phone therefore needs a rules change and a deploy as well as a
            screen; that is written up as <strong>FU-12</strong> in{' '}
            <code>docs/audit-2026-08-30/FOLLOW-UPS.md</code>. Until then the working route is an
            announcement, which is real and <Link href={ROUTES.announcements}>already works</Link>.
          </li>
          <li>
            <strong>No incident log.</strong> Whova records what happened and when. That is a
            collection, a form and a retention decision about what is effectively a safeguarding
            record, and it should not be improvised into a settings bag.
          </li>
          <li>
            <strong>No staff roster or radio channels.</strong> Team members are not modelled at all
            — there is no <code>staff</code> collection, only organizers, who are an
            allowlisted email address in an env var.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
