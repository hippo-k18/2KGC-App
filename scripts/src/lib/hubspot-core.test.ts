import { describe, expect, it } from 'vitest';

import { HUBSPOT_MAX_ATTEMPTS, HUBSPOT_SOURCE_FIELDS, type HubspotPropertyOption } from '@kgc/shared';
import {
  EVENT_YEAR,
  HUBSPOT_SCOPES,
  PARKED_AT,
  checkMapping,
  chunk,
  compatible,
  errorKind,
  fieldOptions,
  formatValue,
  hubspotErrorMessage,
  isKgcProperty,
  isLive,
  kgcPropertyDefs,
  looksLikeHubspotToken,
  mappableProperties,
  maskToken,
  missingScopes,
  networkErrorMessage,
  nextAttemptAt,
  personValues,
  planContacts,
  propertiesToRead,
  redact,
  registrationStatusLabel,
  retryDelayMs,
  seatPaidCents,
  sourceValues,
  splitName,
  type CurrentContact,
  type HubspotRawProperty,
  type RegistrantFacts,
} from './hubspot-core.js';

/** A made-up token in HubSpot's shape. Never a real one. */
/** Built from parts at runtime so no source line looks like a HubSpot token to secret scanners. */
const FAKE_TOKEN = ['pat', 'na1', '00000000', '0000', '4000', '8000', '000000000001'].join('-');
/** Made up too: shaped like a key with no `pat-` prefix, as HubSpot's newer service keys may be. */
const FAKE_SERVICE_KEY = 'CiRuYTEtMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAyEhAAAAAAAAAAAAAAAAAAAAAA';

const DAY = (d: number) => Date.UTC(2026, 9, d, 15, 0);

const facts = (over: Partial<RegistrantFacts> = {}): RegistrantFacts => ({
  registrationId: 'reg_1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  company: 'Analytical Engines',
  title: 'Mathematician',
  ticketType: 'Main Conference',
  status: 'active',
  orderStatus: 'paid',
  purchasedAt: DAY(3),
  amountCents: 79_900,
  promoCode: 'EARLY',
  inPerson: true,
  checkedIn: false,
  ...over,
});

/** Every ordering of a list, for proving a result does not depend on order. */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

describe('splitName', () => {
  it('takes the first word as the first name and the rest as the last name', () => {
    expect(splitName('Ada Lovelace King')).toEqual({ first: 'Ada', last: 'Lovelace King' });
  });
  it('treats one word as a first name only', () => {
    expect(splitName('Ada')).toEqual({ first: 'Ada' });
  });
  it('collapses extra spaces', () => {
    expect(splitName('  Ada   Lovelace  ')).toEqual({ first: 'Ada', last: 'Lovelace' });
  });
  it('returns nothing for a blank or missing name', () => {
    expect(splitName('   ')).toEqual({});
    expect(splitName(undefined)).toEqual({});
  });
});

describe('registrationStatusLabel and sourceValues', () => {
  it('labels each registration state', () => {
    expect(registrationStatusLabel(facts())).toBe('Registered');
    expect(registrationStatusLabel(facts({ orderStatus: 'refunded', status: 'cancelled' }))).toBe('Refunded');
    expect(registrationStatusLabel(facts({ status: 'cancelled', orderStatus: 'paid' }))).toBe('Cancelled');
    expect(registrationStatusLabel(facts({ status: 'transferred', orderStatus: 'refunded' }))).toBe('Transferred');
    expect(registrationStatusLabel(facts({ orderStatus: 'partially_refunded' }))).toBe('Registered');
    expect(isLive(facts())).toBe(true);
    expect(isLive(facts({ orderStatus: 'refunded' }))).toBe(false);
  });

  it('gives every source field a value for a one-ticket person', () => {
    const v = sourceValues(facts({ checkedIn: true }));
    expect(v).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      jobTitle: 'Mathematician',
      ticketType: 'Main Conference',
      orderDate: DAY(3),
      amount: 799,
      attendance: 'In person',
      promoCode: 'EARLY',
      checkedIn: true,
      registrationStatus: 'Registered',
    });
    expect(Object.keys(v).sort()).toEqual(HUBSPOT_SOURCE_FIELDS.map((f) => f.key).sort());
  });

  it('uses null for anything we do not have, so nothing is blanked', () => {
    const v = sourceValues(
      facts({ name: undefined, company: '  ', title: undefined, ticketType: undefined, purchasedAt: Number.NaN, amountCents: undefined, promoCode: '', inPerson: undefined }),
    );
    for (const k of ['firstName', 'lastName', 'company', 'jobTitle', 'ticketType', 'orderDate', 'amount', 'promoCode', 'attendance'] as const) expect(v[k]).toBeNull();
    expect(v.checkedIn).toBe(false);
  });

  it('says Virtual for a ticket that is not in person, and keeps a free ticket as 0', () => {
    const v = sourceValues(facts({ inPerson: false, amountCents: 0 }));
    expect(v.attendance).toBe('Virtual');
    expect(v.amount).toBe(0);
  });
});

