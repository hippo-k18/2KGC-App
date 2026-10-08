import Link from 'next/link';
import { blogBase } from '@/lib/blog/paths';

/** A writer who opens an editors-only page, such as People. */
export default async function StudioForbidden() {
  const base = await blogBase();
  return (
    <div className="st-page">
      <div className="st-empty">
        <strong>Only editors can open this page</strong>
        Ask a KGC editor if you need to invite someone. <Link href={`${base}/write`}>Back to your posts</Link>
      </div>
    </div>
  );
}
