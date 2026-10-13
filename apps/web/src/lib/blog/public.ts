import 'server-only';

import { unstable_cache } from 'next/cache';
import { COLLECTIONS } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { POSTS, type Post } from '@/lib/posts';
import { autoExcerpt, sanitizeDoc } from './doc';
import type { BlogMemberDoc, BlogPostDoc, PostBody, PostFields } from './types';

/**
 * The posts readers see: the checked-in archive, with every stored post laid
 * over it. A stored record for an archive slug replaces that archive entry,
 * whether it is published (the edited version shows) or not (the post is gone).
 *
 * Cached for five minutes and dropped at once by any publish or unpublish
 * (`revalidateTag(BLOG_TAG)` in `store.ts`). If Firestore cannot be reached the
 * archive still renders, as it did before the blog had a database.
 */

export type PublicPost = Post & {
  body: PostBody;
  authorBio?: string;
  authorAvatar?: string;
  previousSlugs: string[];
};

function fromFields(f: PostFields, extra: { bio?: string; avatar?: string; previous: string[] }): PublicPost {
  const archive = f.body.kind === 'legacy' ? POSTS.find((p) => p.slug === (f.body as { slug: string }).slug) : undefined;
  const excerpt =
    f.excerpt ||
    (f.body.kind === 'doc' ? autoExcerpt(sanitizeDoc(f.body.doc)) : archive?.excerpt ?? '');
  return {
    slug: f.slug,
    title: f.title,
    date: f.date,
    author: f.authorName,
    authorUrl: null,
    categories: f.categories,
    tags: f.tags,
    excerpt,
    excerptIsQuote: false,
    url: `/blog/${f.slug}`,
    image: f.cover?.src ?? null,
    imageWidth: f.cover?.width ?? 0,
    imageHeight: f.cover?.height ?? 0,
    body: f.body,
    authorBio: extra.bio,
    authorAvatar: extra.avatar,
    previousSlugs: extra.previous,
  };
}

async function load(): Promise<PublicPost[]> {
  let stored: BlogPostDoc[] = [];
  let members: BlogMemberDoc[] = [];
  try {
    const [p, m] = await Promise.all([
      db().collection(COLLECTIONS.blogPosts).get(),
      db().collection(COLLECTIONS.blogMembers).get(),
    ]);
    stored = p.docs.map((d) => d.data() as BlogPostDoc);
    members = m.docs.map((d) => d.data() as BlogMemberDoc);
  } catch (err) {
    console.error('[blog] could not read stored posts; showing the archive only', err);
  }
  const byEmail = new Map(members.map((m) => [m.email, m]));
  const replaced = new Set(stored.map((p) => p.legacySlug).filter(Boolean));

  const archive: PublicPost[] = POSTS.filter((p) => !replaced.has(p.slug)).map((p) => ({
    ...p,
    body: { kind: 'legacy', slug: p.slug },
    previousSlugs: [],
  }));
  const live: PublicPost[] = stored
    .filter((p) => p.live)
    .map((p) => {
      const m = p.authorEmail ? byEmail.get(p.authorEmail) : undefined;
      return fromFields(p.live!, {
        bio: m?.bio || undefined,
        avatar: m?.avatar || undefined,
        previous: p.previousSlugs ?? [],
      });
    });

  return [...archive, ...live].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export const publicPosts = unstable_cache(load, ['blog-public-posts'], { tags: ['blog'], revalidate: 300 });

export async function publicPost(slug: string): Promise<{ post: PublicPost } | { redirectTo: string } | null> {
  const all = await publicPosts();
  const post = all.find((p) => p.slug === slug);
  if (post) return { post };
  const moved = all.find((p) => p.previousSlugs.includes(slug));
  return moved ? { redirectTo: moved.slug } : null;
}

/** Categories with counts, most used first, as the chip row shows them. */
export function categoriesOf(posts: PublicPost[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of posts) for (const c of p.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
