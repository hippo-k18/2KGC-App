/**
 * What a deleted account leaves behind in other people's data.
 *
 * Deleting an account removes the person's profile, directory entry, saved
 * items and sign-in, but not the conversation around them: a community post
 * someone else replied to, or a message thread the other person still has. Those
 * are kept and re-attributed to this id, so every screen that names an author
 * can say "Deleted user" instead of falling back to a generic label or, worse,
 * resolving the old uid to somebody else.
 *
 * No real account can have it: derived uids are hex hashes and the ones Auth
 * generates are 28 letters and digits, and neither contains a hyphen. So no rule
 * that compares `authorId == request.auth.uid` can ever match it either.
 */
export const DELETED_USER_ID = "deleted-user";

/** The byline shown wherever `DELETED_USER_ID` appears. */
export const DELETED_USER_NAME = "Deleted user";

export function isDeletedUser(uid: string | null | undefined): boolean {
  return uid === DELETED_USER_ID;
}

/**
 * The name to print for a uid, given a uid → name lookup.
 *
 * `DELETED_USER_NAME` for the marker; otherwise the looked-up name, falling
 * back to the uid itself. The dashboard keeps that uid fallback on purpose (an
 * attendee who left the directory still has to be told apart), and without the
 * first branch it printed the raw `deleted-user` marker as a person's name.
 */
export function nameOrId(names: { get(id: string): string | undefined }, uid: string): string {
  if (isDeletedUser(uid)) return DELETED_USER_NAME;
  return names.get(uid) ?? uid;
}
