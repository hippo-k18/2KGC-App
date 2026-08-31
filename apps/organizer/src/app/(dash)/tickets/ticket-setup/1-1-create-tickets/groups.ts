/** What the textarea shows a `groups` value as. The inverse of `parseGroups`. */
export function groupsToText(groups: { heading: string; items: string[] }[]): string {
  return groups
    .map((g) => [g.heading, ...g.items.map((i) => `- ${i}`)].join('\n'))
    .join('\n\n');
}

/**
 * The grouped "What's included" list, from the textarea.
 *
 * ── Why this field is the one that mattered ─────────────────────────────────
 *
 * `apps/web/src/app/tickets/page.tsx` renders `groups` when a tier has one and
 * falls back to the flat `includes` when it does not — and the two headline
 * tiers, `all-access` and `main-conference`, both carry `groups` from the seed.
 * So for the two tickets that matter most, the flat "What's included" box
 * changed the checkout order rail and the smaller cards and **nothing at all on
 * the panel a buyer actually reads**. The alternative fix was to delete
 * `groups` from the model, which would have flattened what those two tiers
 * deliberately present as three labelled sections.
 *
 * ── The text format ─────────────────────────────────────────────────────────
 *
 * A flush-left line is a heading; a line starting `-` is a bullet under the
 * heading above it. A heading with no bullets is a group in its own right,
 * which is how the seed expresses "KGC Video Library Subscription (3 months)" —
 * so an empty `items` is meaningful and is not pruned.
 *
 * Returns `null` for a bullet that appears before any heading, rather than
 * inventing one: silently filing bullets under a heading nobody typed is how
 * ticket copy ends up saying something the organizer did not write.
 */
export function parseGroups(raw: string): { heading: string; items: string[] }[] | null {
  const groups: { heading: string; items: string[] }[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const bullet = trimmed.match(/^[-*•]\s*(.*)$/);
    if (bullet) {
      const current = groups[groups.length - 1];
      if (!current) return null;
      const item = bullet[1].trim();
      if (item) current.items.push(item);
      continue;
    }

    groups.push({ heading: trimmed, items: [] });
  }

  return groups;
}
