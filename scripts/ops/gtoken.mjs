/**
 * An OAuth access token for the service account, minted from the key file.
 *
 * The `firebase` CLI cannot deploy here: it pre-flights every deploy against
 * serviceusage.googleapis.com, and neither the signed-in user nor this service
 * account holds `serviceusage.services.use` on the project. The underlying
 * Firebase Rules and Firestore Admin APIs do not require that permission — only
 * the CLI's own precheck does — so the sibling scripts call them directly.
 */
import { GoogleAuth } from 'google-auth-library';

export async function accessToken() {
  const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('no access token returned');
  return token;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  accessToken().then((t) => console.log(t.slice(0, 12) + '… (len ' + t.length + ')'));
}
