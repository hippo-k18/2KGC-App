import { describe, expect, it, vi } from 'vitest';
import {
  InvoiceError,
  addressProblemMessage,
  raiseInvoiceWith,
  validateBillingAddress,
  type InvoiceRequest,
  type InvoiceStripe,
} from './invoice-core';

const US = {
  line1: '1065 Avenue of the Americas',
  line2: '',
  city: 'New York',
  state: 'NY',
  postalCode: '10018',
  country: 'US',
};

describe('validateBillingAddress', () => {
  it('accepts a full US address and tidies it', () => {
    const r = validateBillingAddress({ ...US, line1: '  1065  Avenue of the Americas ', country: 'us' });
    expect(r).toEqual({
      address: {
        line1: '1065 Avenue of the Americas',
        line2: undefined,
        city: 'New York',
        state: 'NY',
        postalCode: '10018',
        country: 'US',
      },
    });
  });

  it('accepts ZIP+4', () => {
    expect('address' in validateBillingAddress({ ...US, postalCode: '10018-1234' })).toBe(true);
  });

  it.each([
    [{ country: '' }, 'country'],
    [{ country: 'XX' }, 'country'],
    [{ line1: '' }, 'line1'],
    [{ city: ' ' }, 'city'],
    [{ state: '' }, 'state'],
    [{ postalCode: '' }, 'postal-missing'],
    [{ postalCode: '1001' }, 'postal-invalid'],
    [{ postalCode: 'ABCDE' }, 'postal-invalid'],
    [{ line2: 'x'.repeat(201) }, 'too-long'],
  ])('refuses %o as %s', (patch, problem) => {
    expect(validateBillingAddress({ ...US, ...patch })).toEqual({ problem });
  });

  it('checks and formats a Canadian postal code, and needs a province', () => {
    const ca = { ...US, city: 'Toronto', state: 'ON', country: 'CA' };
    expect(validateBillingAddress({ ...ca, postalCode: 'm5v3l9' })).toMatchObject({
      address: { postalCode: 'M5V 3L9' },
    });
    expect(validateBillingAddress({ ...ca, postalCode: '12345' })).toEqual({ problem: 'postal-invalid' });
    expect(validateBillingAddress({ ...ca, state: '', postalCode: 'M5V 3L9' })).toEqual({ problem: 'state' });
  });

  it('needs a postcode but no region elsewhere', () => {
    const gb = { line1: '1 Canada Square', city: 'London', country: 'GB', state: '', line2: '' };
    expect(validateBillingAddress({ ...gb, postalCode: '' })).toEqual({ problem: 'postal-missing' });
    expect(validateBillingAddress({ ...gb, postalCode: 'e14 5ab' })).toMatchObject({
      address: { postalCode: 'E14 5AB', state: undefined },
    });
    expect(validateBillingAddress({ ...gb, postalCode: 'E14<5AB>' })).toEqual({ problem: 'postal-invalid' });
  });

  it('lets a postcode be left out where the country has none', () => {
    const hk = { line1: '1 Harbour Road', city: 'Wan Chai', country: 'HK', state: '', line2: '', postalCode: '' };
    expect(validateBillingAddress(hk)).toMatchObject({ address: { country: 'HK', postalCode: undefined } });
  });

  it('has a message for every problem, with US wording for US addresses', () => {
    expect(addressProblemMessage('postal-missing', 'US')).toMatch(/ZIP/);
    expect(addressProblemMessage('postal-missing', 'GB')).toMatch(/postal code/);
    for (const p of ['line1', 'city', 'country', 'state', 'postal-missing', 'postal-invalid', 'too-long'] as const) {
      expect(addressProblemMessage(p, 'GB')).not.toMatch(/—/);
    }
  });
});

// ── raiseInvoiceWith ────────────────────────────────────────────────────────

