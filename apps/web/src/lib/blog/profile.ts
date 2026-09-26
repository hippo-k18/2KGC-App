import 'server-only';

import { COLLECTIONS } from '@kgc/shared';
import { db } from '@/lib/firestore';
import type { Viewer } from './access';
import { BlogError } from './store';

/**
 * A writer's own name, bio and photo: the byline and the author box under
 * their posts. Who may sign in at all is managed in the organizer dashboard.
 */
export async function updateProfile(
  viewer: Viewer,
  input: { name: string; bio: string; avatar: string | null },
): Promise<void> {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw new BlogError('Your name cannot be empty.');
  const bio = input.bio.trim().slice(0, 800);
  const avatar = input.avatar && /^\/blog-media\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(input.avatar) ? input.avatar : null;
  await db().collection(COLLECTIONS.blogMembers).doc(viewer.email).update({ name, bio, avatar });
}
