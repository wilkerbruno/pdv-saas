import { BillingService } from './billing.service';
import { amountToCents, invoiceRef, parseInvoiceRef } from './billing-pix';

function makeFake() {
  const invoices: any[] = [];
  const tenant: any = { id: 't1', name: 'Loja', email: 'a@b.com', status: 'SUSPENDED', currentPeriodEnd: null, plan: { code: 'basic', name: 'Básico', priceCents: 4990 } };
  const prisma: any = {
    tenant: {
      findUnique: async () => tenant,
      update: async ({ data }: any) => Object.assign(tenant, data),
    },
    billingInvoice: {
      findFirst: async ({ where }: any) => invoices.find((i) => (!where.id || i.id === where.id) && (!where.tenantId || i.tenantId === where.tenantId) && (!where.status || i.status === where.status)) ?? null,
      findUnique: async ({ where }: any) => invoices.find((i) => i.id === where.id) ?? null,
      create: async ({ data }: any) => { const r = { id: 'inv_' + (invoices.length + 1) + '_abcdef', status: 'PENDING', externalId: null, pixCopyPaste: null, pixQrBase64: null, ...data }; invoices.push(r); return r; },
      update: async ({ where, data }: any) => Object.assign(invoices.find((i) => i.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const r = invoices.find((i) => i.id === where.id && i.status !== 'PAID');
        if (!r) return { count: 0 };
        Object.assign(r, data); return { count: 1 };
      },
    },
  };
  return { prisma, invoices, tenant };
}

describe('billing-pix helpers', () => {
  it('ref ida e volta, rejeita lixo', () => {
    expect(parseInvoiceRef(invoiceRef('abcdef123456'))).toBe('abcdef123456');
    expect(parseInvoiceRef('venda-1-x')).toBeNull();
    expect(parseInvoiceRef('mensalidade:../x')).toBeNull();
    expect(parseInvoiceRef(undefined)).toBeNull();
  });
  it('valor em centavos', () => {
    expect(amountToCents(49.9)).toBe(4990);
    expect(amountToCents('19.99')).toBe(1999);
    expect(amountToCents(-1)).toBeNull();
    expect(amountToCents('x')).toBeNull();
  });
});

describe('BillingService PIX', () => {
  const realFetch = global.fetch;
  let mp: { calls: any[]; payment: any };
  beforeEach(() => {
    process.env.PLATFORM_MP_ACCESS_TOKEN = 'APP_USR-platform';
    mp = { calls: [], payment: null };
    (global as any).fetch = async (url: string, init: any) => {
      mp.calls.push({ url, init });
      const body = init?.method === 'POST'
        ? { id: 987654, status: 'pending', point_of_interaction: { transaction_data: { qr_code: '000201pix', qr_code_base64: 'QR' } } }
        : mp.payment;
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
  });
  afterEach(() => { global.fetch = realFetch; delete process.env.PLATFORM_MP_ACCESS_TOKEN; });

  it('checkout cria a cobrança e reaproveita a pendente', async () => {
    const { prisma, invoices } = makeFake();
    const svc = new BillingService(prisma);
    const a = await svc.checkout('t1');
    expect(a.copyPaste).toBe('000201pix');
    expect(a.amountCents).toBe(4990);
    const post = mp.calls[0];
    expect(JSON.parse(post.init.body).transaction_amount).toBe(49.9);
    expect(JSON.parse(post.init.body).external_reference).toBe(invoiceRef(a.invoiceId));
    const b = await svc.checkout('t1');
    expect(b.invoiceId).toBe(a.invoiceId);
    expect(invoices).toHaveLength(1);
    expect(mp.calls).toHaveLength(1);
  });

  it('checkout falha sem token da plataforma', async () => {
    delete process.env.PLATFORM_MP_ACCESS_TOKEN;
    const { prisma } = makeFake();
    await expect(new BillingService(prisma).checkout('t1')).rejects.toThrow(/não configurada/);
  });

  it('pagamento aprovado libera a conta uma única vez', async () => {
    const { prisma, tenant } = makeFake();
    const svc = new BillingService(prisma);
    const inv = await svc.checkout('t1');
    mp.payment = { id: 987654, status: 'approved', transaction_amount: 49.9, external_reference: invoiceRef(inv.invoiceId) };
    const r1 = await svc.handleNotification('987654');
    expect(r1).toMatchObject({ paid: true });
    expect(tenant.status).toBe('ACTIVE');
    const end1 = tenant.currentPeriodEnd.getTime();
    const r2 = await svc.handleNotification('987654');
    expect(r2).toMatchObject({ duplicate: true });
    expect(tenant.currentPeriodEnd.getTime()).toBe(end1); // não soma de novo
  });

  it('não libera se pendente, valor menor ou referência alheia', async () => {
    const { prisma, tenant } = makeFake();
    const svc = new BillingService(prisma);
    const inv = await svc.checkout('t1');
    mp.payment = { id: 1, status: 'pending', transaction_amount: 49.9, external_reference: invoiceRef(inv.invoiceId) };
    expect(await svc.handleNotification('987654')).toMatchObject({ status: 'pending' });
    mp.payment = { id: 1, status: 'approved', transaction_amount: 1, external_reference: invoiceRef(inv.invoiceId) };
    expect(await svc.handleNotification('987654')).toMatchObject({ underpaid: true });
    mp.payment = { id: 1, status: 'approved', transaction_amount: 49.9, external_reference: 'venda-1-abc' };
    expect(await svc.handleNotification('987654')).toMatchObject({ handled: false });
    expect(tenant.status).toBe('SUSPENDED');
  });
});
