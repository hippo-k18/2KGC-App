/**
 * The Expo Go share proxy (app/scripts/expo-go-proxy-core.mjs) is the only
 * thing between a public trycloudflare.com link and a Metro server rooted at
 * the repo. T240 fetched repo files through it as bundles; these tests pin
 * every one of those requests as refused, and every request Expo Go really
 * makes as passed, against a stand-in Metro that records what reaches it.
 *
 * The bundle and asset URLs are the real ones, copied from Metro for Expo Go
 * on SDK 57 (T241, 2026-10-13): the manifest's launchAsset for iOS and
 * Android, and the asset locations in both bundles.
 *
 * Run with: npm test
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// @ts-expect-error plain ESM script, no types
import { canonical, classify, createProxy } from '../../app/scripts/expo-go-proxy-core.mjs';

const QUERY =
  'dev=false&hot=false&lazy=true&minify=true&transform.engine=hermes&transform.bytecode=1' +
  '&transform.routerRoot=src%2Fapp&transform.reactCompiler=true&unstable_transformProfile=hermes-stable';
const ENTRY = '/node_modules/expo-router/entry.bundle';
const IOS_BUNDLE = `${ENTRY}?platform=ios&${QUERY}`;
const ANDROID_BUNDLE = `${ENTRY}?platform=android&${QUERY}`;
const PUBLIC = 'https://example.trycloudflare.com';

const ASSETS = [
  '/assets/?unstable_path=.%2Fassets%2Fimages/icon.png?platform=ios&hash=0a328cd9c1afd0afe8e3b1ec5165b1b4',
  '/assets/?unstable_path=.%2F..%2Fnode_modules%2Fexpo-router%2Fassets%2Freact-navigation%2Felements/back-icon.png?platform=ios&hash=c560d7e01660506cdb3be1e07257053e',
  '/assets/?unstable_path=.%2F..%2Fnode_modules%2Fexpo-router%2Fassets/arrow_right.xml?platform=android&hash=98a4e3d00dbf5d65da99a69b38a7def2',
  '/assets/?unstable_path=.%2F..%2Fnode_modules%2F%40expo%2Fvector-icons%2Fbuild%2Fvendor%2Freact-native-vector-icons%2FFonts/MaterialIcons.ttf?platform=ios&hash=4e85bc9ebe07e0340c9c4fc2f6c38908',
  '/assets/?unstable_path=.%2F..%2Fnode_modules%2F%40expo-google-fonts%2Fmaterial-symbols%2F400Regular/MaterialSymbols_400Regular.ttf?platform=android&hash=8b042be199ec74ce82b9cd2604568e73',
  '/assets/?unstable_path=.%2Fassets%2Fimages/splash-icon@2x.png?platform=ios&hash=61378328a719f21f093de82dd89ecfb0',
];

// Every request T240 tried (with its canary files), plus the ones found while
// fixing it: a different routerRoot or extra bundle options, encoded or
// duplicated query keys, and asset paths that end in an image only after "?".
const ATTACKS: Array<[string, string]> = [
  ['GET', '/t240-canary/secret.bundle?platform=ios'],
  ['GET', '/.t240dot/service-account.bundle?platform=ios'],
  ['GET', '/.secrets/service-account.bundle?platform=ios'],
  ['GET', '/t240-canary/secret.map?platform=ios'],
  ['GET', '/.t240dot/service-account.map?platform=ios'],
  ['GET', '/firebase.preview.bundle?platform=ios'],
  ['GET', '/package.bundle?platform=ios'],
  ['GET', '/apps/organizer/src/lib/firestore.bundle?platform=ios'],
  ['GET', '/app/.env.local.bundle?platform=ios'],
  ['GET', '/assets/..%2ft240-canary%2fpic.png'],
  ['GET', '/assets/..%2f..%2fetc%2fhosts'],
  ['GET', '/_expo/touch'],
  ['GET', '/open-stack-frame'],
  ['GET', '/_expo/touch;.bundle'],
  ['GET', '/assets/../_expo/touch'],
  ['POST', '/'],
  ['POST', IOS_BUNDLE],
  ['PUT', '/'],
  ['DELETE', '/'],
  ['GET', '/_expo/debugger'],
  ['GET', '/inspector/network'],
  ['GET', '/json/list'],
  ['GET', '/message'],
  ['GET', '/hot'],
  ['GET', '/symbolicate'],
  ['GET', '/logs'],
  ['GET', '/_expo/loading'],
  ['GET', `${ENTRY.replace('.bundle', '.map')}?platform=ios&${QUERY}`],
  ['GET', `${ENTRY.replace('.bundle', '.assets')}?platform=ios&${QUERY}`],
  ['GET', `${ENTRY}?platform=ios&${QUERY.replace('src%2Fapp', '..%2Fapps%2Forganizer%2Fsrc')}`],
  ['GET', `${ENTRY}?platform=ios&${QUERY.replace('src%2Fapp', '..%2F.secrets')}`],
  ['GET', `${IOS_BUNDLE}&inlineSourceMap=true`],
  ['GET', `${IOS_BUNDLE}&platform=android`],
  ['GET', `${ENTRY}?platform=ios`],
  ['GET', `${ENTRY}?platform=web&${QUERY}`],
  ['GET', `${ENTRY.replace('entry', 'entry/..%2f..%2f..%2f.secrets/service-account')}?platform=ios&${QUERY}`],
  ['GET', `/node_modules/expo-router/../../.secrets/service-account.bundle?platform=ios`],
  ['GET', `//evil.example${IOS_BUNDLE}`],
  ['GET', `${PUBLIC}/.secrets/service-account.bundle?platform=ios`],
  ['GET', '/assets/?unstable_path=.%2F..%2F.secrets/service-account.json?platform=ios'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2F..%2F..%2F.secrets/key.png?platform=ios'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/..%2F..%2F..%2F.secrets/key.png?platform=ios'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/%2e%2e/%2e%2e/key.png?platform=ios'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/x.json?.png'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/x.json%3F.png'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/icon.png&unstable_path=.%2F..%2F.secrets/key.png'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages%5C..%5C..%5Ckey.png'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/icon.png%00.png'],
  ['GET', '/assets/?unstable_path=.%2F..%2Fapps%2Fweb%2Fpublic/logo.png?platform=ios'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/icon.png?platform=ios&foo=bar'],
  ['GET', '/assets/?unstable_path=.%2Fassets%2Fimages/icon.png?platform=ios%26transform.routerRoot=..'],
  ['GET', '/assets/x.png'],
  ['GET', '/assets'],
  ['GET', '/?platform=ios&transform.routerRoot=..'],
  ['GET', '/status/../.secrets/x'],
];

type Seen = { method: string; url: string };

let metro: http.Server;
let proxy: http.Server;
let proxyPort: number;
let seen: Seen[] = [];
let failBundle = false;

function manifest(platform: string) {
  return {
    runtimeVersion: 'exposdk:57.0.0',
    launchAsset: { key: 'bundle', contentType: 'application/javascript', url: `${PUBLIC}${ENTRY}?platform=${platform}&${QUERY}` },
  };
}

beforeAll(async () => {
  // Stand-in Metro: answers what Metro would, and records every request that
  // gets past the proxy. Its error page carries the kind of detail Metro's do.
  metro = http.createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '' });
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/') {
      const platform = String(req.headers['expo-platform'] ?? url.searchParams.get('platform') ?? 'ios');
      res.writeHead(200, { 'content-type': 'application/expo+json', 'expo-protocol-version': '0' });
      return res.end(JSON.stringify(manifest(platform)));
    }
    if (url.pathname === '/status') return res.end('packager-status:running');
    if (url.pathname === ENTRY) {
      if (failBundle) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            type: 'TransformError',
            message: 'SyntaxError: /Users/someone/KGC/2KGC-App/app/src/app/index.tsx: Unexpected token (3:4)',
            snippet: '> 3 | const key = "secret";',
          }),
        );
      }
      res.writeHead(200, {
        'content-type': 'application/javascript',
        'x-react-native-project-root': '/Users/someone/KGC/2KGC-App/app',
        'x-metro-files-changed-count': '0',
      });
      return res.end(`// bundle ${url.searchParams.get('platform')}`);
    }
    if (url.pathname === '/assets/') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end('PNG');
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `Unable to resolve module from /Users/someone/KGC/2KGC-App/.${url.pathname}` }));
  });
  await new Promise<void>((r) => metro.listen(0, 'localhost', r));
  proxy = createProxy({ metroPort: (metro.address() as AddressInfo).port });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => metro.close(r));
});

beforeEach(() => {
  seen = [];
  failBundle = false;
});

/** Raw request, so the path reaches the proxy exactly as written. */
function send(method: string, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(method === 'POST' || method === 'PUT' ? 'x' : undefined);
  });
}