describe('personValues: one contact from all of a person’s tickets', () => {
  const four = [
    facts({ registrationId: 'reg_a', ticketType: 'Main Conference', purchasedAt: DAY(3), amountCents: 79_900 }),
    facts({ registrationId: 'reg_b', ticketType: 'Main Conference', purchasedAt: DAY(4), amountCents: 79_900 }),
    facts({ registrationId: 'reg_c', ticketType: 'Workshops', purchasedAt: DAY(5), amountCents: 29_900 }),
    facts({ registrationId: 'reg_d', ticketType: 'Virtual Pass', inPerson: false, purchasedAt: DAY(6), amountCents: 12_900, orderStatus: 'refunded', status: 'cancelled' }),
  ];

  it('X1 / 3.2: four tickets with one refunded is still Registered', () => {
    const v = personValues(four);
    expect(v.registrationStatus).toBe('Registered');
    // Ticket type and attendance come from the live tickets only.
    expect(v.ticketType).toBe('Main Conference, Workshops');
    expect(v.attendance).toBe('In person');
  });

  it('all tickets refunded is Refunded', () => {
    const v = personValues(four.map((f) => ({ ...f, orderStatus: 'refunded', status: 'cancelled' as const })));
    expect(v.registrationStatus).toBe('Refunded');
    // With nothing live, every ticket counts.
    expect(v.ticketType).toBe('Main Conference, Virtual Pass, Workshops');
    expect(v.attendance).toBe('In person and virtual');
  });

  it('with nothing live: Refunded beats Cancelled beats Transferred', () => {
    const cancelled = facts({ registrationId: 'c', status: 'cancelled' });
    const transferred = facts({ registrationId: 't', status: 'transferred' });
    const refunded = facts({ registrationId: 'r', orderStatus: 'refunded', status: 'cancelled' });
    expect(personValues([cancelled, transferred]).registrationStatus).toBe('Cancelled');
    expect(personValues([transferred]).registrationStatus).toBe('Transferred');
    expect(personValues([transferred, refunded, cancelled]).registrationStatus).toBe('Refunded');
    expect(personValues([transferred, cancelled, facts({ registrationId: 'live' })]).registrationStatus).toBe('Registered');
  });

  it('joins ticket types and promo codes once each, alphabetically', () => {
    const v = personValues([
      facts({ registrationId: 'a', ticketType: 'Virtual Pass', promoCode: 'ZED' }),
      facts({ registrationId: 'b', ticketType: 'Main Conference', promoCode: 'EARLY' }),
      facts({ registrationId: 'c', ticketType: 'Main Conference', promoCode: ' ' }),
    ]);
    expect(v.ticketType).toBe('Main Conference, Virtual Pass');
    expect(v.promoCode).toBe('EARLY, ZED');
  });

  it('says In person and virtual for a mix of live tickets', () => {
    const v = personValues([facts({ registrationId: 'a', inPerson: true }), facts({ registrationId: 'b', inPerson: false }), facts({ registrationId: 'c', inPerson: undefined })]);
    expect(v.attendance).toBe('In person and virtual');
    expect(personValues([facts({ inPerson: false }), facts({ registrationId: 'b', inPerson: false })]).attendance).toBe('Virtual');
  });

  it('sums what was paid across every ticket, before refunds', () => {
    expect(personValues(four).amount).toBe((79_900 + 79_900 + 29_900 + 12_900) / 100);
    expect(personValues([facts({ amountCents: undefined }), facts({ registrationId: 'b', amountCents: 29_950 })]).amount).toBe(299.5);
  });

  it('gives the earliest purchase as the order date', () => {
    expect(personValues(four).orderDate).toBe(DAY(3));
    expect(personValues([facts({ purchasedAt: undefined }), facts({ registrationId: 'b', purchasedAt: DAY(9) })]).orderDate).toBe(DAY(9));
  });

  it('is checked in when any ticket was', () => {
    expect(personValues(four).checkedIn).toBe(false);
    expect(personValues([...four.slice(0, 3), { ...four[3], checkedIn: true }]).checkedIn).toBe(true);
  });

  it('takes the name, company and title from the newest live ticket, falling back to any', () => {
    const v = personValues([
      facts({ registrationId: 'old', name: 'Ada Old', company: 'Old Co', purchasedAt: DAY(1) }),
      facts({ registrationId: 'new', name: 'Ada Newest', company: '', title: 'CTO', purchasedAt: DAY(9) }),
      facts({ registrationId: 'gone', name: 'Not Live', purchasedAt: DAY(20), status: 'cancelled' }),
    ]);
    expect(v).toMatchObject({ firstName: 'Ada', lastName: 'Newest', company: 'Old Co', jobTitle: 'CTO' });
  });

  it('gives the same values whatever order the registrations come in', () => {
    const want = personValues(four);
    for (const order of permutations(four)) expect(personValues(order)).toEqual(want);
    const tie = [facts({ registrationId: 'x', name: 'Ada X', purchasedAt: DAY(3) }), facts({ registrationId: 'y', name: 'Ada Y', purchasedAt: DAY(3) })];
    expect(personValues(tie)).toEqual(personValues([...tie].reverse()));
  });

  it('has no status and no check-in for a person with no registrations', () => {
    const v = personValues([]);
    expect(v.registrationStatus).toBeNull();
    expect(v.checkedIn).toBeNull();
  });
});

