// A stand-in for the HubSpot CRM v3 endpoints the contact sync calls (T333,
// made strict in T335), so the sync can be driven end to end without a HubSpot
// account or a real token. Records every request it is sent (never the token
// itself, only whether it matched), keeps contacts in memory keyed by their
// primary email in lower case, and can be told to fail the ways HubSpot fails.
//
// It is strict on purpose: a request shape real HubSpot refuses is refused
// here too, so a test cannot pass on a body HubSpot would answer 400. The
// shapes follow HubSpot's reference pages:
//   batch/read    https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-read
//                 body {inputs:[{id}], properties:[], propertiesWithHistory:[], idProperty?}; nothing else
//   batch/update  https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-update
//                 body {inputs:[{id, properties, objectWriteTraceId?}]}; id is a HubSpot record id
//   batch/create  https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-create
//                 body {inputs:[{properties:{email,...}, associations:[], objectWriteTraceId?}]}
//   batch/upsert  refused with idProperty email and partial properties:
//                 "Partial upserts are not supported when using email as the idProperty for contacts"
//                 https://developers.hubspot.com/docs/guides/crm/using-object-apis
//   access-token-info  https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview
//                 POST /oauth/v2/private-apps/get/access-token-info {tokenKey} -> {hubId, scopes, ...}
//   429 DAILY / SECONDLY  https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines
//   lifecyclestage only moves forward; hs_marketable_status is read-only
//                 https://developers.hubspot.com/docs/guides/api/crm/objects/contacts
//
// In a test:
//   import { startFakeHubspot } from './fake-hubspot.mjs';
//   const fake = await startFakeHubspot({ port: 0 });
//   process.env.HUBSPOT_API_BASE = fake.url;
//
// As a server for a browser e2e:
//   FAKE_HUBSPOT_PORT=12112 node tests/hubspot/fake-hubspot.mjs
//   POST /__mode    {"mode":"ok"|"invalid-token"|"rate-limit-once"|"rate-limit-n:3"|"server-error-n:2"|"down"|"daily",
//                    "badEmails":["bad@example.com"],                 refused as invalid addresses
//                    "strict400":true,      one bad input fails the whole batch with 400 (real HubSpot), else 207 per input
//                    "strict400Read":true,  a bad email in a batch/read fails the whole read with 400
//                    "strictConflict":true, a create for an existing address is a whole-request 409, else 207 per input
//                    "scopes":[...],        what access-token-info reports and what is enforced (403 MISSING_SCOPES)
//                    "tokenInfo404":true,   access-token-info answers 404
//                    "delayMs":150,         every API call waits this long
//                    "delayPaths":{"/crm/v3/objects/contacts/batch/create":4000}, per path
//                    "hangPaths":["/crm/v3/objects/contacts/batch/read"]}         never answer
//                   Every key is optional; options not named keep their value. /__x is an alias.
//   POST /__contacts {"email":"a@b.com","properties":{...},"additionalEmails":["alt@b.com"]} put a contact in HubSpot
//   GET  /__state                                          contacts, properties, recorded requests, options
//   POST /__reset                                          forget everything
//
// The accepted token is FAKE_HUBSPOT_TOKEN, or the fake default below. It is a
// made-up value; never point this at, or feed it, a real token.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** Built from parts at runtime so no source line looks like a HubSpot token to secret scanners. */
export const FAKE_HUBSPOT_TOKEN = ['pat', 'na1', '00000000', '0000', '4000', '8000', '000000000001'].join('-');
export const FAKE_PORTAL_ID = 4242424;
export const ALL_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.schemas.contacts.read', 'crm.schemas.contacts.write'];

export const PATHS = {
  list: '/crm/v3/objects/contacts',
  read: '/crm/v3/objects/contacts/batch/read',
  update: '/crm/v3/objects/contacts/batch/update',
  create: '/crm/v3/objects/contacts/batch/create',
  upsert: '/crm/v3/objects/contacts/batch/upsert',
  properties: '/crm/v3/properties/contacts',
  tokenInfo: '/oauth/v2/private-apps/get/access-token-info',
  account: '/account-info/v3/details',
};

