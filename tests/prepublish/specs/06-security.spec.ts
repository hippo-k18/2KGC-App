import { LEAKS, MONEY_ROUTES, ROUTES, SALES, expect, test } from '../helpers';

/**
 * The money path's locks, checked from outside.
 *
 * Nothing here needs credentials: every check is something an anonymous
 * visitor could try, and every one must be refused.
 */

test.describe('locks on the purchase path @tickets', () => {
  test('the Stripe webhook refuses an unsigned post', async ({ request }) => {
    const res = await request.post('/api/stripe/webhook', {
      data: { type: 'checkout.session.completed', data: { object: { id: 'cs_forged' } } },
    });
    // 503 while Stripe is unconfigured, 400 for a missing signature once it is.
    // Never 2xx: a 200 here means anyone can mint themselves a ticket.
    expect(res.status(), await res.text()).toBe(SALES === 'closed' ? 503 : 400);
  });

  test('the Stripe webhook refuses a forged signature', async ({ request }) => {
    test.skip(SALES === 'closed');
    const res = await request.post('/api/stripe/webhook', {
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      data: '{"type":"checkout.session.completed"}',
    });
    expect(res.status()).toBe(400);
  });

  test('the Stripe webhook is never cached', async ({ request, baseURL }) => {
    test.skip(/localhost|127\.0\.0\.1/.test(baseURL!), 'set by the web server in front of the app, not by next start');
    const res = await request.post('/api/stripe/webhook', { data: {} });
    expect(res.headers()['cache-control'] ?? '').toMatch(/no-store|no-cache|private|max-age=0/);
  });

  test('the return route with no session goes back to checkout', async ({ request }) => {
    const res = await request.get('/checkout/return', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/tickets\/checkout/);
  });

  test('the return route does not issue a ticket for a made-up session', async ({ request }) => {
    const res = await request.get('/checkout/return?session_id=cs_test_forged_prepublish', { maxRedirects: 0 });
    expect(res.status(), 'must not be a server error').toBeLessThan(500);
    expect(res.headers().location ?? '', 'must not lead to an order page').not.toMatch(/\/order\//);
  });

  test('the localhost-only sign-in code reader is closed', async ({ request, baseURL }) => {
    test.skip(/localhost|127\.0\.0\.1/.test(baseURL!));
    const res = await request.get('/api/auth/dev-code?email=someone@example.com');
    expect(res.status()).toBe(404);
  });

  test('the sign-in code endpoint rejects garbage without sending anything', async ({ request }) => {
    const res = await request.post('/api/auth/request-code', { data: {} });
    expect(res.status()).toBe(400);
  });

  for (const path of [
    '/order/forged-token',
    '/order/eyJyaWQiOiJ4In0.forged',
    '/speaker/forged-token',
    '/review/forged-token',
    '/review/forged-token/sub1',
    '/exhibitor/forged-token',
    '/exhibitor/forged-token/leads.csv',
    '/consent/forged-token',
    '/u/forged-token',
    '/submit/token/forged-token',
  ]) {
    test(`a forged token is refused: ${path}`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
      // In particular, the exhibitor leads export must not hand over a CSV.
      expect(res.headers()['content-type'] ?? '').not.toMatch(/csv/);
    });
  }

  test('a forged unsubscribe link does not succeed', async ({ request }) => {
    const res = await request.post('/api/unsubscribe/forged-token');
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('a bad campaign link does not error', async ({ request }) => {
    const res = await request.get('/r/not-a-code', { maxRedirects: 0 });
    expect(res.status()).toBeLessThan(500);
  });

  test('HTTPS is enforced with HSTS and nosniff', async ({ request, baseURL }) => {
    test.skip(!baseURL!.startsWith('https://'));
    const res = await request.get('/');
    expect(res.headers()['strict-transport-security'] ?? '').toMatch(/max-age=\d{7,}/);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  for (const path of MONEY_ROUTES) {
    test(`no secrets in the JavaScript sent with ${path}`, async ({ page }) => {
      const scripts: string[] = [];
      page.on('response', async (res) => {
        if (res.request().resourceType() === 'script' && res.ok()) {
          scripts.push(await res.text().catch(() => ''));
        }
      });
      await page.goto(path, { waitUntil: 'networkidle' });
      const all = scripts.join('\n');
      expect(all.length).toBeGreaterThan(1000);
      for (const re of LEAKS) expect(all, `JS bundle contains ${re}`).not.toMatch(re);
    });
  }

  // The money routes above load their JS in a browser. This one fetches every
  // script any page links to, so a chunk only one page uses is covered too.
  // The leak scan in publish-web.sh goes further and checks every file on disk,
  // including lazy chunks no page links to; this is the check that needs no SSH.
  test('no secrets in any script linked from any page', async ({ request }) => {
    test.setTimeout(120_000);
    const seen = new Set<string>();
    for (const route of ROUTES) {
      const res = await request.get(route.path);
      if (!res.ok()) continue;
      for (const [, src] of (await res.text()).matchAll(/<script[^>]+src="([^"]+)"/g)) seen.add(src);
    }
    expect(seen.size, 'found no scripts at all').toBeGreaterThan(5);
    for (const src of seen) {
      const js = await (await request.get(src)).text();
      for (const re of LEAKS) expect(js, `${src} contains ${re}`).not.toMatch(re);
      // Server-side variable names in browser code mean a server module was
      // bundled for the client, which is how a key leaks on the next deploy.
      expect(js, `${src} names a server-only secret`).not.toMatch(
        /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|WEB_ORDER_SECRET|RESEND_API_KEY|CONSOLE_PASSPHRASE|CONSOLE_SESSION_SECRET/,
      );
    }
  });
});