describe('seatPaidCents', () => {
  const line = (unitPriceCents: number, quantity = 1) => ({ unitPriceCents, quantity });

  it('1.8: shares a promo across a two-seat order, half each, not the list price', () => {
    const order = { totalCents: 59_900, items: [line(59_900), line(59_900)] };
    expect(seatPaidCents(order, order.items[0])).toBe(29_950);
    expect(seatPaidCents(order, order.items[1])).toBe(29_950);
  });

  it('shares an order total in proportion to list price', () => {
    const order = { totalCents: 49_900, items: [line(79_900), line(19_900)] };
    const a = seatPaidCents(order, order.items[0])!;
    const b = seatPaidCents(order, order.items[1])!;
    expect(Math.abs(a + b - 49_900)).toBeLessThanOrEqual(1);
    expect(a).toBeGreaterThan(b);
  });

  it('a line of two seats is priced per seat', () => {
    const order = { totalCents: 100, items: [line(100, 2)] };
    expect(seatPaidCents(order, order.items[0])).toBe(50);
  });

  it('a single seat gets the whole order total', () => {
    expect(seatPaidCents({ totalCents: 71_910, items: [line(79_900)] }, line(79_900))).toBe(71_910);
    expect(seatPaidCents({ totalCents: 71_910, items: [line(79_900)] }, undefined)).toBe(71_910);
    expect(seatPaidCents({ totalCents: 71_910 }, undefined)).toBe(71_910);
  });

  it('free tickets are 0; an unknown seat or order is unknown, never a guess', () => {
    const free = { totalCents: 0, items: [line(0), line(0)] };
    expect(seatPaidCents(free, free.items[0])).toBe(0);
    expect(seatPaidCents({ totalCents: 59_900, items: [line(59_900), line(59_900)] }, undefined)).toBeUndefined();
    expect(seatPaidCents(undefined, line(1))).toBeUndefined();
    expect(seatPaidCents({ items: [line(1)] }, line(1))).toBeUndefined();
  });
});

describe('formatValue', () => {
  const day = Date.UTC(2026, 9, 3, 15, 30);
  it('writes a date property as YYYY-MM-DD', () => {
    expect(formatValue('date', day, 'date')).toBe('2026-10-03');
  });
  it('uses the day in New York, not the UTC day, for an evening purchase', () => {
    // 21:30 on 3 October in New York is 01:30 on 4 October in UTC.
    const evening = Date.UTC(2026, 9, 4, 1, 30);
    expect(formatValue('date', evening, 'date')).toBe('2026-10-03');
    expect(formatValue('date', evening, 'string')).toBe('2026-10-03');
    expect(formatValue('date', Date.UTC(2026, 11, 31, 23, 0), 'date')).toBe('2026-12-31');
  });
  it('writes a datetime property as an ISO timestamp', () => {
    expect(formatValue('date', day, 'datetime')).toBe('2026-10-03T15:30:00.000Z');
  });
  it('writes a number property as digits, rounded to cents', () => {
    expect(formatValue('number', 799, 'number')).toBe('799');
    expect(formatValue('number', 12.345, 'number')).toBe('12.35');
  });
  it('writes a checkbox as true or false', () => {
    expect(formatValue('bool', true, 'bool')).toBe('true');
    expect(formatValue('bool', false, 'enumeration')).toBe('false');
  });
  it('writes the readable form into a text property', () => {
    expect(formatValue('string', 'Main Conference', 'string')).toBe('Main Conference');
    expect(formatValue('date', day, 'string')).toBe('2026-10-03');
    expect(formatValue('bool', true, 'string')).toBe('Yes');
    expect(formatValue('bool', false, 'string')).toBe('No');
    expect(formatValue('number', 799, 'string')).toBe('799.00');
  });
  it('sends nothing when the value does not fit the property', () => {
    expect(formatValue('string', 'x', 'date')).toBeNull();
    expect(formatValue('string', 'x', 'datetime')).toBeNull();
    expect(formatValue('string', 'x', 'number')).toBeNull();
    expect(formatValue('number', 1, 'bool')).toBeNull();
    expect(formatValue('string', 'yes', 'enumeration')).toBeNull();
  });
  it('sends nothing for a value we do not have', () => {
    expect(formatValue('string', null, 'string')).toBeNull();
    expect(formatValue('date', null, 'date')).toBeNull();
  });
});

const raw = (name: string, type: string, fieldType: string, extra: Partial<HubspotRawProperty> = {}): HubspotRawProperty => ({
  name,
  label: name,
  type,
  fieldType,
  groupName: 'contactinformation',
  ...extra,
});

