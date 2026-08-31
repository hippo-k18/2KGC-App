'use server';

import { SETTINGS_REGISTER } from '@kgc/shared';
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
 * The confirmation line, derived from the register.
 *
 * A settings screen whose success message is a hand-written string is a screen
 * that will keep saying "nothing reads this" for a month after something does.
 * Given the fields a form owns, this reports the strongest thing true of any of
 * them, so the day FU-11 flips an entry to `live` the wording follows.
 */
function reach(fields: readonly (keyof typeof SETTINGS_REGISTER.branding)[]): string {
  const facts = fields.map((f) => SETTINGS_REGISTER.branding[f]);
  const live = facts.filter((f) => f.status === 'live');
  const waiting = facts.find((f) => f.status === 'pending')?.handoff;
  const recorded = facts.some((f) => f.status === 'recorded');

  // Every branch names what did *not* happen, because that is the half an
  // organizer cannot see. "Saved" alone is the message this task exists to fix.
  if (live.length === facts.length) return 'Saved and live.';
  const parts = ['Recorded and audited.'];
  if (recorded) parts.push('No surface can apply the colours — that is a decision, not a gap.');
  if (waiting) parts.push(`The rest is waiting on ${waiting} in docs/audit-2026-08-30/FOLLOW-UPS.md.`);
  return parts.join(' ');
}

/**
 * The `branding` settings bag, written by two screens.
 *
 * One action rather than two because both write the same document and
 * `saveSettings` merges — a screen that renders half a bag must not blank the
 * other half, which is exactly what two independent full-bag writes would do.
 *
 * ⚠️ **What each field reaches is `SETTINGS_REGISTER.branding` in
 * `@kgc/shared`, not this comment.** The two colours are `recorded` — no
 * surface can honour them — and the four text fields are `pending` behind
 * FU-11. The save messages below are built from that register rather than
 * written out, so they cannot drift from it and cannot report a success that
 * would be read as "the app is now green".
 *
 * ── Clearing ───────────────────────────────────────────────────────────────
 *
 * Every field here is optional, which is the shape AGENTS.md gotcha 9 bites
 * hardest. `null` is passed deliberately: `saveSettings` turns it into
 * `FieldValue.delete()`, so emptying the support address actually empties it
 * rather than reporting "Saved" over the old one.
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

    return res.ok ? { ok: true, message: reach(['brandColor', 'tagline']) } : { error: res.error };
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
    return res.ok ? { ok: true, message: reach(['brandedSlug']) } : { error: res.error };
  }

  return { error: 'Unknown form.' };
}