describe('requests Expo Go makes', () => {
  it('serves the manifest for iOS and Android, by header or by query', async () => {
    for (const platform of ['ios', 'android']) {
      const res = await send('GET', '/', { 'expo-platform': platform, accept: 'application/expo+json,application/json' });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).launchAsset.url).toBe(`${PUBLIC}${ENTRY}?platform=${platform}&${QUERY}`);
      expect(res.headers['expo-protocol-version']).toBe('0');
    }
    expect((await send('GET', '/?platform=android')).status).toBe(200);
    expect((await send('GET', '/status')).body).toBe('packager-status:running');
  });

  it('serves the bundle each manifest names, and both use the same entry path', async () => {
    const ios = await send('GET', IOS_BUNDLE);
    const android = await send('GET', ANDROID_BUNDLE);
    expect([ios.status, ios.body]).toEqual([200, '// bundle ios']);
    expect([android.status, android.body]).toEqual([200, '// bundle android']);
    expect(new URL(IOS_BUNDLE, PUBLIC).pathname).toBe(new URL(ANDROID_BUNDLE, PUBLIC).pathname);
    expect((await send('HEAD', IOS_BUNDLE)).status).toBe(200);
  });

  it('accepts the same bundle query in another order or encoding', async () => {
    const reordered = `${ENTRY}?${QUERY}&platform=ios`.replace('src%2Fapp', 'src/app');
    expect((await send('GET', reordered)).status).toBe(200);
  });

  it.each(ASSETS)('serves the asset %s', async (url) => {
    const res = await send('GET', url);
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual([url]);
  });

  it('does not pass headers that name folders on the Mac', async () => {
    const res = await send('GET', IOS_BUNDLE);
    expect(res.headers['x-react-native-project-root']).toBeUndefined();
    expect(res.headers['x-metro-files-changed-count']).toBeUndefined();
    expect(res.headers['content-type']).toBe('application/javascript');
  });
});