describe('compatible and mappableProperties', () => {
  it('lets text take anything except file and html fields', () => {
    for (const kind of ['string', 'date', 'number', 'bool'] as const) expect(compatible(kind, { type: 'string', fieldType: 'text' })).toBe(true);
    expect(compatible('string', { type: 'string', fieldType: 'file' })).toBe(false);
    expect(compatible('string', { type: 'string', fieldType: 'html' })).toBe(false);
  });
  it('needs a matching type for dates, numbers and checkboxes', () => {
    expect(compatible('date', { type: 'date', fieldType: 'date' })).toBe(true);
    expect(compatible('date', { type: 'datetime', fieldType: 'date' })).toBe(true);
    expect(compatible('date', { type: 'number', fieldType: 'number' })).toBe(false);
    expect(compatible('number', { type: 'number', fieldType: 'number' })).toBe(true);
    expect(compatible('number', { type: 'date', fieldType: 'date' })).toBe(false);
    expect(compatible('bool', { type: 'bool', fieldType: 'booleancheckbox' })).toBe(true);
    expect(compatible('bool', { type: 'enumeration', fieldType: 'booleancheckbox' })).toBe(true);
    expect(compatible('bool', { type: 'enumeration', fieldType: 'select' })).toBe(false);
    expect(compatible('string', { type: 'number', fieldType: 'number' })).toBe(false);
  });

  it('offers only writable, visible, uncomputed, unreserved properties, sorted by label', () => {
    const list = mappableProperties([
      raw('lastname', 'string', 'text', { label: 'Last Name' }),
      raw('firstname', 'string', 'text', { label: 'First Name' }),
      raw('email', 'string', 'text'),
      raw('lifecyclestage', 'enumeration', 'radio'),
      raw('hs_object_id', 'number', 'number'),
      raw('hs_marketable_status', 'enumeration', 'select', { modificationMetadata: { readOnlyValue: true } }),
      raw('hs_readonly_text', 'string', 'text', { modificationMetadata: { readOnlyValue: true } }),
      raw('hs_hidden', 'string', 'text', { hidden: true }),
      raw('hs_lifetime_value', 'number', 'calculation_equation', { calculated: true }),
      raw('industry', 'enumeration', 'select'),
      raw('date_of_birth', 'date', 'date', { label: 'Date of birth' }),
      raw('annualrevenue', 'number', 'number', { label: 'Annual Revenue' }),
      raw('newsletter', 'enumeration', 'booleancheckbox', { label: 'Newsletter' }),
      raw('nolabel', 'string', 'text', { label: '' }),
    ]);
    expect(list.map((p) => p.name)).toEqual(['annualrevenue', 'date_of_birth', 'firstname', 'lastname', 'newsletter', 'nolabel']);
    expect(list.find((p) => p.name === 'nolabel')?.label).toBe('nolabel');
  });
});

describe('checkMapping', () => {
  const props: HubspotPropertyOption[] = [
    { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text', groupName: '' },
    { name: 'company', label: 'Company Name', type: 'string', fieldType: 'text', groupName: '' },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date', fieldType: 'date', groupName: '' },
    { name: 'annualrevenue', label: 'Annual Revenue', type: 'number', fieldType: 'number', groupName: '' },
  ];

  it('accepts a good mapping and drops blanks, which mean do not send', () => {
    const r = checkMapping({ firstName: 'firstname', company: 'company', orderDate: 'date_of_birth', amount: '', jobTitle: null }, props);
    expect(r).toEqual({ ok: true, mapping: { firstName: 'firstname', company: 'company', orderDate: 'date_of_birth' } });
  });
  it('refuses a missing mapping', () => {
    expect(checkMapping(null, props)).toEqual({ ok: false, problems: ['The field mapping is missing.'] });
    expect(checkMapping([], props).ok).toBe(false);
  });
  it('refuses a property HubSpot does not have', () => {
    const r = checkMapping({ firstName: 'nope' }, props);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toContain('HubSpot has no writable contact property "nope"');
  });
  it('refuses a property of the wrong type', () => {
    const r = checkMapping({ orderDate: 'annualrevenue' }, props);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toBe('Order date: "Annual Revenue" is a number property and cannot hold this value.');
  });
  it('refuses the same property used twice', () => {
    const r = checkMapping({ firstName: 'company', company: 'company' }, props);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['Company: "Company Name" is already used for First name.']);
  });
  it('refuses a value that is not a string', () => {
    const r = checkMapping({ firstName: 3 }, props);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toBe('First name: choose a HubSpot property or Do not send.');
  });
  it('writes problems with no em dashes', () => {
    const r = checkMapping({ firstName: 'nope', orderDate: 'annualrevenue', company: 'firstname', jobTitle: 'firstname', amount: 4 }, props);
    if (!r.ok) for (const p of r.problems) expect(p).not.toMatch(/—/);
  });
});

describe('kgcPropertyDefs and isKgcProperty', () => {
  it('names the properties for the event year', () => {
    expect(EVENT_YEAR).toBe('2027');
    const defs = kgcPropertyDefs();
    expect(defs.map((d) => d.name)).toEqual([
      'kgc_2027_ticket',
      'kgc_2027_order_date',
      'kgc_2027_amount',
      'kgc_2027_attendance',
      'kgc_2027_promo_code',
      'kgc_2027_checked_in',
      'kgc_2027_status',
    ]);
    expect(defs.find((d) => d.key === 'orderDate')).toMatchObject({ type: 'date', fieldType: 'date' });
    expect(defs.find((d) => d.key === 'amount')).toMatchObject({ type: 'number' });
    expect(defs.find((d) => d.key === 'checkedIn')).toMatchObject({ type: 'enumeration', fieldType: 'booleancheckbox' });
    expect(defs.find((d) => d.key === 'checkedIn')?.options?.map((o) => o.value)).toEqual(['true', 'false']);
    expect(kgcPropertyDefs('2028')[0].name).toBe('kgc_2028_ticket');
  });
  it('every def can hold its field', () => {
    for (const d of kgcPropertyDefs()) {
      const field = HUBSPOT_SOURCE_FIELDS.find((f) => f.key === d.key)!;
      expect(compatible(field.kind, d)).toBe(true);
    }
  });
  it('recognises our own properties', () => {
    expect(isKgcProperty('kgc_2027_ticket')).toBe(true);
    expect(isKgcProperty('kgc_ticket')).toBe(false);
    expect(isKgcProperty('company')).toBe(false);
  });
});

