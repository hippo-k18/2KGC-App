import type { FieldSpec } from '@/lib/csv-import';

/**
 * The parsing and validation half of the sponsor editor.
 *
 * Pure, and deliberately in its own module rather than in `actions.ts`: a
 * `'use server'` file may only export async functions, so a synchronous helper
 * exported from one is a build error rather than a lint warning. Keeping these
 * here also keeps them callable from the importer, which has to apply exactly
 * the same rules — an import that accepted a `javascript:` website the form
 * rejects would be a hole with a spreadsheet in front of it.
 *
 * No `server-only`: nothing here touches Firestore or a credential, and the
 * module that does keeps the marker.
 */

/** How many offers the app can show before the list stops being a list. */
export const MAX_OFFERS = 12;
export const MAX_OFFER_LENGTH = 120;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** URL-safe and readable, so a Firestore path is legible in the console. */
export function sponsorSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

/**
 * A website an organizer typed, turned into one a browser and a phone can both
 * open — or rejected.
 *
 * Three surfaces consume this string and none of them sanitises it: the public
 * site puts it straight into an `href` (`apps/web/src/components/sponsor-tiers.tsx:64`),
 * the dashboard row does the same, and the app hands it to `Linking.openURL`
 * (`app/src/app/(tabs)/people/sponsor/[id].tsx:126`). So a `javascript:` value
 * typed here would be stored script on a public marketing page, and a bare
 * `acme.com` would be a *relative* link on the website — one that resolves
 * under `/sponsor/` and 404s.
 *
 * Returns the normalised URL, `''` for "not given", or `null` when the value
 * cannot be made into a web address at all.
 */
export function normaliseWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * One offer per line.
 *
 * The app renders the first two as directory-row tags (`people/index.tsx:400`)
 * and the whole list under "AT THE BOOTH" on the sponsor screen, so these are
 * phrases — "Live demo at 2pm", "Free coffee all day" — not paragraphs. Blank
 * lines are dropped rather than stored, or the app draws an empty tag.
 */
export function parseOffers(raw: string): { offers: string[]; error?: string } {
  const offers = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (offers.length > MAX_OFFERS) {
    return {
      offers,
      error:
        `That is ${offers.length} offers. Keep it to ${MAX_OFFERS} — the app shows the first ` +
        'two on the directory row and the rest on one screen.',
    };
  }

  const tooLong = offers.find((o) => o.length > MAX_OFFER_LENGTH);
  if (tooLong) {
    return {
      offers,
      error:
        `“${tooLong.slice(0, 40)}…” is too long for a tag. Keep each offer under ` +
        `${MAX_OFFER_LENGTH} characters.`,
    };
  }

  return { offers };
}

/**
 * The columns a sponsorship spreadsheet is expected to have.
 *
 * Defined here rather than added to `lib/csv-import.ts` alongside
 * `ATTENDEE_FIELDS` because that module is shared and under active edit by
 * other screens; the generic `parseCsv` / `buildPreview` it exports is all this
 * needs from it.
 *
 * `logoURL` is a column rather than an upload: a spreadsheet cannot carry
 * bytes, and a sponsorship deck usually does carry a link to the company's
 * press-kit logo. Whatever it holds is replaceable one sponsor at a time
 * through the form's picker afterwards.
 */
export const SPONSOR_FIELDS: FieldSpec[] = [
  {
    key: 'name',
    label: 'Company',
    aliases: ['sponsor', 'sponsor name', 'company name', 'organisation', 'organization', 'account'],
    required: true,
  },
  {
    key: 'tier',
    label: 'Tier',
    aliases: ['level', 'package', 'sponsorship level', 'sponsorship tier'],
    required: true,
    // Validated against the runtime list by the importer, which holds the one
    // copy of it. Here it is only shaped, so the error names the column.
    validate: (v) =>
      /^(platinum|gold|silver|bronze)$/i.test(v.trim())
        ? undefined
        : `“${v}” is not a tier. Use Platinum, Gold, Silver or Bronze.`,
  },
  {
    key: 'website',
    label: 'Website',
    aliases: ['url', 'site', 'web', 'homepage'],
    validate: (v) => (normaliseWebsite(v) === null ? `“${v}” is not a web address.` : undefined),
  },
  {
    key: 'boothLocation',
    label: 'Booth',
    aliases: ['booth number', 'stand', 'table', 'location'],
  },
  {
    key: 'contactName',
    label: 'Main contact',
    aliases: ['contact', 'primary contact', 'contact person'],
  },
  {
    key: 'contactEmail',
    label: 'Contact email',
    aliases: ['email', 'e-mail', 'email address', 'contact e-mail'],
    validate: (v) => (EMAIL.test(v.trim()) ? undefined : `“${v}” is not an email address.`),
  },
  {
    key: 'description',
    label: 'Description',
    aliases: ['about', 'blurb', 'bio', 'summary'],
  },
  {
    key: 'logoURL',
    label: 'Logo URL',
    aliases: ['logo', 'logo link', 'image'],
    validate: (v) => (normaliseWebsite(v) === null ? `“${v}” is not a URL.` : undefined),
  },
];
