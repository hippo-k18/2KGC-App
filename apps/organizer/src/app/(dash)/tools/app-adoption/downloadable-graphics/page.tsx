import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/** Tools › App Adoption › Downloadable Graphics. */
export default async function DownloadableGraphicsPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Downloadable Graphics"
        links={[
          <Link key="s" href="/tools/app-adoption/social-media">
            Social posts
          </Link>,
          <Link key="b" href="/tools/app-adoption/app-download-button">
            Download button
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Generates a pack — social cards, an email banner, a printable table sign with a QR code,
          slide backgrounds — branded with your event&rsquo;s logo and colours, sized for each
          platform.
        </p>

        <h2 className="section-header">What this would need</h2>
        <p className="body-2">
          An image pipeline, which no screen in this dashboard has. That is the same blocker behind
          the Branding Center, sponsor logo uploads and document attachments —{' '}
          <code>ROADMAP.md</code> counts roughly eighteen screens waiting on it. The work is a
          server-side renderer (Satori or a headless browser) plus somewhere to put the output, and
          it is a day or two once the storage half exists.
        </p>
        <p className="body-2">
          The <strong>printable table sign is the one worth building first</strong>, and it is
          nearly free: the repo already has a dependency-free QR encoder at{' '}
          <code>app/src/lib/qr/encode.ts</code>, written because every npm QR component needed
          native modules Expo Go does not ship. It produces a matrix this dashboard could render as
          inline SVG with no dependency and no image pipeline at all. A sign on the registration
          desk is how people actually install a conference app.
        </p>

        <h2 className="section-header">In the meantime</h2>
        <p className="body-2">
          The social copy and the HTML button on the neighbouring screens are the parts that do not
          need a designer. The conference&rsquo;s own brand assets live with whoever makes the
          website, not here.
        </p>
      </Panel>
    </>
  );
}