describe('fieldOptions: where each field may go', () => {
  const opt = (name: string, label: string, type: string, fieldType: string, hubspotDefined: boolean): HubspotPropertyOption => ({ name, label, type, fieldType, groupName: '', hubspotDefined });
  const props = [
    opt('firstname', 'First Name', 'string', 'text', true),
    opt('lastname', 'Last Name', 'string', 'text', true),
    opt('company', 'Company Name', 'string', 'text', true),
    opt('jobtitle', 'Job Title', 'string', 'text', true),
    opt('city', 'City', 'string', 'text', true),
    opt('annualrevenue', 'Annual Revenue', 'number', 'number', true),
    opt('hs_email_optout', 'Opted out of all email', 'bool', 'booleancheckbox', true),
    opt('newsletter_opt_in', 'Newsletter opt in', 'enumeration', 'booleancheckbox', false),
    opt('gdpr_consent_text', 'GDPR consent', 'string', 'text', false),
    opt('notes_from_kgc', 'Notes', 'string', 'text', false),
    opt('kgc_2027_amount', 'KGC 2027 amount paid', 'number', 'number', false),
    opt('kgc_2027_checked_in', 'KGC 2027 checked in', 'enumeration', 'booleancheckbox', false),
    opt('kgc_2027_ticket', 'KGC 2027 ticket', 'string', 'text', false),
  ];
  const names = (key: (typeof HUBSPOT_SOURCE_FIELDS)[number]['key']) => fieldOptions(HUBSPOT_SOURCE_FIELDS.find((f) => f.key === key)!, props).map((p) => p.name);

  it('never offers a consent or subscription property, even a custom one', () => {
    // Custom text properties take any kind of value; of the checkboxes, only ours is offered.
    expect(names('checkedIn')).toEqual(['notes_from_kgc', 'kgc_2027_checked_in', 'kgc_2027_ticket']);
    for (const f of HUBSPOT_SOURCE_FIELDS) {
      const n = names(f.key);
      expect(n).not.toContain('newsletter_opt_in');
      expect(n).not.toContain('gdpr_consent_text');
      expect(n).not.toContain('hs_email_optout');
    }
  });
  it('never offers Annual Revenue, or any other HubSpot number, for Amount paid', () => {
    expect(names('amount')).toEqual(['notes_from_kgc', 'kgc_2027_amount', 'kgc_2027_ticket']);
    expect(names('amount')).not.toContain('annualrevenue');
  });
  it('offers firstname only for First name, and custom text properties', () => {
    expect(names('firstName')).toEqual(['firstname', 'notes_from_kgc', 'kgc_2027_ticket']);
    expect(names('lastName')).toContain('lastname');
    expect(names('lastName')).not.toContain('firstname');
    expect(names('company')).not.toContain('city');
    for (const f of HUBSPOT_SOURCE_FIELDS) if (f.key !== 'firstName') expect(names(f.key)).not.toContain('firstname');
  });
  it('checkMapping refuses a target fieldOptions would not offer', () => {
    const r = checkMapping({ amount: 'annualrevenue', checkedIn: 'newsletter_opt_in' }, props);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toHaveLength(2);
      expect(r.problems[0]).toContain('not a suitable place');
    }
    expect(checkMapping({ amount: 'kgc_2027_amount', firstName: 'firstname' }, props).ok).toBe(true);
  });
});

