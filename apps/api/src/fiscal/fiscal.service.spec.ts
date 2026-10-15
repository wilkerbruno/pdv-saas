import { BadRequestException, ConflictException } from '@nestjs/common';
import { decrypt } from '../common/crypto';
import { FiscalService } from './fiscal.service';

// Banco em memória com só o necessário para o FiscalService.
function setup(opts: { planFiscal?: boolean; fiscalEnabled?: boolean; ncm?: string | null; saleStatus?: string } = {}) {
  const db = {
    tenant: { id: 't1', fiscalEnabled: opts.fiscalEnabled ?? true, plan: { fiscalEnabled: opts.planFiscal ?? true } } as any,
    settings: null as any,
    docs: [] as any[],
    product: { unit: 'UN', ncm: opts.ncm === undefined ? '62044200' : opts.ncm, cfop: null, taxCode: null, origin: 0 },
  };
  if (opts.fiscalEnabled !== false) {
    db.settings = { tenantId: 't1', provider: 'FOCUSNFE', environment: 'HOMOLOGACAO', cnpj: '11222333000181', defaultCfop: '5102', defaultTaxCode: '102', autoEmit: true, providerToken: null };
  }
  const sale = () => ({
    id: 'sale1', tenantId: 't1', number: 5, status: opts.saleStatus ?? 'PAID', discountCents: 0, consumerDocument: null,
    items: [{ variantId: 'v1', description: 'Camiseta (M)', qty: 1, unitPriceCents: 7900, discountCents: 0, variant: { sku: 'CAM-M', barcode: null, product: db.product } }],
    payments: [{ status: 'APPROVED', method: 'PIX', principalCents: 7900, brand: null }],
  });
  const prisma: any = {
    tenant: {
      findUnique: async ({ include }: any) => (include?.plan ? db.tenant : { fiscalEnabled: db.tenant.fiscalEnabled }),
      update: async ({ data }: any) => Object.assign(db.tenant, data),
    },
    fiscalSettings: {
      findUnique: async () => db.settings,
      upsert: async ({ update, create }: any) => (db.settings = db.settings ? Object.assign(db.settings, update) : { ...create }),
    },
    sale: { findFirst: async () => sale() },
    fiscalDocument: {
      findFirst: async () => db.docs[0] ?? null,
      create: async ({ data }: any) => { const d = { id: 'd1', ...data }; db.docs.push(d); return d; },
      update: async ({ where, data }: any) => Object.assign(db.docs.find((d) => d.id === where.id), data),
    },
  };
  const focus: any = {
    emitNfce: jest.fn(async () => ({ status: 'AUTHORIZED', number: '12', series: '1', danfeUrl: 'https://d' })),
    getNfce: jest.fn(async () => ({ status: 'AUTHORIZED', number: '12' })),
    cancelNfce: jest.fn(async () => ({ canceled: true, cancelXmlUrl: 'https://c' })),
  };
  // token criptografado do provedor
  process.env.ENCRYPTION_KEY = 'd'.repeat(64);
  const { encrypt } = require('../common/crypto');
  if (db.settings) db.settings.providerToken = encrypt('token-da-empresa');
  return { svc: new FiscalService(prisma, focus), db, focus };
}

describe('FiscalService.emit', () => {
  it('emite, guarda o resultado e é idempotente', async () => {
    const { svc, focus, db } = setup();
    const doc = await svc.emit('t1', 'sale1');
    expect(doc).toMatchObject({ status: 'AUTHORIZED', number: '12', ref: 'sale1', environment: 'HOMOLOGACAO' });
    expect(focus.emitNfce).toHaveBeenCalledTimes(1);
    const [creds, ref, payload] = focus.emitNfce.mock.calls[0];
    expect(creds).toEqual({ token: 'token-da-empresa', environment: 'HOMOLOGACAO' });
    expect(ref).toBe('sale1');
    expect(payload.items[0].codigo_ncm).toBe('62044200');
    expect(payload.formas_pagamento[0].forma_pagamento).toBe('17');

    await svc.emit('t1', 'sale1'); // segunda chamada não reenvia
    expect(focus.emitNfce).toHaveBeenCalledTimes(1);
    expect(db.docs).toHaveLength(1);
  });

  it('produto sem NCM: recusa localmente sem chamar o provedor e libera o reenvio após corrigir', async () => {
    const { svc, focus, db } = setup({ ncm: null });
    const doc = await svc.emit('t1', 'sale1');
    expect(doc.status).toBe('REJECTED');
    expect(doc.message).toMatch(/cadastre o NCM/);
    expect(focus.emitNfce).not.toHaveBeenCalled();

    db.product.ncm = '62044200';
    const again = await svc.emit('t1', 'sale1');
    expect(again.status).toBe('AUTHORIZED');
    expect(db.docs).toHaveLength(1); // mesmo registro, mesma referência
  });

  it('falha de comunicação vira ERROR e o reenvio funciona', async () => {
    const { svc, focus } = setup();
    focus.emitNfce.mockRejectedValueOnce(new Error('timeout'));
    const failed = await svc.emit('t1', 'sale1');
    expect(failed.status).toBe('ERROR');
    expect(failed.message).toMatch(/timeout/);
    expect((await svc.emit('t1', 'sale1')).status).toBe('AUTHORIZED');
    expect(focus.emitNfce).toHaveBeenCalledTimes(2);
    expect(focus.emitNfce.mock.calls[1][1]).toBe('sale1'); // mesma ref
  });

  it('rejeição da SEFAZ fica registrada para correção', async () => {
    const { svc, focus } = setup();
    focus.emitNfce.mockResolvedValueOnce({ status: 'REJECTED', sefazStatus: '704', message: 'data atrasada' });
    expect(await svc.emit('t1', 'sale1')).toMatchObject({ status: 'REJECTED', sefazStatus: '704', message: 'data atrasada' });
  });

  it('exige fiscal ativado e venda paga', async () => {
    await expect(setup({ fiscalEnabled: false }).svc.emit('t1', 'sale1')).rejects.toThrow(ConflictException);
    await expect(setup({ saleStatus: 'PENDING' }).svc.emit('t1', 'sale1')).rejects.toThrow(/venda paga/);
  });

  it('autoEmit nunca lança, mesmo com o provedor fora do ar, e respeita o interruptor', async () => {
    const off = setup({ fiscalEnabled: false });
    await expect(off.svc.autoEmit('t1', 'sale1')).resolves.toBeUndefined();
    expect(off.focus.emitNfce).not.toHaveBeenCalled();

    const { svc, focus } = setup();
    focus.emitNfce.mockRejectedValue(new Error('fora do ar'));
    await expect(svc.autoEmit('t1', 'sale1')).resolves.toBeUndefined();
  });
});

