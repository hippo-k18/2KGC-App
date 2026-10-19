/// <reference types="node" />
/**
 * Write the Expo Go QR code as a PNG and a one-page HTML handout.
 *
 *   npx tsx app/scripts/expo-go-qr.ts <exp-url> <out-dir>
 *
 * Writes <out-dir>/expo-go-qr.png and <out-dir>/expo-go.html. Called by
 * expo-go-share.sh each time the tunnel comes up, because a quick tunnel gets a
 * new hostname on every run and an old QR code then points nowhere.
 *
 * The QR comes from the app's own encoder (src/lib/qr/encode.ts, the one the
 * badge uses), so this needs no QR package. The PNG is written by hand with
 * zlib for the same reason: it is a grid of black and white squares.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { encodeQr } from '../src/lib/qr/encode';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: tsx app/scripts/expo-go-qr.ts <exp-url> <out-dir>');
  process.exit(1);
}

// Level M, the encoder's default: enough recovery for a code on a laptop screen
// or a printout, without a denser symbol than a phone camera likes.
const qr = encodeQr(url, 'M');
const QUIET = 4; // modules of white border the QR spec asks for
const SCALE = 12; // pixels per module
const side = (qr.size + QUIET * 2) * SCALE;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 8-bit greyscale, one filter byte (0, none) at the start of each row.
const raw = Buffer.alloc(side * (side + 1), 255);
for (let y = 0; y < side; y++) {
  raw[y * (side + 1)] = 0;
  const r = Math.floor(y / SCALE) - QUIET;
  for (let x = 0; x < side; x++) {
    const c = Math.floor(x / SCALE) - QUIET;
    const dark = r >= 0 && c >= 0 && r < qr.size && c < qr.size && qr.modules[r][c];
    if (dark) raw[y * (side + 1) + 1 + x] = 0;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(side, 0);
ihdr.writeUInt32BE(side, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // greyscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'expo-go-qr.png'), png);

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const href = escape(url);

writeFileSync(
  join(outDir, 'expo-go.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KGC app preview</title>
<style>
  :root { --bg: #f5f5f7; --card: #fff; --text: #1d1d1f; --muted: #6e6e73; --accent: #222c4f; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #000; --card: #1c1c1e; --text: #f5f5f7; --muted: #a1a1a6; --accent: #8ea2e8; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 17px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 40px 16px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 24px; }
  .qr { background: #fff; border-radius: 16px; padding: 16px; text-align: center; }
  .qr img { width: 100%; max-width: 320px; height: auto; image-rendering: pixelated; }
  ol { background: var(--card); border-radius: 16px; margin: 24px 0; padding: 20px 20px 20px 44px; }
  li + li { margin-top: 12px; }
  a { color: var(--accent); }
  .url { color: var(--muted); font: 13px/1.4 ui-monospace, Menlo, monospace; word-break: break-all; }
</style>
</head>
<body>
<main>
  <h1>KGC app preview</h1>
  <div class="qr"><img src="expo-go-qr.png" alt="QR code that opens the KGC app in Expo Go"></div>
  <ol>
    <li>Install <strong>Expo Go</strong> from the
      <a href="https://apps.apple.com/app/expo-go/id982107779">App Store</a> or
      <a href="https://play.google.com/store/apps/details?id=host.exp.exponent">Google Play</a>.</li>
    <li>Scan the code. On iPhone use the Camera app; on Android use the scanner in Expo Go.</li>
    <li>Sign in with the demo email and password you were given.</li>
  </ol>
  <p class="url">On the phone already? <a href="${href}">Open in Expo Go</a><br>${href}</p>
</main>
</body>
</html>
`,
);

console.log(`QR written to ${join(outDir, 'expo-go-qr.png')} (${qr.size}x${qr.size} modules)`);
