/**
 * Publishes `firestore.rules` to the live project over the Firebase Rules API.
 *
 * Two steps, because that is how the service models it: a *ruleset* is an
 * immutable upload of the source, and a *release* is the pointer that says
 * which ruleset `cloud.firestore` is currently enforcing. Uploading without
 * releasing changes nothing, which is the failure mode to watch for.
 */
import { readFileSync } from 'node:fs';
import { accessToken } from './gtoken.mjs';
import { userToken } from './utoken.mjs';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
const [, , sourcePath = 'firestore.rules', releaseName = 'cloud.firestore'] = process.argv;

/**
 * Two identities, on purpose. The service account may create a ruleset but not
 * publish one; the signed-in human may do both. Uploading as the service
 * account keeps the credential that the deployed sites already use in the loop,
 * and publishing as the human is the only way the release lands at all.
 */
const upload = await accessToken();
const publish = await userToken();
const api = async (path, init = {}, token = publish) => {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}\n${body}`);
  return body ? JSON.parse(body) : {};
};

const ruleset = await api(`projects/${PROJECT}/rulesets`, {
  method: 'POST',
  body: JSON.stringify({
    source: { files: [{ name: sourcePath, content: readFileSync(sourcePath, 'utf8') }] },
  }),
}, upload);
console.log(`uploaded ruleset ${ruleset.name}`);

// The release either exists (update it) or does not (create it). Asking first
// is one round trip cheaper than catching a 409 and is easier to read.
const release = `projects/${PROJECT}/releases/${releaseName}`;
let exists = true;
try {
  await api(release);
} catch (err) {
  if (!String(err).includes('→ 404')) throw err;
  exists = false;
}

if (exists) {
  await api(release, { method: 'PATCH', body: JSON.stringify({ release: { name: release, rulesetName: ruleset.name } }) });
  console.log(`updated release ${releaseName}`);
} else {
  await api(`projects/${PROJECT}/releases`, {
    method: 'POST',
    body: JSON.stringify({ name: release, rulesetName: ruleset.name }),
  });
  console.log(`created release ${releaseName}`);
}
