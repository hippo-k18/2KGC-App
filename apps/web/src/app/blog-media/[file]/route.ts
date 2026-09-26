import { readUpload } from '@/lib/blog/media';

/** An image uploaded in the blog editor. Names are content hashes, so they never change. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const found = await readUpload((await params).file);
  if (!found) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(found.body), {
    headers: {
      'Content-Type': found.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
