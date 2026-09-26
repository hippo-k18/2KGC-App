import { describe, expect, it } from 'vitest';

import { SETTINGS_DEFAULTS, brandPalette } from '@kgc/shared';

import { mergeSettings, themeWithBrand } from './event-settings-core';

const colors = {
  header: '#2069BC',
  onHeader: '#FFFFFF',
  headerDeep: '#0C4884',
  tint: '#2069BC',
  accent: '#2069BC',
  onAccent: '#FFFFFF',
  tintSoft: '#E1ECF8',
  text: '#000000',
  danger: '#D70015',
} as unknown as Parameters<typeof themeWithBrand>[0];

describe('mergeSettings', () => {
  it('returns the defaults for a missing document or another event', () => {
    expect(mergeSettings(SETTINGS_DEFAULTS.branding, undefined)).toEqual(SETTINGS_DEFAULTS.branding);
    expect(
      mergeSettings(SETTINGS_DEFAULTS.branding, { eventId: 'other', values: { tagline: 'x' } }),
    ).toEqual(SETTINGS_DEFAULTS.branding);
  });

  it('takes stored values and drops a null or an unknown key', () => {
    const out = mergeSettings(SETTINGS_DEFAULTS.branding, {
      eventId: 'kgc-2027',
      values: { brandColor: '#0A7F5A', supportEmail: null, invented: 'x' },
    });
    expect(out.brandColor).toBe('#0A7F5A');
    expect(out.supportEmail).toBe('');
    expect('invented' in out).toBe(false);
  });

  it('keeps a stored tier list and falls back when it is empty', () => {
    const stored = [{ id: 'diamond', name: 'Diamond', size: 3 }];
    expect(
      mergeSettings(SETTINGS_DEFAULTS.sponsorTiers, { eventId: 'kgc-2027', values: { tiers: stored } }).tiers,
    ).toEqual(stored);
    expect(
      mergeSettings(SETTINGS_DEFAULTS.sponsorTiers, { eventId: 'kgc-2027', values: { tiers: [] } }).tiers,
    ).toEqual(SETTINGS_DEFAULTS.sponsorTiers.tiers);
  });
});

describe('themeWithBrand', () => {
  it('leaves the palette alone when no colour is saved', () => {
    expect(themeWithBrand(colors, brandPalette(''))).toBe(colors);
  });

  it('moves the brand keys and nothing else', () => {
    const out = themeWithBrand(colors, brandPalette('#0A7F5A'));
    expect(out.header).toBe('#0A7F5A');
    expect(out.accent).toBe('#0A7F5A');
    expect(out.onHeader).toBe('#FFFFFF');
    expect(out.headerDeep).not.toBe(colors.headerDeep);
    expect(out.text).toBe(colors.text);
    expect(out.danger).toBe(colors.danger);
  });

  it('keeps links readable when the brand colour is pale', () => {
    const out = themeWithBrand(colors, brandPalette('#FFD400'));
    expect(out.header).toBe('#FFD400');
    expect(out.onHeader).toBe('#111111');
    expect(out.tint).not.toBe('#FFD400');
  });
});