describe('FiscalService.cancel / refresh', () => {
  it('cancela nota autorizada com justificativa válida', async () => {
    const { svc, focus } = setup();
    await svc.emit('t1', 'sale1');
    await expect(svc.cancel('t1', 'sale1', 'curta')).rejects.toThrow(BadRequestException);
    const doc = await svc.cancel('t1', 'sale1', 'Cliente desistiu da compra');
    expect(doc).toMatchObject({ status: 'CANCELED', cancelReason: 'Cliente desistiu da compra', cancelXmlUrl: 'https://c' });
    expect(focus.cancelNfce).toHaveBeenCalledWith(expect.anything(), 'sale1', 'Cliente desistiu da compra');
  });

  it('recusa da SEFAZ (ex.: fora do prazo) mantém a nota autorizada', async () => {
    const { svc, focus, db } = setup();
    await svc.emit('t1', 'sale1');
    focus.cancelNfce.mockResolvedValueOnce({ canceled: false, message: 'Prazo de cancelamento excedido' });
    await expect(svc.cancel('t1', 'sale1', 'Cliente desistiu da compra')).rejects.toThrow(/Prazo/);
    expect(db.docs[0].status).toBe('AUTHORIZED');
  });

  it('refresh sem nota no provedor libera o reenvio', async () => {
    const { svc, focus } = setup();
    focus.emitNfce.mockResolvedValueOnce({ status: 'PROCESSING' });
    await svc.emit('t1', 'sale1');
    focus.getNfce.mockResolvedValueOnce(null);
    const doc = await svc.refresh('t1', 'sale1');
    expect(doc.status).toBe('ERROR');
    expect((await svc.emit('t1', 'sale1')).status).toBe('AUTHORIZED');
  });
});

describe('FiscalService.updateSettings', () => {
  it('plano sem fiscal não ativa; token é guardado criptografado e nunca devolvido', async () => {
    const noPlan = setup({ planFiscal: false, fiscalEnabled: false });
    await expect(noPlan.svc.updateSettings('t1', { enabled: true, cnpj: '11222333000181', providerToken: 'abc' })).rejects.toThrow(/plano/);

    const { svc, db } = setup({ fiscalEnabled: false });
    await expect(svc.updateSettings('t1', { enabled: true })).rejects.toThrow(/CNPJ e o token/);
    const view: any = await svc.updateSettings('t1', { cnpj: '11.222.333/0001-81', providerToken: 'segredo', environment: 'PRODUCAO', enabled: true });
    expect(view).toMatchObject({ enabled: true, cnpj: '11222333000181', hasToken: true, environment: 'PRODUCAO' });
    expect(JSON.stringify(view)).not.toContain('segredo');
    expect(db.settings.providerToken).not.toContain('segredo');
    expect(decrypt(db.settings.providerToken)).toBe('segredo');
  });

  it('valida CNPJ e CSOSN; token vazio mantém o atual', async () => {
    const { svc, db } = setup();
    await expect(svc.updateSettings('t1', { cnpj: '11222333000182' })).rejects.toThrow(/CNPJ inválido/);
    await expect(svc.updateSettings('t1', { defaultTaxCode: '500' })).rejects.toThrow(/CSOSN/);
    const before = db.settings.providerToken;
    await svc.updateSettings('t1', { providerToken: '', autoEmit: false });
    expect(db.settings.providerToken).toBe(before);
    expect(db.settings.autoEmit).toBe(false);
  });
});
