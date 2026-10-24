import { describe, expect, it } from 'vitest';

import { contactAddress, PRIVACY_URL, TERMS_URL } from './legal';

describe('legal links', () => {
  it('uses the support address saved on the dashboard', () =>
    expect(contactAddress('help@example.org')).toBe('help@example.org'));

  it('falls back to the conference address when none is set', () => {
    expect(contactAddress('')).toBe('contact@knowledgegraph.tech');
    expect(contactAddress('  ')).toBe('contact@knowledgegraph.tech');
    expect(contactAddress(null)).toBe('contact@knowledgegraph.tech');
  });

  it('points at the website on www, not a deleted Netlify site', () => {
    expect(PRIVACY_URL).toBe('https://www.knowledgegraph.tech/privacy');
    expect(TERMS_URL).toBe('https://www.knowledgegraph.tech/terms');
  });
});
