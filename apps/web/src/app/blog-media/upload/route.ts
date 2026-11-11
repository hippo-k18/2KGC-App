import { currentViewer } from '@/lib/blog/auth';
import { MAX_UPLOAD_BYTES, saveUpload } from '@/lib/blog/media';

/**
 * Image uploads from the blog editor. A route rather than a server action
 * because server actions cap a request body at 1 MB and a photo is bigger.
 * Signed-in writers and editors only; the session cookie is SameSite=Lax, and
 * the Origin check refuses a post from any other site on top of that.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return Response.json({ error: 'Refused.' }, { status: 403 });
  }
  if (!(await currentViewer())) return Response.json({ error: 'Sign in again to upload.' }, { status: 401 });

  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return Response.json({ error: 'That image is over 6 MB.' }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No image was attached.' }, { status: 400 });
  try {
    const src = await saveUpload(Buffer.from(await file.arrayBuffer()));
    return Response.json({ src });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Upload failed.' }, { status: 400 });
  }
}
