import { EVENT_ID, usable, type BrandPalette } from '@kgc/shared';

import type { ThemeColors } from '@/constants/theme';

/**
 * The pure half of `event-settings.tsx`: what a `settings/{key}` document turns
 * into, and what a saved brand colour does to the palette. No React and no
 * Firebase, so it runs under `npm test`.
 */

/**
 * Stored values over the shared defaults.
 *
 * `eventId` is checked before anything is taken: a settings document belonging
 * to another event is somebody else's name and colours, not a partial answer.
 * `usable()` drops any value whose type does not match the default, so an older
 * save that stored `null` cannot print "null" on the sign-in screen.
 */
export function mergeSettings<T extends object>(defaults: T, doc: unknown): T {
  const raw = doc as { eventId?: unknown; values?: unknown } | null | undefined;
  if (!raw || raw.eventId !== EVENT_ID) return { ...defaults };
  return { ...defaults, ...usable(defaults, raw.values) };
}

/**
 * The palette with the organizer's brand colour laid over it.
 *
 * Only the brand-bearing keys move: the header band and its darker capsules,
 * the tint used for links and selected tabs, and the filled accent behind
 * primary buttons. Surfaces, text and status colours are left alone, because a
 * brand colour says nothing about what a danger state should look like.
 *
 * `tint` takes `brandText`, which is the brand colour darkened only as far as
 * it takes to stay readable on a white surface, so a pale brand colour cannot
 * produce links nobody can read. With no colour saved the input comes back
 * unchanged, which is the built-in look.
 */
export function themeWithBrand(colors: ThemeColors, brand: BrandPalette | null): ThemeColors {
  if (!brand) return colors;
  return {
    ...colors,
    header: brand.brand,
    onHeader: brand.onBrand,
    headerDeep: brand.brandDark,
    tint: brand.brandText,
    accent: brand.brand,
    onAccent: brand.onBrand,
    tintSoft: brand.brandSoft,
  };
}