describe('planContacts', () => {
  const mapping = {
    firstName: 'firstname',
    lastName: 'lastname',
    company: 'company',
    jobTitle: 'jobtitle',
    ticketType: 'kgc_2027_ticket',
    orderDate: 'kgc_2027_order_date',
    amount: 'kgc_2027_amount',
    checkedIn: 'kgc_2027_checked_in',
    registrationStatus: 'kgc_2027_status',
  };
  const types = new Map([
    ['kgc_2027_order_date', 'date'],
    ['kgc_2027_amount', 'number'],
    ['kgc_2027_checked_in', 'enumeration'],
  ]);
  const cfg = { mapping, mode: 'fill-empty' as const, createContacts: true, setLeadStage: true };
  const person = (regs: RegistrantFacts[] = [facts()], email = 'ada@example.com') => ({ email, registrations: regs });
  const current = (email: string, properties: Record<string, string | null>, id = '501') => new Map<string, CurrentContact>([[email, { id, properties }]]);

  it('creates a new contact with its email, every value we have, and Lead as its stage', () => {
    const r = planContacts([person()], new Map(), cfg, types);
    expect(r.updates).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.creates).toEqual([
      {
        email: 'ada@example.com',
        properties: {
          email: 'ada@example.com',
          firstname: 'Ada',
          lastname: 'Lovelace',
          company: 'Analytical Engines',
          jobtitle: 'Mathematician',
          kgc_2027_ticket: 'Main Conference',
          kgc_2027_order_date: '2026-10-03',
          kgc_2027_amount: '799',
          kgc_2027_checked_in: 'false',
          kgc_2027_status: 'Registered',
          lifecyclestage: 'lead',
        },
      },
    ]);
  });

  it('updates an existing contact by its HubSpot id, never by email', () => {
    const r = planContacts([person()], current('ada@example.com', { lifecyclestage: 'lead' }), cfg, types);
    expect(r.creates).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].id).toBe('501');
    expect(r.updates[0].properties).not.toHaveProperty('email');
  });

  it('leaves the stage alone when Set Lead is off', () => {
    const r = planContacts([person()], new Map(), { ...cfg, setLeadStage: false }, types);
    expect(r.creates[0].properties.lifecyclestage).toBeUndefined();
  });

  it('skips, with a log line, a person HubSpot does not have when creating contacts is off', () => {
    const r = planContacts([person()], new Map(), { ...cfg, createContacts: false }, types);
    expect(r.creates).toEqual([]);
    expect(r.skipped).toEqual([{ email: 'ada@example.com', message: 'Not in HubSpot, and creating new contacts is off.', logged: true }]);
  });

  it('updates a contact HubSpot has even when creating contacts is off', () => {
    const r = planContacts([person()], current('ada@example.com', { lifecyclestage: 'lead' }), { ...cfg, createContacts: false }, types);
    expect(r.updates).toHaveLength(1);
  });

  it('sets Lead only on a contact with no stage', () => {
    expect(planContacts([person()], current('ada@example.com', { lifecyclestage: '' }), cfg, types).updates[0].properties.lifecyclestage).toBe('lead');
    expect(planContacts([person()], current('ada@example.com', { lifecyclestage: null }), cfg, types).updates[0].properties.lifecyclestage).toBe('lead');
    expect(planContacts([person()], current('ada@example.com', { lifecyclestage: 'customer' }), cfg, types).updates[0].properties.lifecyclestage).toBeUndefined();
  });

  it('fill only empty fields leaves a filled field alone and fills an empty one', () => {
    const r = planContacts([person()], current('ada@example.com', { company: 'Old Co', firstname: '  ', lifecyclestage: 'lead' }), cfg, types);
    expect(r.updates[0].properties.company).toBeUndefined();
    expect(r.updates[0].properties.firstname).toBe('Ada');
  });

  it('always overwrite replaces a filled field', () => {
    const r = planContacts([person()], current('ada@example.com', { company: 'Old Co', lifecyclestage: 'lead' }), { ...cfg, mode: 'overwrite' }, types);
    expect(r.updates[0].properties.company).toBe('Analytical Engines');
  });

  it('always keeps our kgc_ properties current, even when filling only empty fields', () => {
    const r = planContacts(
      [person([facts({ orderStatus: 'refunded', status: 'cancelled' })])],
      current('ada@example.com', { kgc_2027_status: 'Registered', kgc_2027_ticket: 'Main Conference', lifecyclestage: 'lead' }),
      cfg,
      types,
    );
    expect(r.updates[0].properties.kgc_2027_status).toBe('Refunded');
    expect(r.updates[0].properties.kgc_2027_ticket).toBeUndefined();
  });

  it('X1: refunding one of four tickets keeps the contact Registered', () => {
    const regs = [
      facts({ registrationId: 'a' }),
      facts({ registrationId: 'b' }),
      facts({ registrationId: 'c' }),
      facts({ registrationId: 'd', ticketType: 'Virtual Pass', orderStatus: 'refunded', status: 'cancelled' }),
    ];
    const r = planContacts([person(regs)], current('ada@example.com', { kgc_2027_status: 'Registered', lifecyclestage: 'lead' }), cfg, types);
    expect(r.updates[0]?.properties.kgc_2027_status).toBeUndefined();
    expect(r.updates[0]?.properties.kgc_2027_ticket ?? 'Main Conference').toBe('Main Conference');
  });

  it('never blanks a field, even when overwriting', () => {
    const r = planContacts(
      [person([facts({ company: undefined, title: '' })])],
      current('ada@example.com', { company: 'Old Co', jobtitle: 'CEO', lifecyclestage: 'lead' }),
      { ...cfg, mode: 'overwrite' },
      types,
    );
    expect('company' in r.updates[0].properties).toBe(false);
    expect('jobtitle' in r.updates[0].properties).toBe(false);
  });

  it('skips, without a log line, a contact that is already up to date', () => {
    const now = planContacts([person()], new Map(), cfg, types).creates[0].properties;
    const r = planContacts([person()], current('ada@example.com', { ...now, lifecyclestage: 'customer' }), { ...cfg, mode: 'overwrite' }, types);
    expect(r.updates).toEqual([]);
    expect(r.skipped).toEqual([{ email: 'ada@example.com', message: 'Already up to date.', logged: false }]);
  });

  it('skips, with a log line, an address no registration uses any more', () => {
    const r = planContacts([person([])], new Map(), cfg, types);
    expect(r.creates).toEqual([]);
    expect(r.skipped).toEqual([{ email: 'ada@example.com', message: 'No registration uses this address any more, so nothing was sent.', logged: true }]);
  });

  it('sends only mapped fields, and nothing for an unmapped one', () => {
    const r = planContacts([person()], new Map(), { ...cfg, mapping: { company: 'company', jobTitle: '' } }, types);
    expect(r.creates[0].properties).toEqual({ email: 'ada@example.com', company: 'Analytical Engines', lifecyclestage: 'lead' });
  });

  it('never sends hs_marketable_status', () => {
    const r = planContacts([person()], new Map(), cfg, types);
    expect('hs_marketable_status' in r.creates[0].properties).toBe(false);
  });

  it('plans each person once, by lower-case email, and ignores a blank one', () => {
    const r = planContacts([person([facts()], 'ADA@Example.com '), person([facts()], 'ada@example.com'), person([facts()], '  ')], new Map(), cfg, types);
    expect(r.creates.map((c) => c.email)).toEqual(['ada@example.com']);
    expect(r.skipped).toEqual([]);
  });

  it('7.1: a contact found by a secondary email is existing: fill-empty respected, no Lead pushed onto a customer', () => {
    // readContactsByEmail keys the result by the address we asked with, though HubSpot returns the primary.
    const found = current('ada.alt@example.com', { email: 'ada@primary.example', company: 'Customer Co', lifecyclestage: 'customer', firstname: null }, '777');
    const r = planContacts([person([facts({ email: 'ada.alt@example.com' })], 'ada.alt@example.com')], found, cfg, types);
    expect(r.creates).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0]).toMatchObject({ email: 'ada.alt@example.com', id: '777' });
    expect(r.updates[0].properties).not.toHaveProperty('lifecyclestage');
    expect(r.updates[0].properties).not.toHaveProperty('company');
    expect(r.updates[0].properties).not.toHaveProperty('email');
    expect(r.updates[0].properties.firstname).toBe('Ada');
  });

  it('lists the properties to read: email, secondary emails, stage and everything mapped, once each', () => {
    expect(propertiesToRead({ firstName: 'firstname', company: 'company', jobTitle: '', lastName: 'firstname' })).toEqual([
      'email',
      'hs_additional_emails',
      'lifecyclestage',
      'firstname',
      'company',
    ]);
  });

  it('chunks into batches of 100', () => {
    const parts = chunk(Array.from({ length: 250 }, (_, i) => i));
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
  });
});

