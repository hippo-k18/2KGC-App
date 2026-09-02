/**
 * How much of the announcement history the public wall shows.
 *
 * The wall at `/announcements` renders this many, newest first, and the
 * dashboard's Activity Stream Webpage screen reports how many of an organizer's
 * announcements that covers. Those are two installs that cannot import each
 * other but must agree on one number: get it wrong and the screen tells an
 * organizer all sixty of their notices are on the wall when twenty are not —
 * a tile that is confidently wrong about a public page, which is worse than no
 * tile.
 *
 * It lived as a literal in both, with a comment on the dashboard side asking
 * the next editor to remember. Both installs depend on `@kgc/shared`, so the
 * reminder was never the only option available.
 *
 * ── Why forty ───────────────────────────────────────────────────────────────
 *
 * Not the reader's default of three, which is tuned for the homepage ticker
 * where a three-day-old notice is not news. The wall is the archive: an
 * attendee arriving on Thursday wants Monday's room change as much as this
 * morning's. The cap exists only so a runaway writer cannot turn one page into
 * a thousand-document read — it is a ceiling, not an editorial choice, and it
 * is not pagination. Raising it is safe; the day the conference genuinely
 * publishes more than forty notices, the page needs a cursor rather than a
 * bigger number.
 */
export const ANNOUNCEMENT_WALL_LIMIT = 40;
