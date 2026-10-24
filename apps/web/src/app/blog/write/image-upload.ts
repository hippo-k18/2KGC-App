/**
 * Shrinks a photo in the browser, then uploads it. A phone photo is 4 to 12 MB
 * and 4000 pixels wide; the blog shows it at under 900, so it goes up as a
 * 2000-pixel JPEG (or WebP, when it has transparency) of a few hundred KB.
 * GIFs go up untouched so an animation keeps moving.
 */
const MAX_EDGE = 2000;

export interface Uploaded {
  src: string;
  width: number;
  height: number;
}

async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  if (file.type === 'image/gif') return { blob: file, width, height };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
  if (!keepAlpha) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = keepAlpha ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  // A small original can come out bigger; keep whichever is smaller.
  return { blob: blob && blob.size < file.size ? blob : file, width, height };
}

export async function uploadImage(file: File): Promise<Uploaded> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const { blob, width, height } = await shrink(file);
  const form = new FormData();
  form.append('file', blob, file.name);
  const res = await fetch('/blog-media/upload', { method: 'POST', body: form });
  const json = (await res.json().catch(() => ({}))) as { src?: string; error?: string };
  if (!res.ok || !json.src) throw new Error(json.error ?? 'The upload failed.');
  return { src: json.src, width, height };
}
