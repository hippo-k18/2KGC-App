import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { doc } from 'firebase/firestore';

import {
  COLLECTIONS,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  brandPalette,
  resolveEventBasics,
  resolveSponsorTiers,
  type BrandPalette,
  type BrandingSettings,
  type EventBasics,
  type SponsorTierDef,
} from '@kgc/shared';

import { mergeSettings } from '@/lib/data/event-settings-core';
import { useDocument } from '@/lib/data/use-document';
import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';

/**
 * What the organizer set up on the dashboard, on a phone: Content > Basics,
 * App Branding and Sponsor Tiering.
 *
 * Three single-document listeners, mounted once at the root. `firestore.rules`
 * opens exactly these three keys to a signed-out reader (`PUBLIC_SETTINGS_KEYS`
 * in `@kgc/shared`), which is what lets the sign-in screen carry the brand
 * colour. They are documents and never a query: a `list` of `/settings` is
 * denied, because `settings/access` sits in the same collection.
 *
 * ── First paint ─────────────────────────────────────────────────────────────
 *
 * The context's default is the built-in look: `EVENT`'s name and venue, the
 * four default tiers, no brand colour. So the app renders immediately with what
 * it always had and re-renders when a document arrives, and a denied or
 * offline read leaves it exactly there. Nothing waits on these reads.
 */
export interface EventSettingsValue {
  event: EventBasics;
  branding: BrandingSettings;
  /** The saved brand colour's derived steps, or null when none is saved. */
  brand: BrandPalette | null;
  tiers: SponsorTierDef[];
}

const FALLBACK: EventSettingsValue = {
  event: resolveEventBasics(null),
  branding: SETTINGS_DEFAULTS.branding,
  brand: null,
  tiers: SETTINGS_DEFAULTS.sponsorTiers.tiers,
};

const EventSettingsContext = createContext<EventSettingsValue>(FALLBACK);

function useSettingsDoc<K extends 'branding' | 'event' | 'sponsorTiers'>(key: K) {
  return useDocument(
    // Mounted above the sign-in screen, so a build with no Firebase config must
    // fall through to the built-in look rather than throw out of the root.
    () => (isFirebaseConfigured() ? doc(getDb(), COLLECTIONS.settings, SETTINGS_KEYS[key]) : null),
    [],
    (_id, d) => mergeSettings(SETTINGS_DEFAULTS[key], d),
  ).data;
}

export function EventSettingsProvider({ children }: { children: ReactNode }) {
  const branding = useSettingsDoc('branding');
  const event = useSettingsDoc('event');
  const tiers = useSettingsDoc('sponsorTiers');

  const value = useMemo<EventSettingsValue>(
    () => ({
      event: resolveEventBasics(event),
      branding: branding ?? FALLBACK.branding,
      brand: brandPalette(branding?.brandColor),
      tiers: resolveSponsorTiers(tiers?.tiers),
    }),
    [branding, event, tiers],
  );

  return <EventSettingsContext.Provider value={value}>{children}</EventSettingsContext.Provider>;
}

export function useEventSettings(): EventSettingsValue {
  return useContext(EventSettingsContext);
}