/** HubSpot's own order. Moving a contact to an earlier stage is refused. */
const LIFECYCLE = ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'];

const EMAIL_RE = /^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$/;

const prop = (name, label, type, fieldType, extra = {}) => ({
  name,
  label,
  type,
  fieldType,
  groupName: 'contactinformation',
  description: '',
  hidden: false,
  calculated: false,
  formField: true,
  hubspotDefined: true,
  modificationMetadata: { archivable: true, readOnlyDefinition: true, readOnlyValue: false },
  ...extra,
});

const readOnly = { modificationMetadata: { archivable: false, readOnlyDefinition: true, readOnlyValue: true } };
const yesNo = [
  { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
  { label: 'No', value: 'false', displayOrder: 1, hidden: false },
];

/** A realistic slice of a portal's contact properties. */
function baseProperties() {
  return [
    prop('email', 'Email', 'string', 'text'),
    prop('hs_additional_emails', 'Additional email addresses', 'enumeration', 'checkbox', readOnly),
    prop('firstname', 'First Name', 'string', 'text'),
    prop('lastname', 'Last Name', 'string', 'text'),
    prop('company', 'Company Name', 'string', 'text'),
    prop('jobtitle', 'Job Title', 'string', 'text'),
    prop('phone', 'Phone Number', 'string', 'phonenumber'),
    prop('lifecyclestage', 'Lifecycle Stage', 'enumeration', 'radio', {
      options: LIFECYCLE.map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false })),
    }),
    prop('hs_marketable_status', 'Marketing contact status', 'enumeration', 'select', {
      ...readOnly,
      options: [
        { label: 'Marketing contact', value: 'true', displayOrder: 0, hidden: false },
        { label: 'Non-marketing contact', value: 'false', displayOrder: 1, hidden: false },
      ],
    }),
    prop('hs_lifetime_value', 'Lifetime value', 'number', 'calculation_equation', { calculated: true }),
    prop('hs_internal_flag', 'Internal flag', 'string', 'text', { hidden: true }),
    prop('date_of_birth', 'Date of birth', 'date', 'date'),
    prop('annualrevenue', 'Annual Revenue', 'number', 'number'),
    prop('newsletter_opt_in', 'Newsletter opt in', 'enumeration', 'booleancheckbox', { hubspotDefined: false, options: yesNo }),
    prop('hs_object_id', 'Record ID', 'number', 'number', readOnly),
  ];
}

function errorBody(message, category, extra = {}) {
  return { status: 'error', message, correlationId: '00000000-0000-4000-8000-00000000c0de', category, ...extra };
}

const validation = (message, extra = {}) => [400, errorBody(message, 'VALIDATION_ERROR', extra)];

