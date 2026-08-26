'use server';

import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

export interface BrandingState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * The `branding` settings bag, written by two screens.
 *
 * One action rather than two because both write the same document and
 * `saveSettings` merges — a screen that renders half a bag must not blank the
 * other half, which is exactly what two independent full-bag writes would do.
 *
 * ⚠️ Every value here is **recorded, not applied**. Nothing reads this document:
 * the Expo app compiles its palette from `app/src/constants/theme.ts`, and the
 * branded URL needs DNS plus a route in `apps/web`. Both screens say so on the
 * page, and the save messages below repeat it rather than reporting a success
 * that would be read as "the app is now green".
 */
export async function saveBrandingAction(
  _prev: BrandingState,
  formData: FormData,
): Promise<BrandingState> {
  const actor = await requireOrganizer();
  const which = String(formData.get('which') ?? '');

  if (which === 'app') {
    const brandColor = String(formData.get('brandColor') ?? '').trim();
    const accentColor = String(formData.get('accentColor') ?? '').trim();
    const tagline = String(formData.get('tagline') ?? '').trim();
    const supportEmail = String(formData.get('supportEmail') ?? '').trim();
    const hashtag = String(formData.get('hashtag') ?? '').trim().replace(/^#/, '');

    if (brandColor && !HEX.test(brandColor)) {
      return { error: 'Brand colour must be a six-digit hex value, like #2069BC.' };
    }
    if (accentColor && !HEX.test(accentColor)) {
      return { error: 'Accent colour must be a six-digit hex value, like #24A8E4.' };
    }
    if (supportEmail && !EMAIL.test(supportEmail)) {
      return { error: 'That support address is not a valid email.' };
    }
    if (hashtag && !/^[A-Za-z0-9_]{1,30}$/.test(hashtag)) {
      return { error: 'A hashtag is letters, digits and underscores — no spaces or punctuation.' };
    }
    if (tagline.length > 80) return { error: 'Keep the tagline under 80 characters.' };

    const res = await saveSettings(
      SETTINGS_KEYS.branding,
      {
        brandColor: brandColor.toUpperCase() || null,
        accentColor: accentColor.toUpperCase() || null,
        tagline: tagline || null,
        supportEmail: supportEmail.toLowerCase() || null,
        hashtag: hashtag || null,
      },
      actor,
    );

    return res.ok
      ? { ok: true, message: 'Recorded. The app still ships the palette in constants/theme.ts — this changes no phone.' }
      : { error: res.error };
  }

  if (which === 'url') {
    const slug = String(formData.get('brandedSlug') ?? '').trim().toLowerCase();

    /**
     * Refused rather than sanitised. A slug quietly rewritten from what was
     * typed is a slug that does not match the one already printed on a
     * conference flyer, and nobody notices until the QR code goes nowhere.
     */
    if (slug && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
      return {
        error: '3–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.',
      };
    }

    const res = await saveSettings(SETTINGS_KEYS.branding, { brandedSlug: slug || null }, actor);
    return res.ok
      ? { ok: true, message: 'Recorded. Nothing resolves this address yet — see below for what would.' }
      : { error: res.error };
  }

  return { error: 'Unknown form.' };
}