describe('everything else', () => {
  it.each(ATTACKS)('%s %s is a plain 404 that never reaches Metro', async (method, path) => {
    const res = await send(method, path);
    expect(res.status).toBe(404);
    expect(res.body).toBe('Not found\n');
    // The manifest fetches that teach the proxy the bundle URLs are its own;
    // nothing the attacker sent may arrive.
    expect(seen.filter((s) => s.url !== '/')).toEqual([]);
  });

  it('replaces a Metro build error with plain text: no path, no code frame', async () => {
    failBundle = true;
    const res = await send('GET', IOS_BUNDLE);
    expect(res.status).toBe(502);
    expect(res.body).toBe('The app could not be served right now.\n');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
  });

  it('refuses websocket upgrades', async () => {
    const closed = await new Promise<boolean>((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: proxyPort,
        path: '/message',
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      });
      req.on('upgrade', () => resolve(false));
      req.on('response', () => resolve(false));
      req.on('error', () => resolve(true));
      req.on('close', () => resolve(true));
      req.end();
    });
    expect(closed).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe('classify', () => {
  const bundles = new Set([canonical(IOS_BUNDLE), canonical(ANDROID_BUNDLE)]);

  it('knows the legitimate requests', () => {
    expect(classify('GET', '/', bundles)).toBe('manifest');
    expect(classify('GET', IOS_BUNDLE, bundles)).toBe('bundle');
    expect(classify('HEAD', ANDROID_BUNDLE, bundles)).toBe('bundle');
    for (const a of ASSETS) expect(classify('GET', a, bundles)).toBe('asset');
  });

  it('refuses a bundle before the manifest has named one', () => {
    expect(classify('GET', IOS_BUNDLE, new Set())).toBeNull();
  });

  it.each(ATTACKS)('refuses %s %s', (method, path) => {
    expect(classify(method, path, bundles)).toBeNull();
  });
});
