/**
 * Applies `firestore.indexes.json` to the live project over the Firestore
 * Admin API, because the `firebase` CLI cannot get past its own
 * serviceusage.googleapis.com precheck with the roles on this project.
 *
 * Why this matters more than it looks: **the emulator ignores index
 * configuration entirely**. Every query in the app and both websites has only
 * ever run somewhere that does not need these. A composite query with no index
 * fails in production with `failed-precondition` and nothing else — so an
 * un-deployed index is a screen that is blank only in front of an audience.
 *
 * Creation is asynchronous. A 200 here means Firestore accepted the build, not
 * that the index is ready; `--wait` polls until none are still CREATING.
 */
import { readFileSync } from 'node:fs';
import { userToken } from './utoken.mjs';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
const DB = `projects/${PROJECT}/databases/(default)`;
const token = await userToken();

const api = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, json: body ? JSON.parse(body) : {} };
};

const spec = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));

let created = 0;
let already = 0;
const failed = [];

for (const idx of spec.indexes ?? []) {
  // `__name__` is appended by Firestore itself and is rejected as an explicit
  // trailing field on some shapes; the CLI strips it too.
  const fields = idx.fields.filter((f) => f.fieldPath !== '__name__');
  const url = `https://firestore.googleapis.com/v1/${DB}/collectionGroups/${idx.collectionGroup}/indexes`;
  const res = await api(url, {
    method: 'POST',
    body: JSON.stringify({ queryScope: idx.queryScope ?? 'COLLECTION', fields }),
  });

  const label = `${idx.collectionGroup}(${fields.map((f) => f.fieldPath).join(', ')})`;
  if (res.ok) {
    created++;
    console.log(`  creating ${label}`);
  } else if (res.status === 409) {
    already++;
  } else {
    failed.push(`${label} → ${res.status} ${JSON.stringify(res.json?.error?.message ?? res.json)}`);
  }
}

for (const ov of spec.fieldOverrides ?? []) {
  // A field override is a PATCH on the field itself, not a POST. An empty
  // `indexes` array is the point of most of these: it switches OFF the
  // single-field index Firestore builds by default, which is what stops a
  // high-write subcollection paying for an index nothing queries.
  const path = encodeURIComponent(ov.fieldPath);
  const url =
    `https://firestore.googleapis.com/v1/${DB}/collectionGroups/${ov.collectionGroup}/fields/${path}` +
    `?updateMask=indexConfig`;
  /**
   * `firestore.indexes.json` writes a field override in the CLI's shorthand —
   * `{queryScope, order}` with the field left implicit — but the REST API wants
   * a whole Index object per entry, field path and all. Passing the shorthand
   * through unexpanded is a 400 that names `order` as an unknown field, which
   * reads like the value is wrong rather than the shape.
   */
  const indexes = (ov.indexes ?? []).map((e) => ({
    queryScope: e.queryScope ?? 'COLLECTION',
    fields: [{ fieldPath: ov.fieldPath, ...(e.arrayConfig ? { arrayConfig: e.arrayConfig } : { order: e.order }) }],
  }));

  const res = await api(url, {
    method: 'PATCH',
    body: JSON.stringify({ indexConfig: { indexes } }),
  });
  const label = `${ov.collectionGroup}.${ov.fieldPath}`;
  if (res.ok) console.log(`  override ${label}`);
  else failed.push(`override ${label} → ${res.status} ${JSON.stringify(res.json?.error?.message ?? res.json)}`);
}

console.log(`\n${created} index builds started, ${already} already present, ${failed.length} failed`);
for (const f of failed) console.error(`  FAILED ${f}`);

if (process.argv.includes('--wait')) {
  for (;;) {
    const res = await api(`https://firestore.googleapis.com/v1/${DB}/collectionGroups/-/indexes`);
    const building = (res.json.indexes ?? []).filter((i) => i.state !== 'READY');
    if (!building.length) {
      console.log(`all ${(res.json.indexes ?? []).length} indexes READY`);
      break;
    }
    console.log(`  ${building.length} still building…`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

process.exit(failed.length ? 1 : 0);
