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

function allowed(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = new URL(req.url, 'http://x').pathname;
  return (
    path === '/' ||
    path === '/manifest' ||
    path === '/status' ||
    path.endsWith('.bundle') ||
    path.endsWith('.map') ||
    path.startsWith('/assets/')
  );
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
