import { describe, expect, it } from 'vitest';
import { allowedOrigins, corsOrigin, pendingPhotoTarget } from './speaker-photo-core';

describe('speaker photo upload rules (T379)', () => {
  it('lets only the website send a photo', () => {
    const allowed = allowedOrigins({ WEB_PUBLIC_ORIGIN: 'https://staging.knowledgegraph.tech/' });
    expect(allowed).toEqual(['https://www.knowledgegraph.tech', 'https://staging.knowledgegraph.tech']);
    expect(corsOrigin('https://www.knowledgegraph.tech', allowed)).toBe('https://www.knowledgegraph.tech');
    expect(corsOrigin('https://evil.example', allowed)).toBeNull();
    expect(corsOrigin(null, allowed)).toBeNull();
    expect(allowedOrigins({})).toEqual(['https://www.knowledgegraph.tech']);
  });

  it('stores under the speaker pending folder with a fresh name', () => {
    expect(pendingPhotoTarget('dave-duggal', 'ab12-cd34-ef56-7890-xyz')).toEqual({
      folder: 'speakers/dave-duggal/pending',
      name: 'photo-ab12cd34ef567890',
    });
    expect(pendingPhotoTarget('../etc', 'x')).toBeNull();
    expect(pendingPhotoTarget('a/b', 'x')).toBeNull();
  });
});

describe('isPreviewablePhoto (T379)', () => {
  it('previews our bucket and the local emulator, never another host', async () => {
    const { isPreviewablePhoto } = await import('./speaker-photo-core');
    expect(isPreviewablePhoto('https://firebasestorage.googleapis.com/v0/b/x/o/speakers%2Fa.jpg?alt=media&token=t', {})).toBe(true);
    expect(isPreviewablePhoto('https://example.com/me.jpg', {})).toBe(false);
    expect(isPreviewablePhoto('http://127.0.0.1:9199/v0/b/x/o/a.jpg', {})).toBe(false);
    expect(isPreviewablePhoto('http://127.0.0.1:9199/v0/b/x/o/a.jpg', { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' })).toBe(true);
    expect(isPreviewablePhoto(undefined, {})).toBe(false);
  });
});
