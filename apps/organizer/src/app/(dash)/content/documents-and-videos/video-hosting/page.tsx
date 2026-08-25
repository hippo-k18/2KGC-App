import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/** Content › Documents & Videos › Video Hosting. */
export default async function VideoHostingPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader title="Video Hosting" />
      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Hosts session recordings on their own infrastructure, transcodes them, and serves them
          inside the app behind the attendee&rsquo;s ticket — so a Virtual ticket holder can watch
          a talk they paid for and nobody else can.
        </p>

        <h2 className="section-header">What this would need</h2>
        <p className="body-2">
          Video hosting is not a screen; it is a bill and an operational commitment. Storing and
          transcoding a five-day conference is tens of gigabytes, and serving it behind a paywall
          needs signed URLs that expire — which in turn needs a trusted server to sign them.
          Realistically the answer is <strong>a hosting provider</strong> (Mux, Cloudflare Stream,
          or an unlisted Vimeo) with this screen holding the ids, rather than anything we run.
        </p>
        <p className="body-2">
          Until then the honest path is the Documents screen: paste a link to wherever the
          recording already lives. That is worse than Whova and it costs nothing, which for an
          in-person conference whose value is being in the room is close to the right trade.
        </p>

        <h2 className="section-header">The part that already exists</h2>
        <p className="body-2">
          <code>TicketTypeDoc.includesVideoLibrary</code> is on every ticket type, and the All
          Access and Main Conference tiers set it. So the <em>entitlement</em> is modelled and sold
          — three months of the KGC Video Library is on the price list. Nothing serves it.
        </p>
      </Panel>
    </>
  );
}
