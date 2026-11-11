import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as email from './email.js';
import { EMAIL_FORMATS, SAMPLE_CODE, SAMPLE_TO, findFormat, renderFormat, searchFormats } from './email-catalogue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const emailSource = readFileSync(path.join(here, 'email.ts'), 'utf8');
const catalogueSource = readFileSync(path.join(here, 'email-catalogue.ts'), 'utf8');
const modelsSource = readFileSync(path.join(here, '../../../packages/shared/src/models.ts'), 'utf8');

/** Exported `send…` functions that are settings or helpers, not senders. */
const NOT_SENDERS = new Set(['sendOutcomeMessage', 'sendTimeoutMs', 'sendRatePerSecond', 'sendMaxAttempts']);

/** Every exported sender, by name. Aliases (`sendAccessCode`) collapse onto the function they name. */
function exportedSenders(): string[] {
  const seen = new Map<unknown, string>();
  for (const [name, value] of Object.entries(email)) {
    if (!/^send[A-Z]/.test(name) || typeof value !== 'function' || NOT_SENDERS.has(name)) continue;
    if (!seen.has(value) || /^sendBlog/.test(name)) seen.set(value, name);
  }
  return [...seen.values()].sort();
}

/** The `template` values `EmailLogDoc` allows, read from the model. */
function logTemplates(): string[] {
  const start = modelsSource.indexOf('export interface EmailLogDoc');
  const block = modelsSource.slice(start, modelsSource.indexOf('status:', start));
  return [...block.matchAll(/\|\s*"([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
}

describe('the catalogue of email formats (T292)', () => {
  it('has an entry for every exported sender in email.ts', () => {
    const covered = new Set(EMAIL_FORMATS.map((f) => f.sender));
    const missing = exportedSenders().filter((name) => !covered.has(name as never));
    expect(missing, 'add these to EMAIL_FORMATS in email-catalogue.ts').toEqual([]);
  });

  it('has an entry for every template the Email Log can record', () => {
    const covered = new Set(EMAIL_FORMATS.map((f) => f.template));
    const templates = logTemplates();
    expect(templates.length).toBeGreaterThan(20);
    expect(templates.filter((t) => !covered.has(t as never)), 'add these to EMAIL_FORMATS').toEqual([]);
  });

  it('has an entry for every template named in email.ts itself', () => {
    const named = new Set([...emailSource.matchAll(/template: '([a-z0-9-]+)'/g)].map((m) => m[1]));
    const covered = new Set(EMAIL_FORMATS.map((f) => f.template));
    expect([...named].filter((t) => !covered.has(t as never))).toEqual([]);
  });

  it('uses every exported message builder, so none can be left out', () => {
    const builders = Object.entries(email)
      .filter(([name, value]) => typeof value === 'function' && /Message$/.test(name) && !/^send/.test(name))
      .map(([name]) => name);
    expect(builders.length).toBeGreaterThan(20);
    expect(builders.filter((name) => !new RegExp(`\\b${name}\\(`).test(catalogueSource))).toEqual([]);
  });

  it('gives every format a unique id, a trigger, a recipient and at least one variant', () => {
    const ids = EMAIL_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of EMAIL_FORMATS) {
      expect(f.name && f.when && f.to, f.id).toBeTruthy();
      expect(f.variants.length, f.id).toBeGreaterThan(0);
      expect(new Set(f.variants.map((x) => x.id)).size, f.id).toBe(f.variants.length);
    }
  });

  it('renders every variant with sample data, a subject, HTML and text, and no em dash in our own words', () => {
    for (const f of EMAIL_FORMATS) {
      expect(`${f.name} ${f.when} ${f.to} ${f.variants.map((x) => x.label).join(' ')}`).not.toContain('—');
      for (const variant of f.variants) {
        const { email: e } = renderFormat(f, variant.id);
        expect(e.subject, `${f.id}/${variant.id}`).toBeTruthy();
        expect(e.html, `${f.id}/${variant.id}`).toContain('<html>');
        expect(e.text, `${f.id}/${variant.id}`).toBeTruthy();
        expect(e.to).toBe(SAMPLE_TO);
        expect(e.from).toContain('contact@');
      }
    }
  });

  it('shows only the fake code in sign-in samples', () => {
    for (const id of ['sign-in-code', 'ticket-sign-in-code', 'dashboard-sign-in-code', 'blog-sign-in-code']) {
      const f = findFormat(id)!;
      for (const variant of f.variants) {
        const { email: e } = renderFormat(f, variant.id);
        expect(e.text).toContain(SAMPLE_CODE);
        expect(`${e.subject}${e.text}`.match(/\b\d{6}\b/g)?.every((c) => c === SAMPLE_CODE) ?? true).toBe(true);
      }
    }
  });

  it('renders the same words the sender sends', () => {
    // The two that pass through `send()` with the most transformation.
    const decline = renderFormat(findFormat('cfp-decision-declined')!, 'no-reason').email;
    expect(decline.subject).toBe('Your KGC 2027 submission');
    expect(renderFormat(findFormat('dashboard-sign-in-code')!, 'confirm').email.subject).toBe(
      `${SAMPLE_CODE} confirms your KGC dashboard action`,
    );
    expect(renderFormat(findFormat('seat-promotion')!).email.subject).toBe('You have a seat in Sample Workshop');
  });

  it('falls back to the first variant for an unknown one', () => {
    const f = findFormat('cfp-accepted')!;
    expect(renderFormat(f, 'nope').variant.id).toBe(f.variants[0].id);
  });

  it('searches names, triggers, recipients and subjects', () => {
    expect(searchFormats(EMAIL_FORMATS, '')).toHaveLength(EMAIL_FORMATS.length);
    expect(searchFormats(EMAIL_FORMATS, 'refund').map((f) => f.id)).toContain('refund-confirmation');
    expect(searchFormats(EMAIL_FORMATS, 'THURSDAY').map((f) => f.id)).toEqual(['cfp-weekly-reminder']);
    expect(searchFormats(EMAIL_FORMATS, 'waitlist seat').map((f) => f.id)).toEqual(['seat-promotion']);
    expect(searchFormats(EMAIL_FORMATS, 'Accepted: Sample').map((f) => f.id)).toContain('cfp-accept-notice');
    expect(searchFormats(EMAIL_FORMATS, 'zzzz-nothing')).toEqual([]);
  });
});