const REQ: InvoiceRequest = {
  billingEmail: 'ap@acme.example',
  companyName: 'Acme Corporation',
  address: { line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10018', country: 'US' },
  seats: [
    { name: 'Ada', email: 'ada@acme.example', ticketType: 'Main Conference', ticketTypeId: 'main', priceCents: 59900 },
    { name: 'Grace', email: 'grace@acme.example', ticketType: 'Main Conference', ticketTypeId: 'main', priceCents: 59900 },
  ],
  currency: 'usd',
  purchaseOrder: 'PO-1',
  daysUntilDue: 30,
};

function taxError() {
  return Object.assign(new Error('Enough customer location information must be provided'), {
    code: 'customer_tax_location_invalid',
  });
}

function fakeStripe(opts: { existing?: boolean; finalize?: () => never; create?: () => never; update?: () => never } = {}) {
  const s = {
    customers: {
      list: vi.fn(async () => ({ data: opts.existing ? [{ id: 'cus_old' }] : [] })),
      create: vi.fn(async () => {
        if (opts.create) opts.create();
        return { id: 'cus_new' };
      }),
      update: vi.fn(async (id: string) => {
        if (opts.update) opts.update();
        return { id };
      }),
      del: vi.fn(async () => ({ deleted: true })),
    },
    invoices: {
      create: vi.fn(async () => ({ id: 'in_1' })),
      finalizeInvoice: vi.fn(async (id: string) => {
        if (opts.finalize) opts.finalize();
        return { id, status: 'open' };
      }),
      sendInvoice: vi.fn(async (id: string) => ({
        id,
        hosted_invoice_url: 'https://invoice.stripe.com/i/x',
        invoice_pdf: 'https://pay.stripe.com/x.pdf',
        total: 119800,
        due_date: 1_800_000_000,
      })),
      del: vi.fn(async () => ({ deleted: true })),
    },
    invoiceItems: { create: vi.fn(async () => ({ id: 'ii' })) },
  };
  return s as typeof s & InvoiceStripe;
}

describe('raiseInvoiceWith', () => {
  it('puts the address on a new customer, then raises, finalizes and sends', async () => {
    const s = fakeStripe();
    const r = await raiseInvoiceWith(s, REQ);
    expect(s.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ap@acme.example',
        name: 'Acme Corporation',
        address: { line1: '1 Main St', line2: '', city: 'New York', state: 'NY', postal_code: '10018', country: 'US' },
        tax: { validate_location: 'immediately' },
      }),
    );
    expect(s.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new', automatic_tax: { enabled: true }, days_until_due: 30 }),
    );
    expect(s.invoiceItems.create).toHaveBeenCalledTimes(2);
    expect(s.invoices.finalizeInvoice).toHaveBeenCalledWith('in_1');
    expect(r).toMatchObject({ invoiceId: 'in_1', totalCents: 119800, hostedInvoiceUrl: 'https://invoice.stripe.com/i/x' });
    expect(s.invoices.del).not.toHaveBeenCalled();
  });

  it('updates the address on an existing customer instead of creating one', async () => {
    const s = fakeStripe({ existing: true });
    await raiseInvoiceWith(s, REQ);
    expect(s.customers.create).not.toHaveBeenCalled();
    expect(s.customers.update).toHaveBeenCalledWith('cus_old', expect.objectContaining({ address: expect.any(Object) }));
    expect(s.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_old' }));
  });

  it('on a finalization failure deletes the draft and the customer it created', async () => {
    const s = fakeStripe({ finalize: () => { throw taxError(); } });
    const err = await raiseInvoiceWith(s, REQ).catch((e) => e);
    expect(err).toBeInstanceOf(InvoiceError);
    expect(err.kind).toBe('address');
    expect(s.invoices.del).toHaveBeenCalledWith('in_1');
    expect(s.customers.del).toHaveBeenCalledWith('cus_new');
    expect(s.invoices.sendInvoice).not.toHaveBeenCalled();
  });

  it('keeps a customer it did not create, but still deletes the draft', async () => {
    const s = fakeStripe({ existing: true, finalize: () => { throw new Error('boom'); } });
    const err = await raiseInvoiceWith(s, REQ).catch((e) => e);
    expect(err.kind).toBe('other');
    expect(s.invoices.del).toHaveBeenCalledWith('in_1');
    expect(s.customers.del).not.toHaveBeenCalled();
  });

  it('cleans up when a line item fails, before anything is finalized', async () => {
    const s = fakeStripe();
    s.invoiceItems.create.mockRejectedValueOnce(new Error('rate limited'));
    await expect(raiseInvoiceWith(s, REQ)).rejects.toBeInstanceOf(InvoiceError);
    expect(s.invoices.finalizeInvoice).not.toHaveBeenCalled();
    expect(s.invoices.del).toHaveBeenCalledWith('in_1');
    expect(s.customers.del).toHaveBeenCalledWith('cus_new');
  });

  it('a location Stripe refuses up front leaves nothing to clean', async () => {
    const s = fakeStripe({ create: () => { throw taxError(); } });
    const err = await raiseInvoiceWith(s, REQ).catch((e) => e);
    expect(err.kind).toBe('address');
    expect(s.invoices.create).not.toHaveBeenCalled();
    expect(s.invoices.del).not.toHaveBeenCalled();
    expect(s.customers.del).not.toHaveBeenCalled();
  });

  it('reports the original error even when the clean-up fails too', async () => {
    const s = fakeStripe({ finalize: () => { throw taxError(); } });
    s.invoices.del.mockRejectedValueOnce(new Error('cannot delete'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await raiseInvoiceWith(s, REQ).catch((e) => e);
    quiet.mockRestore();
    expect(err.kind).toBe('address');
    expect(s.customers.del).toHaveBeenCalledWith('cus_new');
  });

  it('a failed Stripe email after finalizing still returns the payable invoice', async () => {
    const s = fakeStripe();
    s.invoices.sendInvoice.mockRejectedValueOnce(new Error('email down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await raiseInvoiceWith(s, REQ);
    quiet.mockRestore();
    expect(r.invoiceId).toBe('in_1');
    expect(s.invoices.del).not.toHaveBeenCalled();
  });
});
