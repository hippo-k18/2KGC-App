import { blogUrl } from '@/lib/blog/paths';
import { publicPosts } from '@/lib/blog/public';

/** RSS for the blog: the twenty newest posts, with their summaries. */
export async function GET() {
  const posts = (await publicPosts()).slice(0, 20);
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const items = posts
    .map((p) => {
      const url = blogUrl(`/${p.slug}`);
      return `<item><title>${esc(p.title)}</title><link>${esc(url)}</link><guid isPermaLink="true">${esc(url)}</guid><pubDate>${new Date(`${p.date}T12:00:00Z`).toUTCString()}</pubDate><dc:creator>${esc(p.author)}</dc:creator>${p.categories.map((c) => `<category>${esc(c)}</category>`).join('')}<description>${esc(p.excerpt)}</description></item>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Knowledge Graph Conference blog</title><link>${esc(blogUrl('/'))}</link><description>Talks, news roundups and write-ups from the KGC community.</description><language>en</language>${items}</channel></rss>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
  });
}
