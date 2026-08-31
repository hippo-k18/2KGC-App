/**
 * Shared driving helpers for the demo recording.
 *
 * Playwright's `recordVideo` captures the page exactly as rendered, which is
 * faithful but reads as a robot: the pointer is invisible, scrolling teleports,
 * and clicks land with no acknowledgement. The helpers below add those back by
 * injecting into the page, so nothing depends on the host machine's real mouse
 * and the recording is reproducible.
 *
 * ## Second pass, after watching the first cut
 *
 * Three things were wrong and are fixed here:
 *
 *  - **Scrolling was fast and jittery.** It ran at roughly 1,400 px/s into a
 *    25fps recording — 56px of travel per captured frame, which the eye reads
 *    as stutter rather than motion. `scrollTo` is now paced at a fixed px/sec
 *    and its duration is derived from the distance, so a long page takes longer
 *    instead of moving faster.
 *  - **Clicks were invisible in the app.** Navigation there was `page.goto`,
 *    so screens changed with the cursor sitting still and nothing to explain
 *    why. `tapAt` gives every transition a real press animation.
 *  - **Captions were too quiet.** They are larger now, with a card behind them
 *    and an accent rule, and they animate in rather than appearing.
 */

/**
 * Reading pace, in pixels per second.
 *
 * 210 read as too slow once the pauses were removed — with the cursor always
 * either scrolling or travelling, the eye tolerates twice the speed. 420 puts a
 * screen of copy on screen for about two seconds.
 */
const SCROLL_PX_PER_SEC = 420;

