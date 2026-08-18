import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatPostDate, getPost, POSTS } from '@/lib/posts';

/** Seventy known slugs and no database behind them, so all of it prerenders. */
export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return { title: 'Post not found' };

  return {
    title: post.title,
    description: post.excerpt.slice(0, 200),
    /**
     * The canonical URL is the article on knowledgegraph.tech, not this page.
     *
     * This page carries the post's title, byline and excerpt — the same words
     * as the original. Pointing the canonical at the original is how this site
     * says "that one is the real copy" instead of competing with an author's
     * own page for their own writing.
     */
    alternates: { canonical: post.url },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.excerpt.slice(0, 200),
      url: post.url,
      publishedTime: post.date,
      authors: [post.author],
    },
  };
}

/**
 * A single post's summary page.
 *
 * Deliberately not the article. It reproduces what the live site publishes as a
 * summary — title, date, author, categories, featured image and the excerpt —
 * and then hands the reader over to the canonical article. Most of these posts
 * are guest-authored, and moving someone else's full text onto a different
 * domain is a rights decision rather than an engineering one; see the docblock
 * in `@/lib/posts`.
 *
 * The page exists at all, rather than the index linking straight out, because
 * the categories, the byline and the neighbouring posts are worth a URL — and
 * because a reader who lands here from search gets the credit and the link
 * rather than a dead end.
 */
export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const index = POSTS.findIndex((entry) => entry.slug === post.slug);
  const newer = POSTS[index - 1];
  const older = POSTS[index + 1];

  return (
    <>
      <section>
        <div className="wrap narrow">
          <p className="eyebrow">
            <Link href="/blog" style={{ color: 'inherit' }}>
              Blog
            </Link>{' '}
            · {formatPostDate(post.date)}
          </p>
          <h1>{post.title}</h1>
          <p className="lede" style={{ marginBottom: 16 }}>
            By{' '}
            {post.authorUrl ? (
              <a href={post.authorUrl} rel="noopener noreferrer">
                {post.author}
              </a>
            ) : (
              post.author
            )}
          </p>

          <div className="tags" style={{ marginBottom: 26 }}>
            {post.categories.map((name) => (
              <Link
                key={name}
                className="tag"
                href={`/blog?category=${encodeURIComponent(name)}`}
                style={{ textDecoration: 'none' }}
              >
                {name}
              </Link>
            ))}
          </div>

          {post.image && (
            <Image
              src={post.image}
              alt=""
              width={post.imageWidth}
              height={post.imageHeight}
              sizes="(width >= 800px) 760px, 100vw"
              priority
              style={{
                width: '100%',
                /*
                 * The archive's featured images run from 1024×385 to 512×512.
                 * At a flat `width: 100%` the square ones render 760px tall and
                 * push the byline and the excerpt below the fold — a logo
                 * occupying a whole screen. Capping the *height* rather than the
                 * width lets the wide banners fill the column, as intended, and
                 * pulls only the tall ones in.
                 */
                maxWidth: Math.round((440 * post.imageWidth) / post.imageHeight),
                height: 'auto',
                margin: '0 auto 26px',
                display: 'block',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--line)',
              }}
            />
          )}

          {/*
            `excerptIsQuote` marks the one post WordPress publishes no excerpt
            for. Its opening words are shown as an explicit quotation with the
            link immediately after, which is a quote of the article rather than
            a copy of it.
          */}
          {post.excerptIsQuote ? (
            <blockquote style={{ fontSize: '1.05rem' }}>
              <p>&ldquo;{post.excerpt}&rdquo;</p>
            </blockquote>
          ) : (
            <p style={{ fontSize: '1.05rem' }}>{post.excerpt}</p>
          )}

          <p className="notice" style={{ marginTop: 26 }}>
            <strong>This is the summary, not the article.</strong>{' '}
            <a href={post.url} rel="noopener noreferrer">
              Read the full post on knowledgegraph.tech →
            </a>
          </p>

          {post.tags.length > 0 && (
            <>
              <h2 style={{ marginTop: 34, fontSize: '1rem' }}>Tagged</h2>
              <p className="muted">{post.tags.join(' · ')}</p>
            </>
          )}
        </div>
      </section>

      <section className="tint">
        <div className="wrap narrow">
          <h2>More from the archive</h2>
          <div className="grid g2" style={{ marginTop: 18 }}>
            {newer && <NeighbourCard label="Newer post" post={newer} />}
            {older && <NeighbourCard label="Older post" post={older} />}
          </div>
          <p style={{ marginTop: 22 }}>
            <Link href="/blog">← All {POSTS.length} posts</Link>
          </p>
        </div>
      </section>
    </>
  );
}

function NeighbourCard({
  label,
  post,
}: {
  label: string;
  post: (typeof POSTS)[number];
}) {
  return (
    <div className="card">
      <p className="eyebrow">{label}</p>
      <h3 style={{ fontSize: '1rem', lineHeight: 1.35 }}>
        <Link href={`/blog/${post.slug}`}>{post.title}</Link>
      </h3>
      <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 0 }}>
        {formatPostDate(post.date)} · {post.author}
      </p>
    </div>
  );
}
