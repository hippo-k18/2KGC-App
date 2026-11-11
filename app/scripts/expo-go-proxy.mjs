// The only door from the public tunnel to Metro.
//
//   node app/scripts/expo-go-proxy.mjs <listen-port> <metro-port>
//
// expo-go-share.sh puts Metro on a public URL so any phone can open the app.
// Metro is a development server, and besides the app it serves endpoints that
// act on this Mac: /_expo/touch creates files in the project, /open-stack-frame
// opens a file in the editor, /_expo/debugger and /inspector attach a debugger,
// and the /message and /hot websockets can reload or drive every connected app.
// It will also bundle any file in the checkout it is asked for. None of that
// should be reachable by whoever holds the link.
//
// Expo Go needs three things, all GET: the manifest at "/", the one bundle the
// manifest names, and the images and fonts under "/assets". The rules are in
// expo-go-proxy-core.mjs (tested in tests/expo-go-proxy). Everything else gets
// a 404, Metro's error pages are replaced with plain text, and websocket
// upgrades are refused. The share script runs Metro with --no-dev, so the app
// never tries to open the hot-reload socket in the first place.
import { createProxy } from './expo-go-proxy-core.mjs';

const [listenPort, metroPort] = process.argv.slice(2).map(Number);
if (!listenPort || !metroPort) {
  console.error('usage: node app/scripts/expo-go-proxy.mjs <listen-port> <metro-port>');
  process.exit(1);
}

createProxy({ metroPort }).listen(listenPort, '127.0.0.1', () => {
  console.log(`expo-go-proxy: 127.0.0.1:${listenPort} -> Metro localhost:${metroPort}`);
});
