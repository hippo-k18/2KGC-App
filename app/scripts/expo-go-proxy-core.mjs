// The rules and the server behind expo-go-proxy.mjs, split out so
// tests/expo-go-proxy can run them against a stand-in Metro.
//
// Metro's server root is the repo root (watchFolders), and Metro will bundle
// whatever path and options a request names. Through the public link that
// meant (T240, T241):
//   - any "<path>.bundle" or ".map" returned that .js or .json file from the
//     checkout, dot-folders included (.secrets/service-account.json);
//   - the entry bundle with `transform.routerRoot=<other folder>` makes
//     expo-router's require.context bundle every file in that folder instead
//     of app/src/app;
//   - an asset path ending "x.json?.png" passes a suffix check while Metro
//     reads only the part before the "?".
// So the proxy passes the manifest, the bundle URL the manifest itself names
// (path AND query, nothing added or changed), and image or font files from the
// folders the bundle references. Everything else is a plain 404, and Metro's
// own error pages (which carry absolute paths and code frames) never get out.
import http from 'node:http';

export const MANIFEST_PATHS = new Set(['/', '/manifest', '/status']);

// Folders the bundle's assets come from, as Metro writes them in
// `/assets/?unstable_path=<dir><file>`, relative to app/.
export const ASSET_DIRS = [
  './assets/',
  './../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/',
  './../node_modules/expo-router/assets/',
  // Android only: NativeTabs' icon font.
  './../node_modules/@expo-google-fonts/material-symbols/',
];
const ASSET_FILE = /^[A-Za-z0-9_@-][A-Za-z0-9_@.-]*(\/[A-Za-z0-9_@-][A-Za-z0-9_@.-]*)*\.(png|jpe?g|gif|webp|ttf|otf|xml)$/;
// What may follow the file inside unstable_path ("?platform=ios").
const ASSET_SECONDARY = /^(platform=(ios|android))?$/;
const ASSET_PARAMS = new Set(['unstable_path', 'platform', 'hash']);

/** "path?sorted query", so two spellings of the same request compare equal. */
export function canonical(url) {
  const u = new URL(url, 'http://x');
  const keys = [...u.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null; // ?a=1&a=2: Metro and we might read different ones
  const query = [...u.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return u.pathname + (query ? `?${query}` : '');
}

function assetAllowed(params) {
  for (const key of params.keys()) if (!ASSET_PARAMS.has(key)) return false;
  if (params.getAll('unstable_path').length !== 1) return false;
  const value = params.get('unstable_path');
  const q = value.indexOf('?');
  const file = q === -1 ? value : value.slice(0, q);
  const secondary = q === -1 ? '' : value.slice(q + 1);
  const dir = ASSET_DIRS.find((d) => file.startsWith(d));
  if (!dir || !ASSET_SECONDARY.test(secondary)) return false;
  const rest = file.slice(dir.length);
  return ASSET_FILE.test(rest) && !rest.split('/').some((seg) => seg === '..' || seg === '.');
}

/**
 * What a request is, or null when it must not reach Metro.
 * `bundles` is the set of canonical bundle URLs the manifest names.
 */
export function classify(method, rawUrl, bundles) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  // Origin-form only: "/x". Not "//host/x", not "http://…", not "*".
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return null;
  if (/[\\\0]|%00|%5c/i.test(rawUrl)) return null;
  let url;
  try {
    url = new URL(rawUrl, 'http://x');
  } catch {
    return null;
  }
  if (MANIFEST_PATHS.has(url.pathname)) {
    // The manifest is asked for as "/" with headers, or with ?platform=.
    for (const key of url.searchParams.keys()) if (key !== 'platform') return null;
    return 'manifest';
  }
  if (url.pathname === '/assets/') return assetAllowed(url.searchParams) ? 'asset' : null;
  if (url.pathname.endsWith('.bundle')) {
    const key = canonical(rawUrl);
    return key && bundles.has(key) ? 'bundle' : null;
  }
  return null;
}

/** The bundle URL the manifest names, as a canonical "path?query". */
export function bundleFromManifest(manifest) {
  const launch = manifest?.launchAsset?.url;
  if (typeof launch !== 'string') return null;
  const u = new URL(launch);
  return canonical(u.pathname + u.search);
}

// Response headers that may pass. Metro adds others (X-React-Native-Project-Root
// and friends) that name folders on this Mac.
const PASS_HEADERS = /^(content-type|content-length|content-range|accept-ranges|cache-control|etag|last-modified|date|vary|expo-[a-z0-9-]+)$/;

function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) if (PASS_HEADERS.test(k.toLowerCase())) out[k] = v;
  return out;
}

function plain(res, status, text) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function fetchManifest(metroPort, platform) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: 'localhost',
        port: metroPort,
        path: '/',
        headers: { 'expo-platform': platform, accept: 'application/expo+json,application/json' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(body) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(60_000, () => req.destroy());
    req.end();
  });
}

/**
 * The proxy server. The bundle URLs are learned from Metro's own manifest for
 * iOS and Android when first needed (Metro starts after the proxy).
 */
export function createProxy({ metroPort, platforms = ['ios', 'android'] }) {
  const bundles = new Set();
  let learning = null;
  const learn = () =>
    (learning ??= Promise.all(platforms.map((p) => fetchManifest(metroPort, p)))
      .then((manifests) => {
        for (const m of manifests) {
          const b = bundleFromManifest(m);
          if (b) bundles.add(b);
        }
      })
      .finally(() => {
        learning = null;
      }));

  const server = http.createServer(async (req, res) => {
    let kind = classify(req.method, req.url, bundles);
    // Until both platforms' bundle URLs are known, a bundle request that
    // misses asks Metro for its manifests once more. After that, no request
    // can make the proxy call Metro except an allowed one.
    if (kind === null && bundles.size < platforms.length && req.url?.split('?')[0].endsWith('.bundle')) {
      await learn();
      kind = classify(req.method, req.url, bundles);
    }
    if (kind === null) return plain(res, 404, 'Not found\n');

    const target = new URL(req.url, 'http://x');
    const headers = { ...req.headers };
    delete headers['accept-encoding']; // keep bodies inspectable; the tunnel compresses
    const upstream = http.request(
      { host: 'localhost', port: metroPort, method: req.method, path: target.pathname + target.search, headers },
      (up) => {
        const status = up.statusCode ?? 502;
        if (status >= 400) {
          up.resume();
          return status >= 500
            ? plain(res, 502, 'The app could not be served right now.\n')
            : plain(res, 404, 'Not found\n');
        }
        res.writeHead(status, cleanHeaders(up.headers));
        up.pipe(res);
      },
    );
    upstream.on('error', () => plain(res, 502, 'The app could not be served right now.\n'));
    req.pipe(upstream);
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.bundles = bundles;
  return server;
}
