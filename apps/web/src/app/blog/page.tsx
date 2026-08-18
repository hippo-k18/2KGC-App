import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Writing from the Knowledge Graph Conference community.',
};

/**
 * `/blog`, matching the live site's `Blog` tab.
 *
 * The live blog is a WordPress archive with years of posts behind it. There is
 * no post store here and inventing one would put fabricated articles under real
 * bylines, so this page says what it is: the tab exists because the navigation
 * had to match, and the page is honest about having no posts yet rather than
 * dressing up placeholder cards as a publication.
 *
 * When there is a real source — a CMS, an RSS feed, an export of the existing
 * WordPress archive — this becomes a list and the notice comes out.
 */
export default function BlogPage() {
  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">Writing</p>
        <h1>Blog</h1>
        <p className="lede">
          Talks, write-ups and arguments from the {SITE.shortName} community.
        </p>

        <p className="notice">
          <strong>Nothing published here yet.</strong> This site is new and its post archive has not
          been migrated. Rather than fill the page with invented articles under real names, it says
          so — the writing that exists lives on the conference&rsquo;s established channels for now.
        </p>

        <h2 style={{ marginTop: 34 }}>In the meantime</h2>
        <p>
          Every session at {SITE.shortName} {SITE.year} is recorded, and the video library is
          included with every ticket, so the talks are the archive.{' '}
          <Link href="/agenda">See what is on</Link>.
        </p>
        <p>
          To write something here, or to have a talk written up:{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