/** Inject the cursor. Idempotent, because every navigation clears it. */
export async function installCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('__demo_cursor')) return;

    const style = document.createElement('style');
    style.textContent = `
      /*
       * Netlify's own "Powered by Netlify" drawer, which the free plan injects
       * as a fixed iframe in the bottom-right corner. It sits directly on top
       * of the app's tab bar, so it is hidden for the recording. The hosting is
       * not being concealed — both sites are named on screen and in the closing
       * card; what is removed is a floating widget over the navigation.
       */
      #nl-badge-frame,iframe[src*="netlify"]{display:none!important}

      #__demo_cursor{position:fixed;left:0;top:0;width:44px;height:44px;z-index:2147483647;
        pointer-events:none;transform:translate(-50%,-50%);will-change:transform;
        display:flex;align-items:center;justify-content:center}
      #__demo_cursor .halo{position:absolute;inset:0;border-radius:50%;
        background:radial-gradient(circle at 42% 38%, rgba(255,214,64,.96) 0%, rgba(250,196,20,.9) 55%, rgba(233,176,0,.72) 100%);
        border:2px solid rgba(255,236,150,.95);
        box-shadow:0 3px 12px rgba(0,0,0,.42), 0 0 0 1px rgba(120,86,0,.35)}
      #__demo_cursor svg{position:relative;display:block;
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}

      /* Two rings and a flash: readable even over a busy photograph. */
      .__demo_ring{position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;
        transform:translate(-50%,-50%);border:3px solid #ffffff;animation:__demo_ring .62s cubic-bezier(.22,.7,.3,1) forwards}
      .__demo_ring.b{border-width:2px;border-color:rgba(255,255,255,.9);animation-delay:.07s}
      .__demo_dot{position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;
        width:15px;height:15px;background:rgba(255,214,64,.6);transform:translate(-50%,-50%);
        animation:__demo_dot .42s ease-out forwards}
      @keyframes __demo_ring{from{width:10px;height:10px;opacity:1}to{width:82px;height:82px;opacity:0}}
      @keyframes __demo_dot{from{opacity:.85;transform:translate(-50%,-50%) scale(.5)}
        to{opacity:0;transform:translate(-50%,-50%) scale(2.1)}}
    `;
    document.head.appendChild(style);

    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = `<span class="halo"></span>` +
      `<svg width="19" height="19" viewBox="0 0 22 22">
      <path d="M2 1 L2 16.5 L6.2 12.6 L9 19 L12 17.6 L9.2 11.4 L15 11.2 Z"
            fill="#23282f" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(c);

    window.__demoMove = (x, y) => {
      const el = document.getElementById('__demo_cursor');
      if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    };
    window.__demoPress = (x, y) => {
      for (const cls of ['__demo_dot', '__demo_ring', '__demo_ring b']) {
        const r = document.createElement('div');
        r.className = cls;
        r.style.left = x + 'px';
        r.style.top = y + 'px';
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 800);
      }
      // A small recoil on the arrow itself, so the press reads as a press.
      const el = document.getElementById('__demo_cursor');
      if (el) {
        const t = el.style.transform;
        el.style.transform = t + ' scale(.82)';
        setTimeout(() => { el.style.transform = t; }, 130);
      }
    };
    window.__demoMove(innerWidth / 2, innerHeight * 0.42);
  }).catch(() => {});
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * Wander the cursor slowly across the viewport for `ms`.
 *
 * Used only where the page itself cannot move — a bundle still loading, a
 * navigation in flight. Everywhere else the cursor is either scrolling or on
 * its way to the next target, which is what the brief asks for: it drifted in
 * place in the previous cut, and hovering reads as waiting.
 */
export async function wander(page, ms) {
  const from = await cursorAt(page);
  const vp = page.viewportSize() ?? { width: 1600, height: 900 };
  const to = {
    x: Math.max(80, Math.min(vp.width - 80, from.x + (Math.random() - 0.5) * vp.width * 0.5)),
    y: Math.max(80, Math.min(vp.height - 120, from.y + (Math.random() - 0.5) * vp.height * 0.4)),
  };
  await glide(page, to.x, to.y, ms);
}

export const cursorAt = (page) =>
  page.evaluate(() => {
    const el = document.getElementById('__demo_cursor');
    if (!el) return { x: innerWidth / 2, y: innerHeight * 0.42 };
    const m = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    return m ? { x: +m[1], y: +m[2] } : { x: innerWidth / 2, y: innerHeight * 0.42 };
  }).catch(() => ({ x: 700, y: 400 }));

/** Glide the cursor to a viewport point, driving the real mouse alongside it. */
export async function glide(page, x, y, ms) {
  const from = await cursorAt(page);
  const dist = Math.hypot(x - from.x, y - from.y);
  // Travel time follows distance, so a short hop is not as slow as a long one.
  const dur = ms ?? Math.min(1000, Math.max(300, dist * 1.15));
  const steps = Math.max(14, Math.round(dur / 16));
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    const cx = from.x + (x - from.x) * t;
    const cy = from.y + (y - from.y) * t;
    await page.evaluate(([a, b]) => window.__demoMove?.(a, b), [cx, cy]).catch(() => {});
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(16);
  }
}

/** Show a press at a viewport point. Used on its own where there is no element. */
export async function tapAt(page, x, y, { settle = 620 } = {}) {
  await glide(page, x, y);
  await page.evaluate(([a, b]) => window.__demoPress?.(a, b), [x, y]).catch(() => {});
  await page.waitForTimeout(settle);
}

/** Move to an element, press it visibly, click it. Returns false if absent. */
export async function clickIt(page, locator, { settle = 900 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  if (!(await el.count().catch(() => 0))) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(240);
  const box = await el.boundingBox().catch(() => null);
  if (!box) return false;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await glide(page, x, y);
  await page.evaluate(([a, b]) => window.__demoPress?.(a, b), [x, y]).catch(() => {});
  await page.waitForTimeout(210);
  await el.click({ timeout: 12000, force: true }).catch(() => {});
  await page.waitForTimeout(settle);
  return true;
}

/**
 * Scroll to an absolute Y at a fixed reading pace.
 *
 * Done in-page rather than with `mouse.wheel`, because a wheel event on a page
 * with its own scroll container lands in the wrong element on some routes.
 */
export async function scrollTo(page, y, opts = {}) {
  const pace = opts.pace ?? SCROLL_PX_PER_SEC;
  const max = opts.maxMs ?? 26000;

  // Kick the scroll off without awaiting it, so the cursor can be driven from
  // here while the page is still moving.
  const scrolling = page.evaluate(async ([target, pxPerSec, maxMs]) => {
    const start = window.scrollY;
    const limit = Math.max(0, document.body.scrollHeight - innerHeight);
    const end = Math.min(target, limit);
    const dist = Math.abs(end - start);
    if (dist < 4) return 0;
    const dur = Math.min(maxMs, Math.max(380, (dist / pxPerSec) * 1000));
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        // Most of the travel happens at a constant readable speed; the ease is
        // only there to take the edge off the start and stop.
        const e = p < 0.12 ? (p / 0.12) * 0.06
          : p > 0.92 ? 0.94 + (1 - Math.pow(1 - (p - 0.92) / 0.08, 2)) * 0.06
          : 0.06 + ((p - 0.12) / 0.8) * 0.88;
        window.scrollTo(0, start + (end - start) * e);
        p < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
    return dur;
  }, [y, pace, max]).catch(() => 0);

  /*
   * The cursor tracks down the page as it scrolls, on a slow diagonal, rather
   * than orbiting one point. A pointer circling in place reads as waiting; a
   * pointer moving with the content reads as reading.
   */
  let done = false;
  scrolling.then(() => { done = true; }).catch(() => { done = true; });
  const from = await cursorAt(page);
  const vp = page.viewportSize() ?? { width: 1600, height: 900 };
  const target = opts.lookAt ?? { x: vp.width * (0.3 + Math.random() * 0.4), y: vp.height * 0.62 };
  const t0 = Date.now();
  while (!done && Date.now() - t0 < max + 2000) {
    const t = Math.min(1, (Date.now() - t0) / 2600);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const wobble = Math.sin((Date.now() - t0) / 900) * 16;
    const cx = from.x + (target.x - from.x) * e + wobble;
    const cy = from.y + (target.y - from.y) * e + wobble * 0.4;
    await page.evaluate(([a, b]) => window.__demoMove?.(a, b), [cx, cy]).catch(() => {});
    await page.mouse.move(cx, cy).catch(() => {});
    await page.waitForTimeout(32);
  }
  await scrolling;
}

/**
 * Read down the whole page, once.
 *
 * No hold at the bottom and no trip back to the top: both were dead time, and
 * nobody re-reads a page on the way up. The next action navigates away, so the
 * scroll runs straight into it.
 */
export async function skim(page, { pace, lookAt } = {}) {
  const h = await page.evaluate(() => document.body.scrollHeight - innerHeight).catch(() => 0);
  if (h <= 40) return;
  await scrollTo(page, h, { pace, lookAt });
}

/** Type at a human cadence, so the viewer can read the field fill in. */
export async function typeIt(page, locator, text, { delay = 52 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  if (!(await el.count().catch(() => 0))) return false;
  const box = await el.boundingBox().catch(() => null);
  if (box) {
    const x = box.x + Math.min(box.width - 20, 120);
    const y = box.y + box.height / 2;
    await glide(page, x, y);
    await page.evaluate(([a, b]) => window.__demoPress?.(a, b), [x, y]).catch(() => {});
  }
  await el.click({ timeout: 8000 }).catch(() => {});
  await el.fill('').catch(() => {});
  await el.type(text, { delay }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

/** Dismiss the site's own cookie notice so it is not in every frame. */
export async function dismissCookie(page) {
  for (const sel of ['text=Got it', 'text=Accept all', 'text=Accept']) {
    try {
      const e = page.locator(sel).first();
      if (await e.isVisible({ timeout: 500 })) { await clickIt(page, e, { settle: 400 }); return; }
    } catch { /* not present, the common case */ }
  }
}

/**
 * A caption card, bottom-left, held for `ms`.
 *
 * Larger and higher-contrast than the first cut's, which sat in a gradient and
 * was easy to miss against a photograph. `phone` shrinks it for the 430px-wide
 * app capture, where the desktop size would cover half the screen.
 */
export async function caption(page, text, sub = '', ms = 2200, { phone = false } = {}) {
  await page.evaluate(([t, s, small, hold]) => {
    document.getElementById('__demo_cap')?.remove();
    const pad = small ? '14px 16px' : '22px 30px';
    const size = small ? 19 : 34;
    const subSize = small ? 13 : 19;
    const w = document.createElement('div');
    w.id = '__demo_cap';
    // On the phone the tab bar now sits along the bottom, so the caption has
    // to clear it; on the desktop capture there is nothing down there.
    w.style.cssText = `position:fixed;left:${small ? 12 : 46}px;bottom:${small ? 88 : 46}px;
      max-width:${small ? 'calc(100% - 24px)' : '62%'};z-index:2147483645;pointer-events:none;
      background:rgba(16,21,31,.93);border-left:5px solid #f68621;border-radius:4px;padding:${pad};
      box-shadow:0 12px 40px rgba(0,0,0,.42);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff;
      opacity:0;transform:translateY(14px);transition:opacity .3s ease,transform .3s ease`;
    w.innerHTML =
      `<div style="font-size:${size}px;font-weight:650;letter-spacing:-.012em;line-height:1.2">${t}</div>` +
      (s ? `<div style="font-size:${subSize}px;color:#c6cedb;margin-top:${small ? 4 : 8}px;line-height:1.35">${s}</div>` : '');
    document.body.appendChild(w);
    requestAnimationFrame(() => { w.style.opacity = '1'; w.style.transform = 'translateY(0)'; });

    // Retires itself. The caller does not await it, so the card plays over the
    // scroll that follows instead of stopping everything to be read.
    setTimeout(() => {
      const c = document.getElementById('__demo_cap');
      if (!c) return;
      c.style.opacity = '0';
      c.style.transform = 'translateY(10px)';
      setTimeout(() => c.remove(), 340);
    }, hold);
  }, [text, sub, phone, ms]).catch(() => {});
}

/**
 * A standing caveat, pinned to the top-right for as long as it is not cleared.
 *
 * ── Why this is a first-class helper and not a caption ──────────────────────
 *
 * A caption states what is happening; this states what is *not* real. The two
 * cannot share a mechanism, because a caption retires itself after a few
 * seconds and a caveat has to survive every frame it applies to — otherwise the
 * one frame somebody screenshots is the frame where the disclaimer had just
 * faded out.
 *
 * It is re-applied by `installCursor`'s callers after every navigation, the
 * same way the cursor is, because a page load clears the injected DOM.
 *
 * The two lines it carries were the honest state of the money path on
 * 2026-08-29: `DEMO_MODE=1` approved the payment without Stripe, and the
 * dashboard's HubSpot screen is a connection guide with nothing behind it. The
 * first half of that is now historical — demo mode is gone and the site refuses
 * to sell without a Stripe key. See the banner in README.md.
 */
export async function caveat(page, lines) {
  await page.evaluate((rows) => {
    document.getElementById('__demo_caveat')?.remove();
    if (!rows || !rows.length) return;
    const w = document.createElement('div');
    w.id = '__demo_caveat';
    /*
     * Bottom-right, opposite the caption.
     *
     * Two earlier positions were both wrong for the same reason — they covered
     * the thing the shot exists to show. At `top: 22px` the card sat across the
     * site's own navigation; at `top: 86px` it sat across the "Main Conference"
     * heading in act three, which is the single frame the whole video is built
     * to deliver. Down here it shares a row with nothing: captions are pinned
     * bottom-left at a 62% cap, and the one thing that did live in this corner
     * — Netlify's badge — is hidden by the stylesheet above.
     */
    w.style.cssText = `position:fixed;right:24px;bottom:24px;z-index:2147483644;pointer-events:none;
      background:rgba(24,17,10,.95);border:1px solid rgba(246,134,33,.6);border-radius:7px;
      padding:13px 18px 15px;box-shadow:0 14px 38px rgba(0,0,0,.45);width:400px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
    w.innerHTML =
      `<div style="font-size:12px;font-weight:750;letter-spacing:.14em;color:#f6a63f;
         text-transform:uppercase;margin-bottom:8px">Not connected yet</div>` +
      rows.map((r) =>
        `<div style="font-size:15px;color:#f3ece4;line-height:1.42;margin-top:5px">
           <strong style="color:#fff">${r[0]}</strong> — ${r[1]}</div>`).join('');
    document.body.appendChild(w);
  }, lines).catch(() => {});
}

/** The two caveats this recording carries, in one place so they cannot drift. */
export const CAVEATS = [
  ['Stripe', 'not installed — the payment is approved in demo mode'],
  ['HubSpot', 'not installed — no CRM sync behind the connection screen'],
];

/**
 * `installCursor` plus the standing caveat, which is what every navigation
 * actually needs. Kept separate from `installCursor` so the phone act — where a
 * 420px-wide banner would cover a third of the screen — can opt out.
 */
export async function reinstall(page, lines = CAVEATS) {
  await installCursor(page);
  await caveat(page, lines);
}
