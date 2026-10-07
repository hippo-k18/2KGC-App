/**
 * The Event block's `location`, per Google's Event guidelines: a mixed event
 * names its Place and a VirtualLocation, an online one only the VirtualLocation,
 * an in-person one only the Place (SEO review, 2026-09-28).
 */
import { describe, expect, it } from 'vitest';
import { eventJsonLd } from '../../apps/web/src/lib/event-jsonld';

const ORIGIN = 'https://www.knowledgegraph.tech';
const agenda = [
  { day: '2027-05-03', sessions: [{ startsAtLocal: '2027-05-03T09:00', endsAtLocal: '2027-05-03T10:00' }] },
] as never;
const tier = (inPerson: boolean) => ({ id: inPerson ? 'all-access' : 'virtual', name: 'T', priceCents: 100, currency: 'usd', inPerson }) as never;

function locationFor(tiers: never[], savedEventType?: 'hybrid' | 'virtual' | 'in-person') {
  const node = eventJsonLd({
    origin: ORIGIN,
    pageUrl: `${ORIGIN}/`,
    agenda,
    tiers,
    description: 'd',
    event: { name: 'Knowledge Graph Conference 2027', venue: 'Jay Conference Bryant Park, New York, NY', timeZone: 'America/New_York', savedEventType },
  }) as Record<string, unknown>;
  // Round-trip through JSON, as the page serialises it.
  return JSON.parse(JSON.stringify(node)) as { eventAttendanceMode?: string; location: unknown };
}

describe('Event JSON-LD location', () => {
  it('gives a mixed event its Place and a VirtualLocation on the tickets page', () => {
    const n = locationFor([tier(true), tier(false)]);
    expect(n.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode');
    expect(n.location).toEqual([
      expect.objectContaining({ '@type': 'Place', name: 'Jay Conference Bryant Park' }),
      { '@type': 'VirtualLocation', url: `${ORIGIN}/tickets` },
    ]);
  });

  it('gives an online event only the VirtualLocation', () => {
    expect(locationFor([tier(false)]).location).toEqual({ '@type': 'VirtualLocation', url: `${ORIGIN}/tickets` });
  });

  it('gives an in-person event only the Place, and follows a saved event type', () => {
    expect(locationFor([tier(true)]).location).toMatchObject({ '@type': 'Place' });
    expect(locationFor([tier(true)], 'hybrid').location).toHaveLength(2);
  });
});
