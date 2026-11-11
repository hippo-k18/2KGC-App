import { describe, expect, it } from 'vitest';
import { HCLS_ORGANIZERS, initials, linkLabel } from './hcls-organizers';

describe('HCLS organizers (T381)', () => {
  it('lists the six organizers in the order they were given', () => {
    expect(HCLS_ORGANIZERS.map((o) => o.name)).toEqual([
      'Helena Deus',
      'Tom Plasterer',
      'Deborah McGuinness',
      'Jamie McCusker',
      'Ted Slater',
      'Analee Etheridge',
    ]);
  });

  it('uses exactly the verified links', () => {
    expect(Object.fromEntries(HCLS_ORGANIZERS.map((o) => [o.name, o.link]))).toEqual({
      'Helena Deus': 'https://www.linkedin.com/in/helenadeus/',
      'Tom Plasterer': 'https://www.linkedin.com/in/tplasterer',
      'Deborah McGuinness': 'https://en.wikipedia.org/wiki/Deborah_McGuinness',
      'Jamie McCusker': 'https://www.linkedin.com/in/jpmccu',
      'Ted Slater': 'https://www.linkedin.com/in/tedslater',
      'Analee Etheridge': 'https://www.linkedin.com/in/aetheredge/',
    });
  });

  it('shows no out-of-date affiliation for Tom Plasterer', () => {
    expect(HCLS_ORGANIZERS.find((o) => o.name === 'Tom Plasterer')?.affiliation).toBeNull();
  });

  it('names the site each link goes to', () => {
    expect(linkLabel('https://www.linkedin.com/in/tedslater')).toBe('LinkedIn');
    expect(linkLabel('https://en.wikipedia.org/wiki/Deborah_McGuinness')).toBe('Wikipedia');
    expect(linkLabel('https://example.org/x')).toBe('Profile');
  });

  it('makes initials for the avatar', () => {
    expect(initials('Analee Etheridge')).toBe('AE');
  });
});
