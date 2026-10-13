// The only door from the public tunnel to Metro.
//
//   node app/scripts/expo-go-proxy.mjs <listen-port> <metro-port>
//
// expo-go-share.sh puts Metro on a public URL so any phone can open the app.
// Metro is a development server, and besides the app it serves endpoints that
// act on this Mac: /_expo/touch creates files in the project, /open-stack-frame
// opens a file in the editor, /_expo/debugger and /inspector attach a debugger,
// and the /message and /hot websockets can reload or drive every connected app.
// None of that should be reachable by whoever holds the link.
//
// Expo Go needs three things, all GET: the manifest at "/", the JS bundle
// ("*.bundle", plus its source map if it asks), and the images and fonts under
// "/assets". Everything else gets a 404, and websocket upgrades are refused.
// The share script runs Metro with --no-dev, so the app never tries to open the
// hot-reload socket in the first place.
import http from 'node:http';

const [listenPort, metroPort] = process.argv.slice(2).map(Number);
if (!listenPort || !metroPort) {
  console.error('usage: node app/scripts/expo-go-proxy.mjs <listen-port> <metro-port>');
  process.exit(1);
}

// Exact paths only. Metro's server root is the repo root (watchFolders), so a
// suffix rule such as "ends in .bundle" let anyone bundle and download any
// .js or .json file in the checkout, dot-folders included (T240). The one
// bundle the manifest names is the entry below; source maps are not needed.
const BUNDLE = '/node_modules/expo-router/entry.bundle';
// Asset folders the bundle actually references, as `unstable_path` values
// relative to app/. Anything else, or anything with a further "..", is refused.
const ASSET_DIRS = [
  './assets/',
  './../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/',
  './../node_modules/expo-router/assets/',
];
const ASSET_FILE = /\.(png|jpe?g|gif|webp|svg|xml|ttf|otf)(\?.*)?$/i;

function allowed(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  if (path === '/' || path === '/manifest' || path === '/status') return true;
  if (path === BUNDLE) return true;
  if (path === '/assets/') {
    const asset = url.searchParams.get('unstable_path') ?? '';
    const dir = ASSET_DIRS.find((d) => asset.startsWith(d));
    if (!dir) return false;
    const rest = asset.slice(dir.length);
    return !rest.includes('..') && !rest.includes('\\') && ASSET_FILE.test(rest);
  }
  return false;
}

const server = http.createServer((req, res) => {
  if (!allowed(req)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found\n');
    return;
  }
  const upstream = http.request(
    { host: 'localhost', port: metroPort, method: req.method, path: req.url, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Metro is not answering\n');
  });
  req.pipe(upstream);
});

server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(listenPort, '127.0.0.1', () => {
  console.log(`expo-go-proxy: 127.0.0.1:${listenPort} -> Metro localhost:${metroPort}`);
});
