import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSpeakers, listSponsors } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Social Media Center › Content Library.
 *
 * Whova's content library is the asset bin behind the social posts: banners,
 * badges, story templates, sized per platform, generated with your branding.
 *
 * ── An index, not a second bin ──────────────────────────────────────────────
 *
 * Several screens in this dashboard already hold shareable material, and the
 * failure mode of a "library" is becoming another copy of all of it. So this
 * lists where each kind of asset lives and how much of it exists, and owns
 * nothing itself. The counts are read live rather than described, because
 * "sponsor logos: links to images elsewhere" is a sentence and "16 of 18
 * sponsors have artwork" is the answer somebody actually came for.
 */
export default async function ContentLibraryPage() {
  await requireOrganizer();

  const [sponsors, speakers] = await Promise.all([listSponsors(), listSpeakers()]);

  const sponsorLogos = sponsors.filter((s) => s.hasLogo).length;
  const headshots = speakers.filter((s) => s.hasPhoto).length;

  interface Asset {
    asset: string;
    /** Text is written once; images are per record and counted against a total. */
    kind: 'text' | 'image';
    /** A live count where there is one to read, otherwise what the screen holds. */
    have: string;
    ready: boolean;
    where: string;
    label: string;
    note: string;
  }

  const ASSETS: Asset[] = [
    {
      asset: 'Social post copy',
      kind: 'text',
      have: '4 posts',
      ready: true,
      where: '/tools/app-adoption/social-media',
      label: 'App Adoption › Social Media',
      note: 'Announcement, week-out, day-one and a version for speakers, with the live adoption figure in each.',
    },
    {
      asset: 'Adoption email',
      kind: 'text',
      have: 'sends for real',
      ready: true,
      where: '/tools/app-adoption/app-adoption-email',
      label: 'App Adoption › Adoption Email',
      note: 'The ticket-receipt work put a real email sender in the project; this uses it.',
    },
    {
      asset: 'App download button and links',
      kind: 'text',
      have: 'HTML snippet',
      ready: true,
      where: '/tools/app-adoption/app-download-button',
      label: 'App Adoption › Download Button',
      note: 'Paste into a page or a newsletter.',
    },
    {
      asset: 'Sponsor logos',
      kind: 'image',
      have: `${sponsorLogos} of ${sponsors.length}`,
      ready: sponsors.length > 0 && sponsorLogos === sponsors.length,
      where: '/content/sponsor-center/sponsor-manager',
      label: 'Sponsor Manager',
      note: 'Uploaded to Storage or linked. Nothing resizes or re-crops one.',
    },
    {
      asset: 'Speaker headshots',
      kind: 'image',
      have: `${headshots} of ${speakers.length}`,
      ready: speakers.length > 0 && headshots === speakers.length,
      where: '/content/speaker-center/speaker-manager',
      label: 'Speaker Manager',
      note: 'The grid on /speakers is where a missing one shows as a hole.',
    },
    {
      asset: 'Printable and shareable graphics',
      kind: 'image',
      have: 'none',
      ready: false,
      where: '/tools/app-adoption/downloadable-graphics',
      label: 'App Adoption › Downloadable Graphics',
      note: 'Nothing in this repo composes an image from a template, so there is no badge or story card to hand out.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Content Library"
        info={
          <>
            <strong>An index, not a store</strong>
            <p>
              Nothing is kept here. Every row points at the screen that owns the material, because a
              second copy drifts and the stale one always wins.
            </p>
          </>
        }
        tags={<Tag color="blue" fill="outline">{ASSETS.filter((a) => a.ready).length} of {ASSETS.length} complete</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main secondary">
            Open the site ↗
          </a>
        }
        links={[
          <Link key="m" href="/marketing/social-media-center/social-media-manager">
            Social media manager
          </Link>,
          <Link key="s" href="/tools/app-adoption/social-media">
            Post copy
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Sponsor artwork',
            value: `${sponsorLogos}/${sponsors.length}`,
            sub:
              sponsors.length === 0
                ? 'not inputted yet'
                : sponsorLogos === sponsors.length
                  ? 'all of them'
                  : 'the rest fall back to a name',
          },
          {
            label: 'Speaker headshots',
            value: `${headshots}/${speakers.length}`,
            sub:
              speakers.length === 0
                ? 'not inputted yet'
                : headshots === speakers.length
                  ? 'all of them'
                  : 'the rest leave a hole in the grid',
          },
          {
            label: 'Text assets',
            value: ASSETS.filter((a) => a.kind === 'text' && a.ready).length,
            sub: 'copy, email and snippet',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the material actually is</h2>
        <Table
          cols={[
            { key: 'a', label: 'Asset', className: 'cell-md' },
            { key: 'h', label: 'On file', className: 'cell-sm' },
            { key: 'w', label: 'Screen', className: 'cell-md' },
            { key: 'n', label: '', className: 'cell-fill' },
          ]}
          rows={ASSETS.map((a) => [
            a.asset,
            a.ready ? (
              <Tag key="h" color="green" fill="outline" small>
                {a.have}
              </Tag>
            ) : (
              <span key="h" className="muted" style={{ fontSize: 12 }}>
                {a.have}
              </span>
            ),
            <Link key="w" href={a.where}>
              {a.label}
            </Link>,
            <span key="n" className="muted" style={{ fontSize: 12 }}>
              {a.note}
            </span>,
          ])}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Generated images.</strong> Storage and <code>lib/uploads.ts</code> exist, so
            storing an image is solved; composing one from a template with the event&rsquo;s
            branding is not, and that is most of what Whova&rsquo;s library is.
          </li>
          <li>
            <strong>Per-platform sizing.</strong> Follows from the above: there is nothing to
            resize.
          </li>
          <li>
            <strong>Branding applied to assets.</strong> <code>settings/branding</code> records
            colours and a logo; no surface reads them yet, and assets carry the brand, so that has
            to come first.
          </li>
          <li>
            <strong>Version history.</strong> Nothing is stored here, so nothing has versions.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