/** Parse "rate-limit-n:3" and friends into { kind, left }. */
function parseMode(mode) {
  if (mode === 'rate-limit-once') return { name: mode, kind: 'rate-limit', left: 1 };
  const m = /^(rate-limit|server-error)-n:(\d+)$/.exec(mode);
  if (m) return { name: mode, kind: m[1], left: Number(m[2]) };
  if (mode === 'ok' || mode === 'invalid-token' || mode === 'down' || mode === 'daily') return { name: mode, kind: mode, left: Infinity };
  throw new Error(`fake-hubspot has no mode "${mode}"`);
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const unknownKeys = (obj, allowed) => Object.keys(obj).filter((k) => !allowed.includes(k));

const defaultOptions = () => ({
  strict400: false,
  strict400Read: false,
  strictConflict: false,
  scopes: [...ALL_SCOPES],
  tokenInfo404: false,
  delayMs: 0,
  delayPaths: {},
  hangPaths: [],
});

/** Which scope each API path needs. */
function scopeFor(method, path) {
  if (path === PATHS.properties) return method === 'GET' ? 'crm.schemas.contacts.read' : 'crm.schemas.contacts.write';
  if (path === PATHS.update || path === PATHS.create || path === PATHS.upsert) return 'crm.objects.contacts.write';
  if (path === PATHS.list || path === PATHS.read) return 'crm.objects.contacts.read';
  return null;
}

/**
 * Start the fake. `port: 0` picks a free one. Returns the base URL, the live
 * state (read it, do not replace it), and controls.
 */
export async function startFakeHubspot({ port = 0, host = '127.0.0.1', token = FAKE_HUBSPOT_TOKEN, portalId = FAKE_PORTAL_ID } = {}) {
  const state = {
    requests: [],
    contacts: {},
    properties: baseProperties(),
    badEmails: [],
    mode: 'ok',
    options: defaultOptions(),
    inflight: 0,
    maxInflight: 0,
  };
  let mode = parseMode('ok');
  let seq = 1000;
  /** Programmatic holds: path -> list of { reached, release }. */
  const holds = new Map();

  function reset() {
    state.requests.length = 0;
    for (const k of Object.keys(state.contacts)) delete state.contacts[k];
    state.properties.splice(0, state.properties.length, ...baseProperties());
    state.badEmails.length = 0;
    state.options = defaultOptions();
    state.maxInflight = state.inflight;
    for (const list of holds.values()) for (const h of list) h.release();
    holds.clear();
    setMode('ok');
  }

  function setOptions(opts = {}) {
    if (Array.isArray(opts.badEmails)) state.badEmails.splice(0, state.badEmails.length, ...opts.badEmails.map((e) => String(e).toLowerCase()));
    for (const k of ['strict400', 'strict400Read', 'strictConflict', 'tokenInfo404']) if (typeof opts[k] === 'boolean') state.options[k] = opts[k];
    if (Array.isArray(opts.scopes)) state.options.scopes = opts.scopes.map(String);
    if (typeof opts.delayMs === 'number') state.options.delayMs = opts.delayMs;
    if (isPlainObject(opts.delayPaths)) state.options.delayPaths = { ...opts.delayPaths };
    if (Array.isArray(opts.hangPaths)) state.options.hangPaths = opts.hangPaths.map(String);
    // The gate's extended fake called these upsertDelayMs / hang; keep them working.
    if (typeof opts.upsertDelayMs === 'number') state.options.delayPaths = { ...state.options.delayPaths, [PATHS.update]: opts.upsertDelayMs, [PATHS.create]: opts.upsertDelayMs };
  }

  function setMode(next, opts = {}) {
    mode = parseMode(next);
    state.mode = next;
    setOptions(opts);
  }

  /** The contact holding this address as its primary or a secondary email. */
  function findByEmail(email) {
    const key = String(email).trim().toLowerCase();
    if (state.contacts[key]) return state.contacts[key];
    return Object.values(state.contacts).find((c) => secondaryOf(c).includes(key));
  }
  const findById = (id) => Object.values(state.contacts).find((c) => c.id === String(id));
  const secondaryOf = (c) =>
    String(c.properties.hs_additional_emails ?? '')
      .split(';')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

  function seedContact(email, properties = {}, { additionalEmails } = {}) {
    const key = String(email).trim().toLowerCase();
    const now = new Date().toISOString();
    const c = (state.contacts[key] ??= { id: String(++seq), properties: { email: key }, createdAt: now, updatedAt: now });
    Object.assign(c.properties, properties);
    if (Array.isArray(additionalEmails) && additionalEmails.length) {
      c.properties.hs_additional_emails = [...new Set([...secondaryOf(c), ...additionalEmails.map((e) => String(e).trim().toLowerCase())])].join(';');
    }
    return c;
  }

  /** Hold the next request to `path` until `release()`; `reached` resolves once it arrives. */
  function hold(path) {
    let release;
    let arrived;
    const reached = new Promise((r) => (arrived = r));
    const gate = new Promise((r) => (release = r));
    const h = { reached, release: () => release(), arrived: () => arrived(), gate };
    holds.set(path, [...(holds.get(path) ?? []), h]);
    return { reached, release: h.release };
  }

  /** Recorded API requests to `path`. */
  const calls = (path) => state.requests.filter((r) => r.path === path);

  /** How many times HubSpot accepted a write (create or update) for this address. */
  const written = (email) => {
    const key = String(email).toLowerCase();
    return state.requests
      .filter((r) => (r.path === PATHS.create || r.path === PATHS.update) && r.status < 300)
      .flatMap((r) => r.accepted ?? [])
      .filter((e) => e === key).length;
  };
  /** Old name, kept for callers: batch/upsert is always refused now, so this counts writes. */
  const upserted = written;

  const view = (c, wanted) => {
    const properties = { hs_object_id: c.id, createdate: c.createdAt, lastmodifieddate: c.updatedAt };
    for (const p of wanted && wanted.length ? wanted : Object.keys(c.properties)) properties[p] = c.properties[p] ?? null;
    return { id: c.id, properties, createdAt: c.createdAt, updatedAt: c.updatedAt, archived: false };
  };

  /** Why HubSpot would refuse these property values on this contact (null when fine). */
  function refuseProperties(props, existing) {
    if (!isPlainObject(props)) return { message: 'properties must be an object.', category: 'VALIDATION_ERROR' };
    const byName = new Map(state.properties.map((x) => [x.name, x]));
    for (const [name, value] of Object.entries(props)) {
      const def = byName.get(name);
      if (!def) {
        return { message: `Property values were not valid: [{"isValid":false,"message":"Property \\"${name}\\" does not exist","error":"PROPERTY_DOESNT_EXIST","name":"${name}"}]`, category: 'VALIDATION_ERROR', error: 'PROPERTY_DOESNT_EXIST' };
      }
      if (def.modificationMetadata?.readOnlyValue || def.calculated) {
        return { message: `Property values were not valid: [{"isValid":false,"message":"${name} is a read only property; its value cannot be set.","error":"READ_ONLY_VALUE","name":"${name}"}]`, category: 'VALIDATION_ERROR', error: 'READ_ONLY_VALUE' };
      }
      if (value === null) continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { message: `Property values were not valid: ${name} must be a string.`, category: 'VALIDATION_ERROR', error: 'INVALID_OPTION' };
      }
      const v = String(value);
      if (def.type === 'number' && v !== '' && !/^-?\d+(\.\d+)?$/.test(v)) {
        return { message: `Property values were not valid: [{"isValid":false,"message":"${v} is not a valid number","error":"INVALID_INTEGER","name":"${name}"}]`, category: 'VALIDATION_ERROR' };
      }
      if (def.type === 'date' && v !== '' && !/^(\d{4}-\d{2}-\d{2}|\d+)$/.test(v)) {
        return { message: `Property values were not valid: [{"isValid":false,"message":"${v} is not a valid date","error":"INVALID_DATE","name":"${name}"}]`, category: 'VALIDATION_ERROR' };
      }
      if (def.type === 'enumeration' && v !== '' && Array.isArray(def.options) && !def.options.some((o) => o.value === v)) {
        return { message: `Property values were not valid: [{"isValid":false,"message":"${v} was not one of the allowed options","error":"INVALID_OPTION","name":"${name}"}]`, category: 'VALIDATION_ERROR' };
      }
      if (name === 'email' && !EMAIL_RE.test(v)) {
        return { message: `Property values were not valid: [{"isValid":false,"message":"Email address ${v} is invalid","error":"INVALID_EMAIL","name":"email"}]`, category: 'VALIDATION_ERROR' };
      }
    }
    const email = String(props.email ?? existing?.properties.email ?? '').toLowerCase();
    if (email && state.badEmails.includes(email)) {
      return { message: `Property values were not valid: [{"isValid":false,"message":"Email address ${email} is invalid","error":"INVALID_EMAIL","name":"email"}]`, category: 'VALIDATION_ERROR' };
    }
    if (existing && props.lifecyclestage !== undefined && props.lifecyclestage !== null && props.lifecyclestage !== '') {
      const from = LIFECYCLE.indexOf(existing.properties.lifecyclestage);
      const to = LIFECYCLE.indexOf(String(props.lifecyclestage));
      if (from >= 0 && to >= 0 && to < from) {
        return {
          message: `Property values were not valid: [{"isValid":false,"message":"lifecyclestage cannot move backwards from ${existing.properties.lifecyclestage} to ${props.lifecyclestage}. Clear it first.","error":"INVALID_OPTION","name":"lifecyclestage"}]`,
          category: 'VALIDATION_ERROR',
        };
      }
    }
    return null;
  }

  function write(c, props) {
    for (const [k, v] of Object.entries(props)) c.properties[k] = v === null ? null : String(v);
    c.updatedAt = new Date().toISOString();
  }

  /** A batch where some inputs failed: whole-request 400 in strict mode, else 207 with per-input errors. */
  function partial(results, errors, okStatus) {
    if (errors.length === 0) return [okStatus, { status: 'COMPLETE', results, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }];
    return [207, { status: 'COMPLETE', results, numErrors: errors.length, errors, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }];
  }

  function handleApi(m, url, body, rec) {
    const p = url.pathname;

    if (m === 'GET' && p === PATHS.list) {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 10)));
      return [200, { results: Object.values(state.contacts).slice(0, limit).map((c) => view(c)) }];
    }
    if (m === 'GET' && p === PATHS.account) {
      return [200, { portalId, accountType: 'STANDARD', timeZone: 'US/Eastern', companyCurrency: 'USD', uiDomain: 'app.hubspot.com', dataHostingLocation: 'na1' }];
    }
    if (m === 'POST' && p === PATHS.tokenInfo) {
      if (state.options.tokenInfo404) return [404, errorBody('Not found.', 'OBJECT_NOT_FOUND')];
      if (!isPlainObject(body) || typeof body.tokenKey !== 'string' || unknownKeys(body, ['tokenKey']).length) return validation('Body must be {"tokenKey": "<token>"}.');
      if (body.tokenKey !== token) return [401, errorBody('The access token is not valid.', 'INVALID_AUTHENTICATION')];
      return [200, { userId: 77, hubId: portalId, appId: 9001, scopes: [...state.options.scopes], tokenType: 'PRIVATE_APP' }];
    }
    if (m === 'GET' && p === PATHS.properties) return [200, { results: state.properties }];
    if (m === 'POST' && p === PATHS.properties) {
      // Strict to the create-property spec (PropertyCreate / OptionInput):
      // https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/create-property.md
      if (!isPlainObject(body)) return validation('Invalid input JSON.');
      const propExtra = unknownKeys(body, ['name', 'label', 'type', 'fieldType', 'groupName', 'description', 'options', 'displayOrder', 'hasUniqueValue', 'hidden', 'formField', 'calculationFormula', 'externalOptions', 'referencedObjectType', 'dataSensitivity']);
      if (propExtra.length) return validation(`Invalid input JSON on line 1: Unrecognized field "${propExtra[0]}".`);
      for (const k of ['name', 'label', 'type', 'fieldType', 'groupName']) {
        if (typeof body?.[k] !== 'string' || !body[k]) return validation(`Property ${k} is required.`);
      }
      const PAIRS = {
        string: ['text', 'textarea', 'phonenumber', 'html', 'file'],
        number: ['number'],
        date: ['date'],
        datetime: ['date'],
        enumeration: ['select', 'radio', 'checkbox', 'booleancheckbox'],
        bool: ['booleancheckbox'],
      };
      if (!PAIRS[body.type]) return validation(`"${body.type}" is not a valid property type.`);
      if (!PAIRS[body.type].includes(body.fieldType)) return validation(`fieldType "${body.fieldType}" is not valid for type "${body.type}".`);
      const groups = new Set(['contactinformation', 'emailinformation', 'socialmediainformation', 'analyticsinformation', ...state.properties.map((x) => x.groupName)]);
      if (!groups.has(body.groupName)) return validation(`Property group "${body.groupName}" does not exist.`);
      if (body.type === 'enumeration' && (!Array.isArray(body.options) || body.options.length === 0)) return validation('An enumeration property needs options.');
      for (const o of body.options ?? []) {
        if (!isPlainObject(o)) return validation('Each option must be an object.');
        const optExtra = unknownKeys(o, ['label', 'value', 'hidden', 'displayOrder', 'description']);
        if (optExtra.length) return validation(`Invalid option: Unrecognized field "${optExtra[0]}".`);
        if (typeof o.label !== 'string' || typeof o.value !== 'string') return validation('Each option needs a label and a value.');
        if (typeof o.hidden !== 'boolean') return validation('Each option needs "hidden" (OptionInput requires hidden, label, value).');
      }
      if (state.properties.some((x) => x.name === body.name)) {
        return [409, errorBody(`A property named '${body.name}' already exists.`, 'OBJECT_ALREADY_EXISTS')];
      }
      const created = prop(body.name, body.label, body.type, body.fieldType, {
        groupName: body.groupName,
        description: body.description ?? '',
        options: body.options ?? [],
        hubspotDefined: false,
        createdAt: new Date().toISOString(),
      });
      state.properties.push(created);
      return [201, created];
    }

    if (m === 'POST' && p === PATHS.read) {
      if (!isPlainObject(body)) return validation('Invalid input JSON.');
      const extra = unknownKeys(body, ['inputs', 'properties', 'propertiesWithHistory', 'idProperty']);
      if (extra.length) return validation(`Invalid input JSON on line 1: Unrecognized field "${extra[0]}".`);
      if (!Array.isArray(body.inputs)) return validation('inputs is required.');
      if (!Array.isArray(body.properties)) return validation('properties is required and must be an array.');
      if (!Array.isArray(body.propertiesWithHistory)) return validation('propertiesWithHistory is required and must be an array.');
      if (body.idProperty !== undefined && body.idProperty !== 'email') return validation('This fake reads contacts by email or by record id only.');
      if (body.inputs.length > 100) return validation('Batch size must be 100 or less.');
      for (const i of body.inputs) {
        if (!isPlainObject(i) || typeof i.id !== 'string' || !i.id || unknownKeys(i, ['id']).length) return validation('Each input must be {"id": "<string>"}.');
      }
      const readIds = body.inputs.map((i) => i.id.trim().toLowerCase());
      // Real HubSpot can refuse a whole read for one malformed address.
      if (state.options.strict400Read) {
        const bad = readIds.find((id) => state.badEmails.includes(id));
        if (bad) return [400, errorBody(`Property values were not valid: [{"isValid":false,"message":"Email address ${bad} is invalid","error":"INVALID_EMAIL","name":"email"}]`, 'VALIDATION_ERROR')];
      }
      const readDupes = [...new Set(readIds.filter((id, n) => readIds.indexOf(id) !== n))];
      if (readDupes.length) return validation(`Duplicate IDs found in batch input: [${readDupes.join(', ')}]. IDs must be unique`);
      const results = [];
      const missing = [];
      for (const i of body.inputs) {
        const c = body.idProperty === 'email' ? findByEmail(i.id) : findById(i.id);
        if (c) results.push(view(c, body.properties));
        else missing.push(i.id);
      }
      if (missing.length === 0) return [200, { status: 'COMPLETE', results }];
      return [
        207,
        {
          status: 'COMPLETE',
          results,
          numErrors: 1,
          errors: [{ status: 'error', category: 'OBJECT_NOT_FOUND', message: 'Could not get some CONTACT objects, they may be deleted or not exist. Check that ids are valid.', context: { ids: missing } }],
        },
      ];
    }

    if (m === 'POST' && p === PATHS.update) {
      if (!isPlainObject(body)) return validation('Invalid input JSON.');
      const extra = unknownKeys(body, ['inputs']);
      if (extra.length) return validation(`Invalid input JSON on line 1: Unrecognized field "${extra[0]}".`);
      if (!Array.isArray(body.inputs) || body.inputs.length === 0) return validation('No inputs were provided.');
      if (body.inputs.length > 100) return validation('Batch size must be 100 or less.');
      for (const i of body.inputs) {
        if (!isPlainObject(i)) return validation('Each input must be an object.');
        const bad = unknownKeys(i, ['id', 'properties', 'objectWriteTraceId']);
        if (bad.length) return validation(`Invalid input JSON on line 1: Unrecognized field "${bad[0]}".`);
        if (typeof i.id !== 'string' || !i.id) return validation('Each input needs the record id as "id".');
        if (!isPlainObject(i.properties)) return validation('Each input needs "properties".');
      }
      const ids = body.inputs.map((i) => i.id);
      const dupes = [...new Set(ids.filter((id, n) => ids.indexOf(id) !== n))];
      if (dupes.length) return validation(`Duplicate IDs found in batch input: [${dupes.join(', ')}]. IDs must be unique`);
      const results = [];
      const errors = [];
      const accepted = [];
      const plan = [];
      for (const i of body.inputs) {
        const c = findById(i.id);
        if (!c) {
          errors.push({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `No contact with id ${i.id}.`, context: { ids: [i.id] } });
          continue;
        }
        const refusal = refuseProperties(i.properties, c);
        if (refusal) {
          if (state.options.strict400) return [400, errorBody(refusal.message, refusal.category)];
          errors.push({ status: 'error', category: refusal.category, message: refusal.message, context: { ids: [i.id] } });
          continue;
        }
        plan.push([c, i.properties]);
      }
      for (const [c, props] of plan) {
        write(c, props);
        accepted.push(c.properties.email);
        results.push(view(c));
      }
      rec.accepted = accepted;
      return partial(results, errors, 200);
    }

    if (m === 'POST' && p === PATHS.create) {
      if (!isPlainObject(body)) return validation('Invalid input JSON.');
      const extra = unknownKeys(body, ['inputs']);
      if (extra.length) return validation(`Invalid input JSON on line 1: Unrecognized field "${extra[0]}".`);
      if (!Array.isArray(body.inputs) || body.inputs.length === 0) return validation('No inputs were provided.');
      if (body.inputs.length > 100) return validation('Batch size must be 100 or less.');
      for (const i of body.inputs) {
        if (!isPlainObject(i)) return validation('Each input must be an object.');
        const bad = unknownKeys(i, ['properties', 'associations', 'objectWriteTraceId']);
        if (bad.length) return validation(`Invalid input JSON on line 1: Unrecognized field "${bad[0]}".`);
        if (!isPlainObject(i.properties)) return validation('Each input needs "properties".');
        if (!Array.isArray(i.associations)) return validation('Each input needs "associations" (an array, may be empty).');
        if (i.objectWriteTraceId !== undefined && typeof i.objectWriteTraceId !== 'string') return validation('objectWriteTraceId must be a string.');
        if (typeof i.properties.email !== 'string' || !i.properties.email) return validation('This fake creates contacts with an email only.');
      }
      const results = [];
      const errors = [];
      const plan = [];
      const seen = new Map();
      for (const i of body.inputs) {
        const email = String(i.properties.email).trim().toLowerCase();
        const trace = i.objectWriteTraceId;
        const ctx = trace ? { objectWriteTraceId: [trace] } : {};
        const refusal = refuseProperties(i.properties, undefined);
        if (refusal) {
          if (state.options.strict400) return [400, errorBody(refusal.message, refusal.category)];
          errors.push({ status: 'error', category: refusal.category, message: refusal.message, context: ctx });
          continue;
        }
        const existing = findByEmail(email);
        if (existing || seen.has(email)) {
          const id = existing ? existing.id : seen.get(email);
          const message = `Contact already exists. Existing ID: ${id}`;
          if (state.options.strictConflict) return [409, errorBody(message, 'CONFLICT')];
          errors.push({ status: 'error', category: 'CONFLICT', message, context: ctx });
          continue;
        }
        seen.set(email, 'pending');
        plan.push({ email, props: i.properties, trace });
      }
      const accepted = [];
      for (const { email, props, trace } of plan) {
        const c = seedContact(email, {});
        write(c, props);
        accepted.push(email);
        results.push({ ...view(c), ...(trace ? { objectWriteTraceId: trace } : {}) });
      }
      rec.accepted = accepted;
      return partial(results, errors, 201);
    }

    if (m === 'POST' && p === PATHS.upsert) {
      const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
      if (inputs.some((i) => i?.idProperty === 'email')) {
        return validation('Cannot perform a partial upsert with email as the idProperty. Use a custom unique identifier property instead.');
      }
      return validation('This fake does not support batch/upsert; the sync reads, then updates by id or creates.');
    }
    return [404, errorBody(`fake-hubspot has no ${m} ${p}`, 'OBJECT_NOT_FOUND')];
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const url = new URL(req.url, 'http://fake');
    const m = req.method;
    const send = (status, payload) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }

    if (url.pathname === '/__state') return send(200, state);
    if (url.pathname === '/__reset' && m === 'POST') {
      reset();
      return send(200, {});
    }
    if ((url.pathname === '/__mode' || url.pathname === '/__x') && m === 'POST') {
      try {
        setMode(body?.mode ?? state.mode, body ?? {});
      } catch (err) {
        return send(400, { message: err.message });
      }
      return send(200, { mode: state.mode, badEmails: state.badEmails, options: state.options });
    }
    if (url.pathname === '/__contacts' && m === 'POST') {
      if (!body?.email) return send(400, { message: 'email is required' });
      return send(200, seedContact(body.email, body.properties ?? {}, { additionalEmails: body.additionalEmails }));
    }

    const authOk = req.headers.authorization === `Bearer ${token}`;
    // The token is never kept: access-token-info carries it in the body by design, so that body is recorded masked.
    const rawHadToken = raw.includes(token);
    const recBody = url.pathname === PATHS.tokenInfo && isPlainObject(body) ? { ...body, tokenKey: body.tokenKey === token ? '[the token]' : '[another value]' } : body;
    const rec = { method: m, path: url.pathname, query: url.search, body: recBody, authOk, authPresent: Boolean(req.headers.authorization), rawHadToken, status: 0, at: Date.now() };
    state.requests.push(rec);
    state.inflight++;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    const reply = (status, payload) => {
      state.inflight--;
      rec.status = status;
      send(status, payload);
    };

    if (state.options.hangPaths.includes(url.pathname)) {
      rec.status = -1; // never answered
      return;
    }
    const held = holds.get(url.pathname)?.shift();
    if (held) {
      held.arrived();
      await held.gate;
    }
    const delay = Number(state.options.delayPaths[url.pathname] ?? 0) + Number(state.options.delayMs ?? 0);
    if (delay > 0) await sleep(delay);

    if (mode.kind === 'down') return reply(500, errorBody('Internal error.', 'INTERNAL_ERROR'));
    if (mode.kind === 'invalid-token' || !authOk) {
      return reply(
        401,
        errorBody(
          'Authentication credentials not found. This API supports OAuth 2.0 authentication and you can find more details at https://developers.hubspot.com/docs/methods/auth/oauth-overview',
          'INVALID_AUTHENTICATION',
        ),
      );
    }
    if (mode.kind === 'daily') {
      return reply(429, errorBody('You have reached your daily limit.', 'RATE_LIMITS', { errorType: 'RATE_LIMIT', policyName: 'DAILY' }));
    }
    if (mode.kind === 'rate-limit' || mode.kind === 'server-error') {
      const kind = mode.kind;
      mode.left--;
      if (mode.left <= 0) setMode('ok');
      if (kind === 'rate-limit') {
        return reply(429, errorBody('You have reached your secondly limit.', 'RATE_LIMITS', { errorType: 'RATE_LIMIT', policyName: 'SECONDLY' }));
      }
      return reply(500, errorBody('Internal error.', 'INTERNAL_ERROR'));
    }
    const needs = scopeFor(m, url.pathname);
    if (needs && !state.options.scopes.includes(needs)) {
      return reply(
        403,
        errorBody("This app hasn't been granted all required scopes to make this call. Read more about required scopes here: https://developers.hubspot.com/scopes.", 'MISSING_SCOPES', {
          errors: [{ message: `One or more of the following scopes are required.`, context: { requiredGranularScopes: [needs] } }],
        }),
      );
    }
    const [status, payload] = handleApi(m, url, body, rec);
    return reply(status, payload);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const { port: bound } = server.address();
  const url = `http://${host}:${bound}`;
  return {
    url,
    state,
    setMode,
    setOptions,
    reset,
    seedContact,
    findByEmail,
    hold,
    calls,
    written,
    upserted,
    close: () =>
      new Promise((resolve) => {
        for (const list of holds.values()) for (const h of list) h.release();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fake = await startFakeHubspot({
    port: Number(process.env.FAKE_HUBSPOT_PORT ?? 12112),
    token: process.env.FAKE_HUBSPOT_TOKEN || FAKE_HUBSPOT_TOKEN,
  });
  console.log(`[fake-hubspot] listening on ${fake.url}`);
}
