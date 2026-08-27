/**
 * A fresh access token for the *signed-in human*, refreshed from the token the
 * `firebase` CLI already stored at login.
 *
 * The service account can upload a ruleset but not publish it — that needs
 * `firebaserules.releases.create`, which sits on the human's project role, not
 * on the Admin SDK service agent. So the two halves of a rules deploy are
 * authenticated by two different identities, deliberately.
 *
 * The client id below is the public one baked into firebase-tools; it is not a
 * secret and is what the stored refresh token was issued to.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

export async function userToken() {
  const store = JSON.parse(
    readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'),
  );
  const refresh = store?.tokens?.refresh_token;
  if (!refresh) throw new Error('No refresh token — run `firebase login` first.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token refresh failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  userToken().then((t) => console.log(t.slice(0, 12) + '… (len ' + t.length + ')'));
}
