/**
 * Render the iPhone bezel as a transparent PNG.
 *
 * Drawn rather than sourced: a stock device mockup is someone else's asset with
 * someone else's licence, and this only has to be a rounded dark shell with a
 * notch. Drawing it also means the screen cutout is at coordinates we choose,
 * so the app capture can be registered into it exactly instead of being nudged
 * until it looks right.
 *
 * The screen is 430x932 logical — the capture's own size — scaled by SCALE so
 * the phone fills a 1080-high frame with room to breathe. `build.sh` reads the
 * same numbers out of `phone-frame.json`, so the two cannot drift.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const SCREEN_W = 430;
const SCREEN_H = 932;
const SCALE = 0.95;          // screen height 885 in a 1080 frame
const BEZEL = 13;            // black border around the glass
const RADIUS = 56;           // outer corner radius, at scale

const sw = Math.round(SCREEN_W * SCALE);
const sh = Math.round(SCREEN_H * SCALE);
const ow = sw + BEZEL * 2;
const oh = sh + BEZEL * 2;

/*
 * Drawn as SVG with a mask rather than nested divs.
 *
 * The div version looked right and was wrong: `.glass` was `background:
 * transparent`, but its parent carried the shell gradient, so the exported PNG
 * had the gradient *behind* the glass instead of a hole. Composited over the
 * app capture that produced a convincing, entirely black screen.
 *
 * A mask punches a real hole with the correct inner radius, so the alpha
 * channel is genuinely empty where the video goes.
 */
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:transparent}
  body{width:${ow + 40}px;height:${oh + 40}px;display:flex;align-items:center;justify-content:center}
  svg{display:block;filter:drop-shadow(0 22px 46px rgba(0,0,0,.45))}
</style></head><body>
<svg width="${ow}" height="${oh}" viewBox="0 0 ${ow} ${oh}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#4a4f57"/>
      <stop offset="16%"  stop-color="#23262b"/>
      <stop offset="50%"  stop-color="#16181c"/>
      <stop offset="84%"  stop-color="#23262b"/>
      <stop offset="100%" stop-color="#4a4f57"/>
    </linearGradient>
    <mask id="hole">
      <rect x="0" y="0" width="${ow}" height="${oh}" rx="${RADIUS}" fill="#fff"/>
      <rect x="${BEZEL}" y="${BEZEL}" width="${sw}" height="${sh}"
            rx="${RADIUS - BEZEL}" fill="#000"/>
    </mask>
  </defs>

  <!-- The shell, with the glass area masked out to real transparency. -->
  <rect x="0" y="0" width="${ow}" height="${oh}" rx="${RADIUS}"
        fill="url(#shell)" mask="url(#hole)"/>

  <!-- A hairline just inside the glass, so the screen edge reads as glass. -->
  <rect x="${BEZEL - 0.75}" y="${BEZEL - 0.75}" width="${sw + 1.5}" height="${sh + 1.5}"
        rx="${RADIUS - BEZEL + 1}" fill="none" stroke="#05070a" stroke-width="1.5"/>

  <!-- Dynamic Island, opaque, drawn over the top of the screen. -->
  <rect x="${ow / 2 - 53}" y="${BEZEL + 9}" width="106" height="31" rx="15.5" fill="#05070a"/>
  <circle cx="${ow / 2 + 38}" cy="${BEZEL + 24.5}" r="4" fill="#12203a"/>

  <!-- Side buttons. -->
  <rect x="-2" y="116" width="3" height="32" rx="1.5" fill="#31363e"/>
  <rect x="-2" y="168" width="3" height="56" rx="1.5" fill="#31363e"/>
  <rect x="-2" y="238" width="3" height="56" rx="1.5" fill="#31363e"/>
  <rect x="${ow - 1}" y="196" width="3" height="92" rx="1.5" fill="#31363e"/>
</svg>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: ow + 40, height: oh + 40 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'load' });
await p.waitForTimeout(220);
await p.screenshot({
  path: new URL('./cards/phone-frame.png', import.meta.url).pathname,
  omitBackground: true,
});
await b.close();

// Where the glass sits inside the exported PNG, in its own pixels (deviceScaleFactor 2).
const meta = {
  pngW: (ow + 40) * 2,
  pngH: (oh + 40) * 2,
  screenX: (20 + BEZEL) * 2,
  screenY: (20 + BEZEL) * 2,
  screenW: sw * 2,
  screenH: sh * 2,
  radius: (RADIUS - BEZEL) * 2,
};
writeFileSync(new URL('./cards/phone-frame.json', import.meta.url).pathname, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
