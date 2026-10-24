// A stand-in for the few Stripe endpoints `raiseInvoiceWith` calls, so the
// invoice form can be driven end to end without a Stripe account. Records every
// object it makes and every deletion, and can be told to refuse finalization
// the way live Stripe did before the billing address existed.
//
//   POST /__mode   {"finalize":"ok"|"tax-fail"}   switch behaviour
//   GET  /__state                                  customers + invoices + calls
//   POST /__reset                                  forget everything
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_STRIPE_PORT ?? 12111);
const BASE = `http://127.0.0.1:${PORT}`;

let state;
let mode;
function reset() {
  state = { customers: {}, invoices: {}, items: [], calls: [] };
  mode = { finalize: 'ok' };
}
reset();
let seq = 0;
const id = (p) => `${p}_fake${++seq}`;

/** Stripe's bracketed form encoding, e.g. `address[line1]=x`, into an object. */
function parseForm(body) {
  const out = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const parts = key.split(/\[|\]\[|\]/).filter(Boolean);
    let at = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) at[p] = value;
      else at = at[p] ??= {};
    });
  }
  return out;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function invoiceView(inv) {
  const total = state.items.filter((i) => i.invoice === inv.id).reduce((s, i) => s + Number(i.amount), 0);
  return {
    object: 'invoice',
    ...inv,
    total,
    hosted_invoice_url: inv.status === 'draft' ? null : `${BASE}/hosted/${inv.id}`,
    invoice_pdf: inv.status === 'draft' ? null : `${BASE}/hosted/${inv.id}.pdf`,
    due_date: inv.status === 'draft' ? null : Math.floor(Date.now() / 1000) + Number(inv.days_until_due ?? 30) * 86400,
  };
}

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, BASE);
  const p = url.pathname;
  const m = req.method;

  if (p === '/__mode' && m === 'POST') { Object.assign(mode, JSON.parse(body || '{}')); return send(res, 200, mode); }
  if (p === '/__reset' && m === 'POST') { reset(); return send(res, 200, {}); }
  if (p === '/__state') return send(res, 200, state);
  if (p.startsWith('/hosted/')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><title>Fake hosted invoice</title><h1>Fake hosted invoice ${p.slice(8)}</h1>`);
  }

  state.calls.push(`${m} ${p}`);
  const form = parseForm(body);
  let r;

  if (m === 'GET' && p === '/v1/customers') {
    const email = url.searchParams.get('email');
    const data = Object.values(state.customers).filter((c) => c.email === email).slice(0, 1);
    return send(res, 200, { object: 'list', data, has_more: false, url: '/v1/customers' });
  }
  if (m === 'POST' && p === '/v1/customers') {
    const c = { id: id('cus'), object: 'customer', email: form.email, name: form.name, address: form.address, metadata: form.metadata };
    state.customers[c.id] = c;
    return send(res, 200, c);
  }
  if ((r = p.match(/^\/v1\/customers\/([^/]+)$/))) {
    const c = state.customers[r[1]];
    if (!c) return send(res, 404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such customer' } });
    if (m === 'DELETE') { delete state.customers[r[1]]; return send(res, 200, { id: r[1], object: 'customer', deleted: true }); }
    Object.assign(c, form.address ? { address: form.address } : {});
    return send(res, 200, c);
  }
  if (m === 'POST' && p === '/v1/invoices') {
    if (!state.customers[form.customer]) return send(res, 400, { error: { type: 'invalid_request_error', message: 'No such customer' } });
    const inv = { id: id('in'), customer: form.customer, status: 'draft', days_until_due: form.days_until_due, custom_fields: form.custom_fields, metadata: form.metadata, automatic_tax: form.automatic_tax };
    state.invoices[inv.id] = inv;
    return send(res, 200, invoiceView(inv));
  }
  if (m === 'POST' && p === '/v1/invoiceitems') {
    const item = { id: id('ii'), object: 'invoiceitem', ...form };
    state.items.push(item);
    return send(res, 200, item);
  }
  if ((r = p.match(/^\/v1\/invoices\/([^/]+)(\/finalize|\/send)?$/))) {
    const inv = state.invoices[r[1]];
    if (!inv) return send(res, 404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such invoice' } });
    if (m === 'DELETE') {
      if (inv.status !== 'draft') return send(res, 400, { error: { type: 'invalid_request_error', message: 'Only drafts can be deleted' } });
      delete state.invoices[r[1]];
      state.items = state.items.filter((i) => i.invoice !== r[1]);
      return send(res, 200, { id: r[1], object: 'invoice', deleted: true });
    }
    if (r[2] === '/finalize') {
      const c = state.customers[inv.customer];
      if (mode.finalize === 'tax-fail' || !c?.address?.country) {
        return send(res, 400, {
          error: {
            type: 'invalid_request_error',
            code: 'customer_tax_location_invalid',
            message: 'Enough customer location information must be provided to accurately determine tax rates for the customer.',
          },
        });
      }
      inv.status = 'open';
    }
    if (r[2] === '/send') inv.sent = true;
    return send(res, 200, invoiceView(inv));
  }
  send(res, 404, { error: { type: 'invalid_request_error', message: `fake-stripe has no ${m} ${p}` } });
}).listen(PORT, '127.0.0.1', () => console.log(`[fake-stripe] listening on ${BASE}`));
