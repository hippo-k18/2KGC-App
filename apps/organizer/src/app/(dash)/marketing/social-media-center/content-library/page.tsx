import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Social Media Center › Content Library.
 *
 * Whova's content library is the asset bin behind the social posts: banners,
 * badges, story templates, sized per platform, generated with your branding.
 *
 * ── An index, not a second bin ──────────────────────────────────────────────
 *
 * Three screens in this dashboard already hold shareable material, and the
 * failure mode of a "library" is becoming a fourth copy of all of it. So this
 * lists where each kind of asset actually lives and what state it is in, and
 * owns nothing itself.
 *
 * The honest headline is that the text assets are real and the image assets are
 * not: nothing in this repo generates or stores an image, which is the same
 * blocker as app branding, sponsor banners and the venue map.
 */
export default async function ContentLibraryPage() {
  await requireOrganizer();

  const ASSETS = [
    {
      asset: 'Social post copy',
      state: 'real' as const,
      where: '/tools/app-adoption/social-media',
      label: 'App Adoption › Social Media',
      note: 'Four posts, with the live adoption figure and character counts.',
    },
    {
      asset: 'Adoption email',
      state: 'real' as const,
      where: '/tools/app-adoption/app-adoption-email',
      label: 'App Adoption › Adoption Email',
      note: 'Sends for real — the ticket-receipt work put an email sender in the project.',
    },
    {
      asset: 'App download button and links',
      state: 'real' as const,
      where: '/tools/app-adoption/app-download-button',
      label: 'App Adoption › Download Button',
      note: 'HTML snippet to paste into a page or a newsletter.',
    },
    {
      asset: 'Printable and shareable graphics',
      state: 'missing' as const,
      where: '/tools/app-adoption/downloadable-graphics',
      label: 'App Adoption › Downloadable Graphics',
      note: 'The screen exists and says the same thing: no asset pipeline, so no images.',
    },
    {
      asset: 'Speaker and sponsor logos',
      state: 'partial' as const,
      where: '/content/sponsor-center/sponsor-manager',
      label: 'Sponsor Manager',
      note: 'Links to images hosted elsewhere. Nothing here uploads, resizes or re-crops one.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Content Library"
        tags={<Tag color="blue" fill="outline">an index, not a store</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main">
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

      <Banner kind="info">
        Nothing is stored here. The material that exists lives on the App Adoption screens, and
        this page points at it rather than keeping a second copy that would drift out of date the
        first time somebody edited the real one.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the material actually is</h2>
        <Table
          cols={[
            { key: 'a', label: 'Asset', className: 'cell-md' },
            { key: 's', label: 'State', className: 'cell-sm' },
            { key: 'w', label: 'Screen', className: 'cell-md' },
            { key: 'n', label: '', className: 'cell-fill' },
          ]}
          rows={ASSETS.map((a) => [
            a.asset,
            <Tag
              key="s"
              color={a.state === 'real' ? 'green' : a.state === 'partial' ? 'orange' : 'red'}
              fill="outline"
              small
            >
              {a.state === 'missing' ? 'not built' : a.state}
            </Tag>,
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
            <strong>Any image at all.</strong> No Storage upload path, no resizing, no template
            rendering. Whova&rsquo;s library is mostly generated images, so this is not a corner of
            the feature — it is most of it.
          </li>
          <li>
            <strong>Per-platform sizing.</strong> Follows from the above: there is nothing to
            resize.
          </li>
          <li>
            <strong>Branding applied to assets.</strong> App Branding is unbuilt for the same
            reason, and it would have to come first — assets carry the brand, so the brand has to
            be storable before the assets are.
          </li>
          <li>
            <strong>Version history.</strong> Nothing is stored, so nothing has versions.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