describe('errors and redaction', () => {
  it('sorts each failure into what to do next', () => {
    expect(errorKind(401, {})).toBe('auth');
    expect(errorKind(400, { category: 'INVALID_AUTHENTICATION' })).toBe('auth');
    expect(errorKind(403, {})).toBe('scope');
    expect(errorKind(400, { category: 'MISSING_SCOPES' })).toBe('scope');
    expect(errorKind(429, { policyName: 'SECONDLY' })).toBe('rate');
    expect(errorKind(429, {})).toBe('rate');
    expect(errorKind(429, { policyName: 'DAILY' })).toBe('daily');
    expect(errorKind(500, null)).toBe('server');
    expect(errorKind(503, 'x')).toBe('server');
    expect(errorKind(409, {})).toBe('conflict');
    expect(errorKind(400, {})).toBe('bad-request');
    expect(errorKind(404, {})).toBe('bad-request');
  });

  it('explains a refused token without echoing it', () => {
    const m = hubspotErrorMessage(401, { status: 'error', message: `Token ${FAKE_TOKEN} is bad`, category: 'INVALID_AUTHENTICATION' });
    expect(m).toBe('HubSpot refused the access token. It may have been rotated or deleted. Paste a new one.');
    expect(m).not.toContain(FAKE_TOKEN);
  });

  it('names the four scopes when one is missing', () => {
    const m = hubspotErrorMessage(403, {});
    for (const s of HUBSPOT_SCOPES) expect(m).toContain(s);
    expect(hubspotErrorMessage(400, { category: 'MISSING_SCOPES' })).toBe(m);
  });

  it('explains rate limits, the daily limit and outages', () => {
    expect(hubspotErrorMessage(429, { policyName: 'SECONDLY' })).toBe('HubSpot is limiting how fast this app can send. Wait a minute and try again.');
    expect(hubspotErrorMessage(429, { policyName: 'DAILY' })).toContain('daily API allowance');
    expect(hubspotErrorMessage(502, null)).toBe('HubSpot had a problem on its side (HTTP 502). Try again in a few minutes.');
    expect(networkErrorMessage(true)).toBe('HubSpot did not answer in time. Try again in a few minutes.');
    expect(networkErrorMessage(false)).toContain('Could not reach HubSpot');
  });

  it('never promises that something will try again, and has no em dashes', () => {
    const all = [401, 403, 409, 429, 500, 400].map((s) => hubspotErrorMessage(s, {}));
    all.push(hubspotErrorMessage(429, { policyName: 'DAILY' }), networkErrorMessage(true), networkErrorMessage(false));
    for (const m of all) {
      expect(m).not.toMatch(/will try again|will retry/i);
      expect(m).not.toMatch(/—/);
      expect(m).not.toMatch(/fetch failed|aborted/i);
    }
  });

  it('passes other messages through with any token masked, capped at 300 characters', () => {
    const m = hubspotErrorMessage(400, { message: `Bad input from ${FAKE_TOKEN}: ${'x'.repeat(400)}` });
    expect(m).not.toContain(FAKE_TOKEN);
    expect(m).toContain('[token]');
    expect(m.length).toBe(300);
    expect(hubspotErrorMessage(404, 'not json')).toBe('HubSpot refused the request (HTTP 404).');
  });

  it('masks a pat- token and a bearer header anywhere in text', () => {
    expect(redact(`a ${FAKE_TOKEN} b`)).toBe('a [token] b');
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [token]');
    expect(redact('PAT-EU1-00000000-0000-4000-8000-000000000001')).toBe('[token]');
  });

  it('masks the exact token however it is shaped, when given it', () => {
    expect(redact(`key ${FAKE_SERVICE_KEY} was refused`)).toContain(FAKE_SERVICE_KEY);
    expect(redact(`key ${FAKE_SERVICE_KEY} was refused`, FAKE_SERVICE_KEY)).toBe('key [token] was refused');
    expect(redact(`${FAKE_SERVICE_KEY}${FAKE_SERVICE_KEY}`, FAKE_SERVICE_KEY)).toBe('[token][token]');
    // Too short to be a token: not used as a mask, or it would eat ordinary words.
    expect(redact('the cat sat', 'cat')).toBe('the cat sat');
  });
});

