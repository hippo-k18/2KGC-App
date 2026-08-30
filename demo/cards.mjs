/**
 * Title cards, rendered as HTML and shot at 1600x900 so they match the capture
 * resolution exactly and need no scaling in the composite.
 *
 * Palette is the live knowledgegraph.tech theme's own: navy #263759 ground,
 * orange #f68621 rule. Cards are stills — ffmpeg holds each one — so nothing
 * here animates.
 *
 * The caveats appear twice on purpose: pinned to every frame of acts one and
 * three by `caveat()` in `lib.mjs`, and again on the closing card. A viewer who
 * joins late, or who only watches the end, still gets told what is not wired up.
 *
 * The claim code is a snapshot of one run, not a constant, so it is passed in:
 *
 *   CLAIM=FH79TP node cards.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = new URL('./cards/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const CLAIM = process.env.CLAIM ?? '——————';

const CARDS = [
  ['00-open', 'Knowledge Graph Conference 2027',
    'One backend. Three surfaces.',
    'Public website · attendee app · organizer dashboard — all deployed, all reading one Firestore project'],
  ['01-buy', 'One — buying a ticket',
    'On the live site, with a real registration written',
    ''],
  ['02-app', 'Two — using the ticket',
    'The same registration, on the phone',
    ''],
  ['03-dash', 'Three — one price, one backend',
    'The organizer changes a price; the website is already showing it',
    ''],
  ['04-end', 'Recorded against production',
    'Nothing staged, nothing mocked, nothing rebuilt between the acts',
    `A real registration was written · claim code ${CLAIM} · Main Conference moved $799 → $699 on camera`],
  ['05-credit', 'Produced by Claude',
    'Recorded, edited and scored end to end by Claude',
    'Anthropic · for the Knowledge Graph Conference'],
];

/** The closing caveat card, which has its own layout rather than a foot line. */
const CAVEAT_CARD = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1600px;height:900px;background:#263759;display:flex;flex-direction:column;
    justify-content:center;padding:0 130px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;color:#fff}
  .rule{width:74px;height:5px;background:#f68621;margin-bottom:38px}
  h1{font-size:66px;font-weight:700;letter-spacing:-.022em;line-height:1.06}
  .row{display:flex;gap:30px;margin-top:46px}
  .box{flex:1;background:rgba(9,13,22,.42);border:1px solid rgba(246,134,33,.4);
    border-radius:9px;padding:26px 30px 28px}
  .box h2{font-size:31px;font-weight:680;letter-spacing:-.012em}
  .box p{font-size:20px;color:#c3cddd;margin-top:12px;line-height:1.42}
  .tag{font-size:13px;font-weight:750;letter-spacing:.15em;color:#f6a63f;
    text-transform:uppercase;margin-bottom:12px}
</style></head><body>
  <div class="rule"></div>
  <h1>Two things are not installed yet</h1>
  <div class="row">
    <div class="box">
      <div class="tag">Not connected</div>
      <h2>Stripe</h2>
      <p>No card is charged. The order is approved in demo mode and stamped
         <code>channel: demo</code>, so it can never be counted as revenue —
         but it is written exactly as a paid order would be.</p>
    </div>
    <div class="box">
      <div class="tag">Not connected</div>
      <h2>HubSpot</h2>
      <p>The dashboard carries the connection screen. Nothing syncs a contact
         out of a purchase yet, so no CRM record is created by anything in
         this video.</p>
    </div>
  </div>
</body></html>`;

const html = (title, sub, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1600px;height:900px;background:#263759;display:flex;flex-direction:column;
    justify-content:center;padding:0 130px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;color:#fff}
  .rule{width:74px;height:5px;background:#f68621;margin-bottom:38px}
  h1{font-size:74px;font-weight:700;letter-spacing:-.022em;line-height:1.06;max-width:20ch}
  .sub{font-size:31px;color:#c3cddd;margin-top:22px;font-weight:400;line-height:1.35;max-width:34ch}
  .foot{font-size:19px;color:#8d9bb4;margin-top:52px;letter-spacing:.01em;max-width:70ch;line-height:1.45}
</style></head><body>
  <div class="rule"></div>
  <h1>${title}</h1>
  ${sub ? `<div class="sub">${sub}</div>` : ''}
  ${foot ? `<div class="foot">${foot}</div>` : ''}
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
for (const [id, t, s, f] of CARDS) {
  await p.setContent(html(t, s, f), { waitUntil: 'load' });
  await p.waitForTimeout(220);
  await p.screenshot({ path: `${OUT}${id}.png` });
  console.log('card', id);
}
await p.setContent(CAVEAT_CARD, { waitUntil: 'load' });
await p.waitForTimeout(220);
await p.screenshot({ path: `${OUT}06-caveat.png` });
console.log('card 06-caveat');
await b.close();
