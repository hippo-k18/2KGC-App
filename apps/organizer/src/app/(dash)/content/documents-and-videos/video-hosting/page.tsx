import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Documents & Videos › Video Hosting.
 *
 * Video hosting is not a screen; it is a bill and an operational commitment.
 * Storing and transcoding a five-day conference is tens of gigabytes, and
 * serving it behind a paywall needs signed URLs that expire — which needs a
 * trusted server to sign them.
 *
 * The realistic answer is a hosting provider (Mux, Cloudflare Stream, or an
 * unlisted Vimeo) with this screen holding the ids, rather than anything run
 * here. That is an account and a credential the owner has to open, which is why
 * this screen counts the entitlement rather than the recordings: the
 * *entitlement* is real and sold — `TicketTypeDoc.includesVideoLibrary` is set
 * on the All Access and Main Conference tiers — and nothing serves it.
 *
 * Until there is a provider, the honest path is the Documents screen: a titled
 * link to wherever the recording already lives.
 */
export default async function VideoHostingPage() {
  await requireOrganizer();
  const tickets = await listTicketTypes();
  const entitled = tickets.filter((t) => t.includes.some((i) => /video library/i.test(i)));

  return (
    <>
      <PageHeader
        title="Video Hosting"
        info={
          <>
            <strong>Not available yet</strong>
            <p>
              Recordings cannot be hosted here yet. Host them elsewhere and add the link as a
              document.
            </p>
          </>
        }
        links={[
          <Link key="d" href="/content/documents-and-videos/documents">
            Documents
          </Link>,
          <Link key="a" href="/content/documents-and-videos/attendee-video-access">
            Attendee Video Access
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Recordings hosted', value: 0, sub: 'none yet' },
          {
            label: 'Tiers that include video',
            value: entitled.length,
            sub: 'sold on the public price list',
          },
        ]}
      />

      <Panel>
        <NotInputted
          what="recordings"
          action={
            <Link className="whova-btn-main primary" href="/content/documents-and-videos/documents?new=1">
              Link one as a document
            </Link>
          }
        />
      </Panel>
    </>
  );
}
