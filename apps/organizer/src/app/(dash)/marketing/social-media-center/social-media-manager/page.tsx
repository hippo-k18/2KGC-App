import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { Banner, PageHeader, Panel, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Social Media Center › Social Media Manager.
 *
 * ── This screen deliberately holds no copy of its own ───────────────────────
 *
 * Tools › App Adoption › Social Media already writes the posts, keyed to the
 * real adoption figure, with character counts. Whova has two entry points to
 * one job; duplicating the copy here would give us two, which drift, and the
 * one an organizer edits would be whichever they happened to open.
 *
 * So this is a pointer plus the one thing the other screen cannot say: why
 * nothing here connects to a social account. That argument belongs on the
 * screen named "Manager", because "manager" is exactly the word that implies
 * connected accounts.
 */
export default async function SocialMediaManagerPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Social Media Manager"
        tags={<Tag color="blue" fill="outline">lives under App Adoption</Tag>}
        actions={
          <Link href="/tools/app-adoption/social-media" className="whova-btn-main">
            Go to the post copy
          </Link>
        }
        links={[
          <Link key="c" href="/marketing/social-media-center/content-library">
            Content library
          </Link>,
          <Link key="g" href="/tools/app-adoption/downloadable-graphics">
            Downloadable graphics
          </Link>,
        ]}
      />

      <Banner kind="info">
        The posts live on{' '}
        <Link href="/tools/app-adoption/social-media">Tools &rsaquo; App Adoption &rsaquo; Social Media</Link>{' '}
        — announcement, week-out, day-one and a version for speakers to share, each with the live
        adoption figure in it. They are not repeated here on purpose: two copies drift, and the
        stale one always wins.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why nothing here posts</h2>
        <p className="body-2">
          Connecting an account means this dashboard holding OAuth tokens for KGC&rsquo;s LinkedIn
          and X, behind a shared organizer passphrase with no per-person identity. Anyone who could
          open Marketing could post as the conference, and the audit log would record the
          passphrase, not the person. That is the same objection as the bank details on Pay &rsaquo;
          Billing Information, and it has the same answer: those credentials belong behind their own
          login.
        </p>
        <p className="body-2" style={{ marginBottom: 0 }}>
          Scheduling fails for a second reason. A queued post fires whether or not anybody is awake
          to stop it, and the posts most worth queueing are the ones most likely to need pulling —
          a &ldquo;doors are open&rdquo; post during a delay. The same argument is already recorded
          against scheduled announcements and scheduled bulk email.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Connected accounts.</strong> No OAuth to any platform, by the argument above.
          </li>
          <li>
            <strong>Scheduling and a queue.</strong> Nothing to queue to, and the failure mode is
            posting during exactly the moment you would want to stop.
          </li>
          <li>
            <strong>Engagement reporting.</strong> Likes, reposts and reach come from the platform
            APIs, which need the connection that does not exist.
          </li>
          <li>
            <strong>Hashtag monitoring.</strong> Whova pulls tagged posts into the social wall.
            There is no social wall either — see{' '}
            <Link href="/marketing/social-wall/social-wall-customization">
              Social Wall Customization
            </Link>
            .
          </li>
        </ul>
      </Panel>
    </>
  );
}
