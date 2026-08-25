import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { formatPostDate, POST_CATEGORIES, POSTS, postsInCategory, type Post } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'The Knowledge Graph Conference blog archive — talks, news roundups and write-ups from the KGC community, 2019 to today.',
};

/** Twelve fills four rows of the three-column grid without a long scroll. */
const PER_PAGE = 12;

/**
 * `/blog`, backed by the live site's own archive.
 *
 * This page used to say there was nothing published, which was true of this
 * codebase and false of the conference: seventy posts going back to 2019 sit on
 * the WordPress at knowledgegraph.tech. They are now in `@/lib/posts` as
 * checked-in data — title, date, author, categories and the excerpt WordPress
 * itself publishes — so the archive is browsable here without this site making
 * a network call to render, or claiming authorship of writing it did not do.
 *
 * What it deliberately does not do is reproduce the article bodies. Most of
 * these posts are guest-authored and their copyright is not the conference's to
 * relocate, so each card leads to a detail page that credits the author and
 * sends the reader to the canonical article. See the docblock in `posts.ts`.
 *
 * Filtering and paging both run off the query string rather than client state:
 * every view of this archive is then a real URL somebody can link to, and the
 * page ships no JavaScript to do it.
 */
export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const params = await searchParams;

  // Only honour a category that exists. A bad `?category=` filters to nothing
  // and looks like an empty archive, so it falls back to showing everything.
  const category =
    POST_CATEGORIES.find((entry) => entry.name === params.category)?.name ?? null;

  const posts = postsInCategory(category);
  const pageCount = Math.max(1, Math.ceil(posts.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(params.page) || 1), pageCount);
  const visible = posts.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const hrefFor = (nextCategory: string | null, nextPage: number) => {
    const query = new URLSearchParams();
    if (nextCategory) query.set('category', nextCategory);
    if (nextPage > 1) query.set('page', String(nextPage));
    const qs = query.toString();
    return qs ? `/blog?${qs}` : '/blog';
  };

  return (
    <>
      <section>
        <div className="wrap">
          <p className="eyebrow">Writing</p>
          <h1>Blog</h1>
          <p className="lede">
            Talks, fortnightly news roundups and write-ups from the {SITE.shortName} community —{' '}
            {POSTS.length} posts, 2019 to today.
          </p>
          <p className="muted" style={{ maxWidth: '62ch' }}>
            Each post is summarised here and published in full on knowledgegraph.tech. The authors
            keep their bylines and their traffic.
          </p>
          {category && (
            <p style={{ marginTop: 18, marginBottom: 0 }}>
              Showing <strong>{posts.length}</strong> {posts.length === 1 ? 'post' : 'posts'} in{' '}
              {category}.
            </p>
          )}

          <nav aria-label="Filter by category" className="tags" style={{ marginTop: 22, gap: 8 }}>
            <CategoryChip href={hrefFor(null, 1)} label="All posts" active={category === null} />
            {POST_CATEGORIES.map((entry) => (
              <CategoryChip
                key={entry.name}
                href={hrefFor(entry.name, 1)}
                label={`${entry.name} (${entry.count})`}
                active={category === entry.name}
              />
            ))}
          </nav>
        </div>
      </section>

      <section className="tint">
        <div className="wrap">
          <div className="grid g3">
            {visible.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>

          {pageCount > 1 && (
            <nav
              aria-label="Archive pages"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 32,
                flexWrap: 'wrap',
              }}
            >
              {page > 1 ? (
                <Link href={hrefFor(category, page - 1)} rel="prev">
                  ← Newer
                </Link>
              ) : (
                <span className="muted">← Newer</span>
              )}
              <span className="muted">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={hrefFor(category, page + 1)} rel="next">
                  Older →
                </Link>
              ) : (
                <span className="muted">Older →</span>
              )}
            </nav>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * A filter chip.
 *
 * `.tag` already styles a small uppercase pill and is used for session tracks,
 * so the filter row reuses it rather than inventing a second chip. The active
 * state is inline because it is the one thing `.tag` has no modifier for.
 */
function CategoryChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="tag"
      aria-current={active ? 'true' : undefined}
      style={{
        textDecoration: 'none',
        ...(active
          ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: 'white' }
          : null),
      }}
    >
      {label}
    </Link>
  );
}

/**
 * One post in the grid.
 *
 * `padding: 0` on the card so the featured image can reach its edges — `.card`
 * pads for prose, and a cover image inset by 22px reads as a mistake. The
 * padding moves to the body below it.
 */
function PostCard({ post }: { post: Post }) {
  return (
    <article
      className="card"
      style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {post.image && (
        <Image
          src={post.image}
          alt=""
          width={post.imageWidth}
          height={post.imageHeight}
          sizes="(width >= 900px) 33vw, (width >= 560px) 50vw, 100vw"
          style={{ width: '100%', height: 168, objectFit: 'cover', display: 'block' }}
        />
      )}
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          {formatPostDate(post.date)}
        </p>
        <h3 style={{ fontSize: '1.05rem', lineHeight: 1.35 }}>
          <Link href={`/blog/${post.slug}`}>{post.title}</Link>
        </h3>
        <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 10 }}>
          By {post.author}
        </p>
        <p
          style={{
            // 22px, matching the live excerpt. `0.94rem` was 15px against the
            // old 16px root and 20.68px against the current 22px one — right by
            // accident once, wrong by accident since.
            fontSize: '1rem',
            // Four lines, so cards in a row stay the same height whether the
            // excerpt is WordPress's 55 words or a two-sentence stub.
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginBottom: 14,
          }}
        >
          {post.excerpt}
        </p>
        <div className="tags" style={{ marginTop: 'auto' }}>
          {post.categories.map((name) => (
            <span key={name} className="tag">
              {name}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