describe('retries and parking', () => {
  it('starts a 429 wait at 10 seconds and a 5xx wait at 1 second, give or take 20%', () => {
    expect(retryDelayMs(0, 429, () => 0)).toBe(8_000);
    expect(retryDelayMs(0, 429, () => 1)).toBe(12_000);
    expect(retryDelayMs(0, 500, () => 0.5)).toBe(1_000);
    expect(retryDelayMs(2, 500, () => 0.5)).toBe(4_000);
  });
  it('never waits more than a minute, plus jitter', () => {
    for (const status of [429, 500, 503]) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const lo = retryDelayMs(attempt, status, () => 0);
        const hi = retryDelayMs(attempt, status, () => 1);
        expect(lo).toBeGreaterThanOrEqual(800);
        expect(hi).toBeLessThanOrEqual(72_000);
      }
    }
  });

  it('retries a failed contact after 5 minutes, doubling, capped at 6 hours', () => {
    const now = 1_000_000;
    expect(nextAttemptAt(1, now)).toEqual({ at: now + 5 * 60_000, failed: false });
    expect(nextAttemptAt(2, now)).toEqual({ at: now + 10 * 60_000, failed: false });
    expect(nextAttemptAt(0, now)).toEqual({ at: now + 5 * 60_000, failed: false });
    expect(nextAttemptAt(HUBSPOT_MAX_ATTEMPTS - 1, now).at - now).toBeLessThanOrEqual(6 * 3_600_000);
  });
  it('parks a contact after the last attempt', () => {
    expect(nextAttemptAt(HUBSPOT_MAX_ATTEMPTS, 5)).toEqual({ at: PARKED_AT, failed: true });
    expect(nextAttemptAt(HUBSPOT_MAX_ATTEMPTS + 3, 5)).toEqual({ at: PARKED_AT, failed: true });
    expect(Number.isSafeInteger(PARKED_AT) || PARKED_AT > Date.now() * 1000).toBe(true);
  });
});

describe('tokens and scopes', () => {
  it('recognises a private app token', () => {
    expect(looksLikeHubspotToken(FAKE_TOKEN)).toBe(true);
    expect(looksLikeHubspotToken(`  ${FAKE_TOKEN}  `)).toBe(true);
    expect(looksLikeHubspotToken(['pat', 'eu1', '00000000', '0000', '4000', '8000', '000000000001'].join('-'))).toBe(true);
  });
  it('accepts a key without the pat- prefix, as a service key may be', () => {
    expect(looksLikeHubspotToken(FAKE_SERVICE_KEY)).toBe(true);
  });
  it('refuses sentences, URLs, other services’ keys and junk', () => {
    expect(looksLikeHubspotToken('')).toBe(false);
    expect(looksLikeHubspotToken(undefined)).toBe(false);
    expect(looksLikeHubspotToken(42)).toBe(false);
    expect(looksLikeHubspotToken('short-token')).toBe(false);
    expect(looksLikeHubspotToken('here is my hubspot token please')).toBe(false);
    expect(looksLikeHubspotToken(`token: ${FAKE_TOKEN}`)).toBe(false);
    expect(looksLikeHubspotToken('https://app.hubspot.com/private-apps/4242424/settings')).toBe(false);
    expect(looksLikeHubspotToken('app.hubspot.com/private-apps/4242424/settings')).toBe(false);
    expect(looksLikeHubspotToken('www.hubspot.com/abcdefghijklmnopqrst')).toBe(false);
    expect(looksLikeHubspotToken('sk_live_00000000000000000000')).toBe(false);
    expect(looksLikeHubspotToken('rk_test_00000000000000000000')).toBe(false);
    expect(looksLikeHubspotToken('whsec_000000000000000000000000')).toBe(false);
    expect(looksLikeHubspotToken('x'.repeat(501))).toBe(false);
  });
  it('masks the token for display with its last four characters', () => {
    expect(maskToken('0001')).toBe('pat-****-****0001');
    expect(maskToken(undefined)).toBe('');
  });
  it('names the scopes a token lacks', () => {
    expect(missingScopes([...HUBSPOT_SCOPES])).toEqual([]);
    expect(missingScopes(['crm.objects.contacts.read', 'crm.objects.contacts.write', 'oauth'])).toEqual(['crm.schemas.contacts.read', 'crm.schemas.contacts.write']);
    expect(missingScopes([])).toEqual([...HUBSPOT_SCOPES]);
  });
});

describe('readableValidation (T335)', () => {
  it('turns HubSpot\'s embedded JSON into its inner messages', async () => {
    const { readableValidation } = await import('./hubspot-core.js');
    expect(
      readableValidation('Property values were not valid: [{"isValid":false,"message":"Email address bad@x is invalid","error":"INVALID_EMAIL","name":"email"}]'),
    ).toBe('Property values were not valid: Email address bad@x is invalid');
    expect(readableValidation('Plain message.')).toBe('Plain message.');
    expect(readableValidation('Broken: [{not json]')).toBe('Broken: [{not json]');
  });
});

describe('kgcPropertyDefs options (T336 B1)', () => {
  it('sets hidden: false on every option, as HubSpot\'s OptionInput requires', async () => {
    const { kgcPropertyDefs } = await import('./hubspot-core.js');
    const opts = kgcPropertyDefs().flatMap((d) => d.options ?? []);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o).toMatchObject({ hidden: false, label: expect.any(String), value: expect.any(String) });
  });
});
