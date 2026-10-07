import 'server-only';

import { cache } from 'react';
import {
  brandPalette,
  resolveEventBasics,
  resolveSponsorTiers,
  type BrandPalette,
  type EventBasics,
  type SponsorTierDef,
} from '@kgc/shared';
import { SETTINGS_KEYS, readSettings } from './settings';

/**
 * The event as the organizer has set it up: Content > Basics, the sponsor tier
 * list and the brand colour, each resolved over the constants they replaced.
 *
 * `cache()` because the layout's masthead and the page under it both ask, and
 * one request should read each document once. It is per request, so a save
 * shows on the next render.
 */
export const eventBasics = cache(async function eventBasics(): Promise<EventBasics> {
  return resolveEventBasics(await readSettings(SETTINGS_KEYS.event));
});

/** The zone session times are authored in. */
export async function eventTimeZone(): Promise<string> {
  return (await eventBasics()).timeZone;
}

/** The ordered tier list, or the four defaults when none is saved. */
export const sponsorTiers = cache(async function sponsorTiers(): Promise<SponsorTierDef[]> {
  return resolveSponsorTiers((await readSettings(SETTINGS_KEYS.sponsorTiers)).tiers);
});

/** The saved brand colour with its derived steps, or null when none is saved. */
export const brand = cache(async function brand(): Promise<BrandPalette | null> {
  return brandPalette((await readSettings(SETTINGS_KEYS.branding)).brandColor);
});
