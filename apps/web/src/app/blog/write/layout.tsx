import type { Metadata } from 'next';
import Link from 'next/link';
import { isEditor } from '@/lib/blog/access';
import { currentViewer } from '@/lib/blog/auth';
import { blogBase } from '@/lib/blog/paths';
import { allStoredPosts } from '@/lib/blog/store';
import { SignOutButton } from './go-buttons';
import { StudioNav } from './studio-nav';
import './studio.css';

export const metadata: Metadata = {
  title: { default: 'Blog editor', template: '%s · Blog editor' },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const [viewer, base] = await Promise.all([currentViewer(), blogBase()]);
  const reviewCount =
    viewer && isEditor(viewer)
      ? (await allStoredPosts()).filter((p) => p.draftState === 'review').length
      : 0;

  return (
    <div className="studio">
      <div className="st-bar">
        <div className="st-bar-inner">
          <Link href={`${base}/write`} className="st-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kgc/cropped-White-Wordmark-2.png" alt="KGC" height={22} />
            <span>Blog</span>
          </Link>
          {viewer ? (
            <>
              <StudioNav base={base} editor={isEditor(viewer)} reviewCount={reviewCount} />
              <div className="st-me">
                <span className="st-me-name">{viewer.name}</span>
                <Link href={base || '/'} target="_blank">
                  View blog
                </Link>
                <SignOutButton />
              </div>
            </>
          ) : (
            <div className="st-me" style={{ marginLeft: 'auto' }}>
              <Link href={base || '/'}>Back to the blog</Link>
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
