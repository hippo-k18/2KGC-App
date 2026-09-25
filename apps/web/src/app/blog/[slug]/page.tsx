import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canonicalOrigin } from '@/lib/event-jsonld';
import { getAuthor, getPostBody } from '@/lib/post-content';
import { formatPostDate, getPost, POSTS, type Post } from '@/lib/posts';
import { SITE } from '@/lib/site';

/** The newsletter form lives on the conference's HubSpot, same as the live site. */
const NEWSLETTER = 'https://info.knowledgegraph.tech/kgc-newsletter-sign-up';

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

  // With the full article here, this page is the article: the canonical is its
  // own URL. A post whose body was never scraped is still only a summary, and
  // keeps pointing at the original so it does not compete with it.
  const hasBody = getPostBody(post.slug) !== null;
  const canonical = hasBody ? `/blog/${post.slug}` : post.url;

  return {
    title: post.title,
    description: post.excerpt.slice(0, 200),
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.excerpt.slice(0, 200),
      url: canonical,
      publishedTime: post.date,
      authors: [post.author],
      images: post.image ? [post.image] : undefined,
    },
  };
}

/**
 * A single post, laid out as the live site's Kadence single-post template lays
 * it out, measured on knowledgegraph.tech at 1440 and 1920 wide: the article in
 * a white card on the blue-grey blog page with a share row above the body and
 * `#tag` chips below it, a sidebar of calls to action and recent posts beside
 * it, and the author box, previous/next links and "Further Reading" under it.
 *
 * The body is the scraped WordPress HTML from `src/content/blog/`; see
 * `@/lib/post-content` for why rendering it as HTML is safe here. If a post has
 * no scraped body the page falls back to the excerpt and a link out, so a
 * partial scrape degrades to what the site did before rather than to a blank.
 */
export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const body = getPostBody(post.slug);
  const author = getAuthor(post.author);

  const index = POSTS.findIndex((entry) => entry.slug === post.slug);
  const newer = POSTS[index - 1];
  const older = POSTS[index + 1];
  const recent = POSTS.filter((entry) => entry.slug !== post.slug).slice(0, 3);
  const related = relatedPosts(post, 3);

  return (
    <div className="post-layout">
      <div className="post-main">
        <article className="post-card">
          <header>
            <p className="post-categories">
              {post.categories.map((name, i) => (
                <span key={name}>
                  {i > 0 && ' | '}
                  <Link href={`/blog?category=${encodeURIComponent(name)}`}>{name}</Link>
                </span>
              ))}
            </p>
            <h1 className="post-title">{post.title}</h1>
            <div className="post-meta">
              {author?.avatar && (
                <Image src={author.avatar} alt="" width={75} height={75} className="post-meta-avatar" />
              )}
              <span>By {post.author}</span>
              <span className="post-meta-divider" aria-hidden="true" />
              <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            </div>
          </header>

          <ShareRow title={post.title} url={`${canonicalOrigin()}/blog/${post.slug}`} />

          {body ? (
            <div className="post-body" dangerouslySetInnerHTML={{ __html: body }} />
          ) : (
            <div className="post-body">
              <p>{post.excerpt}</p>
              <p>
                <a href={post.url} rel="noopener noreferrer">
                  Read the full post on knowledgegraph.tech
                </a>
              </p>
            </div>
          )}

          {post.tags.length > 0 && (
            <footer className="post-tags" aria-label="Post tags">
              {post.tags.map((tag) => (
                <Link key={tag} href={`/blog?tag=${encodeURIComponent(tag)}`}>
                  <span aria-hidden="true">#</span>
                  {tag}
                </Link>
              ))}
            </footer>
          )}
        </article>

        <div className="post-author">
          {author?.avatar && (
            <Image src={author.avatar} alt="" width={80} height={80} className="post-author-avatar" />
          )}
          <div>
            <p className="post-author-name">{post.author}</p>
            {author?.bio && <p className="post-author-bio">{author.bio}</p>}
          </div>
        </div>

        <nav className="post-nav" aria-label="Posts">
          {older && (
            <Link href={`/blog/${older.slug}`} rel="prev" className="post-nav-prev">
              <span className="post-nav-sub">
                <Arrow direction="left" /> Previous
              </span>
              {older.title}
            </Link>
          )}
          {newer && (
            <Link href={`/blog/${newer.slug}`} rel="next" className="post-nav-next">
              <span className="post-nav-sub">
                Next <Arrow direction="right" />
              </span>
              {newer.title}
            </Link>
          )}
        </nav>

        {related.length > 0 && (
          <section className="post-related" aria-labelledby="further-reading">
            <h2 id="further-reading">Further Reading</h2>
            <div className="post-related-grid">
              {related.map((entry) => (
                <RelatedCard key={entry.slug} post={entry} />
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="post-sidebar" aria-label="Sidebar">
        <h2>Connect with KG Experts</h2>
        <p>
          When you attend the {SITE.name} from {SITE.datesLong}, you have the chance to learn, grow,
          network, and more with a community of knowledge graph professionals.
        </p>
        <Link href="/tickets" className="post-sidebar-btn">
          Get my ticket
        </Link>

        <h2>KGC Newsletter</h2>
        <p>
          Stay in the loop with the world of knowledge graphs, AI, and more: Subscribe to the KGC
          Newsletter!
        </p>
        <a href={NEWSLETTER} className="post-sidebar-btn" rel="noopener noreferrer">
          Keep me updated
        </a>

        <h2>Explore Recent Blog Posts</h2>
        <ul className="post-recent">
          {recent.map((entry) => (
            <li key={entry.slug}>
              {entry.image && (
                <Link
                  href={`/blog/${entry.slug}`}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="post-recent-thumb-link"
                >
                  <Image
                    src={entry.image}
                    alt=""
                    width={150}
                    height={150}
                    sizes="150px"
                    className="post-recent-thumb"
                  />
                </Link>
              )}
              <Link href={`/blog/${entry.slug}`} className="post-recent-title">
                {entry.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/**
 * The four round share buttons above the body, in the live site's order and
 * brand colours. Plain links to each network's share URL: no script, no
 * tracking pixel, nothing loaded until somebody clicks.
 */
function ShareRow({ title, url }: { title: string; url: string }) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    { label: 'LinkedIn', cls: 'linkedin', glyph: 'in', href: `https://www.linkedin.com/shareArticle?mini=true&url=${u}&title=${t}` },
    { label: 'WhatsApp', cls: 'whatsapp', glyph: 'W', href: `https://wa.me/?text=${u}` },
    { label: 'Facebook', cls: 'facebook', glyph: 'f', href: `https://www.facebook.com/sharer.php?u=${u}` },
    { label: 'X', cls: 'x', glyph: '𝕏', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
  ];
  return (
    <div className="post-share">
      {links.map((link) => (
        <a
          key={link.cls}
          href={link.href}
          className={`post-share-${link.cls}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Share on ${link.label}`}
        >
          <span aria-hidden="true">{link.glyph}</span>
        </a>
      ))}
    </div>
  );
}

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      style={{ verticalAlign: '-3px', transform: direction === 'right' ? 'scaleX(-1)' : undefined }}
    >
      <path d="M20 12H5M11 5l-7 7 7 7" />
    </svg>
  );
}

function RelatedCard({ post }: { post: Post }) {
  const author = getAuthor(post.author);
  return (
    <article className="post-related-card">
      <Link href={`/blog/${post.slug}`} tabIndex={-1} aria-hidden="true" className="post-related-thumb">
        {post.image && (
          <Image
            src={post.image}
            alt=""
            width={post.imageWidth}
            height={post.imageHeight}
            sizes="(width >= 980px) 25vw, 100vw"
          />
        )}
      </Link>
      <div className="post-related-body">
        <p className="post-categories">
          {post.categories.map((name, i) => (
            <span key={name}>
              {i > 0 && ' | '}
              <Link href={`/blog?category=${encodeURIComponent(name)}`}>{name}</Link>
            </span>
          ))}
        </p>
        <h3>
          <Link href={`/blog/${post.slug}`}>{post.title}</Link>
        </h3>
        <p className="post-related-meta">
          {author?.avatar && <Image src={author.avatar} alt="" width={25} height={25} />}
          By {post.author} · {formatPostDate(post.date)}
        </p>
      </div>
    </article>
  );
}

/**
 * The posts sharing the most tags and categories with this one, newest first on
 * a tie. The live site's "Further Reading" is Kadence's own pick; this is the
 * nearest thing that can be computed from the data here.
 */
function relatedPosts(post: Post, count: number): Post[] {
  const mine = new Set([...post.tags, ...post.categories]);
  return POSTS.filter((entry) => entry.slug !== post.slug)
    .map((entry) => ({
      entry,
      score: [...entry.tags, ...entry.categories].filter((t) => mine.has(t)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ entry }) => entry);
}
