import { isValidCnpj, isValidConsumerDocument, isValidCpf } from './documents';
import { allocateProportionally, brandCode, buildNfcePayload, formatWithOffset, NfceInput, paymentCode, validateNfceInput } from './nfce-builder';

const item = (over: Partial<NfceInput['items'][number]> = {}) => ({
  variantId: 'v1', code: 'CAM-M', description: 'Camiseta (M)', qty: 1, unitPriceCents: 7900, discountCents: 0,
  unit: 'UN', ncm: '62044200', cfop: null, taxCode: null, origin: 0, ...over,
});
const input = (over: Partial<NfceInput> = {}): NfceInput => ({
  cnpj: '11.222.333/0001-81', defaultCfop: '5102', defaultTaxCode: '102',
  items: [item()], saleDiscountCents: 0,
  payments: [{ method: 'CREDIT', principalCents: 7900, brand: 'Visa' }],
  consumerDocument: null, issuedAt: new Date('2026-10-15T03:00:00Z'), ...over,
});

describe('documentos', () => {
  it('valida CPF e CNPJ pelos dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidConsumerDocument('52998224725')).toBe(true);
    expect(isValidConsumerDocument('123')).toBe(false);
  });
});

describe('rateio de desconto', () => {
  it('a soma é exatamente o total (maior resto)', () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(5, [3, 0, 2]).reduce((a, b) => a + b, 0)).toBe(5);
    expect(allocateProportionally(5, [3, 0, 2])[1]).toBe(0);
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportionally(10, [0, 0])).toEqual([0, 0]);
    const w = [1999, 5001, 2999];
    expect(allocateProportionally(777, w).reduce((a, b) => a + b, 0)).toBe(777);
  });
});

describe('códigos', () => {
  it('forma de pagamento e bandeira', () => {
    expect(['CASH', 'CREDIT', 'DEBIT', 'STORE_CREDIT', 'PIX'].map((m) => paymentCode(m as any))).toEqual(['01', '03', '04', '05', '17']);
    expect([brandCode('Visa'), brandCode('MASTERCARD'), brandCode('American Express'), brandCode('elo'), brandCode(null)]).toEqual(['01', '02', '03', '99', '99']);
  });
  it('data com fuso explícito', () => {
    expect(formatWithOffset(new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-15T00:00:00-03:00');
  });
});

describe('payload da NFC-e (layout Focus NFe)', () => {
  it('reproduz a estrutura do exemplo da documentação', () => {
    const p: any = buildNfcePayload(input());
    expect(p).toMatchObject({
      cnpj_emitente: '11222333000181', data_emissao: '2026-10-15T00:00:00-03:00', natureza_operacao: 'VENDA AO CONSUMIDOR',
      presenca_comprador: '1', modalidade_frete: '9', local_destino: '1',
    });
    expect(p.items).toEqual([{
      numero_item: '1', codigo_produto: 'CAM-M', descricao: 'Camiseta (M)', codigo_ncm: '62044200', cfop: '5102',
      unidade_comercial: 'UN', quantidade_comercial: 1, valor_unitario_comercial: 79, unidade_tributavel: 'UN',
      quantidade_tributavel: 1, valor_unitario_tributavel: 79, valor_bruto: 79, valor_desconto: 0,
      icms_origem: '0', icms_situacao_tributaria: '102',
    }]);
    expect(p.formas_pagamento).toEqual([{ forma_pagamento: '03', valor_pagamento: 79, tipo_integracao: '2', bandeira_operadora: '01' }]);
    expect(p.cpf_destinatario).toBeUndefined();
  });

  it('desconto da venda é rateado e valores batem: Σ(bruto − desconto) = Σ pagamentos', () => {
    const inp = input({
      items: [item({ unitPriceCents: 3333 }), item({ variantId: 'v2', code: 'B', unitPriceCents: 6667, qty: 2, discountCents: 100 })],
      saleDiscountCents: 1000,
      payments: [{ method: 'PIX', principalCents: 3333 + 13334 - 100 - 1000 }],
    });
    expect(validateNfceInput(inp)).toEqual([]);
    const p: any = buildNfcePayload(inp);
    const net = p.items.reduce((s: number, i: any) => s + Math.round(i.valor_bruto * 100) - Math.round(i.valor_desconto * 100), 0);
    expect(net).toBe(Math.round(p.formas_pagamento[0].valor_pagamento * 100));
    expect(p.formas_pagamento[0].forma_pagamento).toBe('17');
    expect(p.formas_pagamento[0].tipo_integracao).toBeUndefined(); // só cartão
  });

  it('CPF e CNPJ do consumidor', () => {
    const cpf: any = buildNfcePayload(input({ consumerDocument: '529.982.247-25' }));
    expect(cpf).toMatchObject({ cpf_destinatario: '52998224725', indicador_inscricao_estadual_destinatario: '9' });
    const cnpj: any = buildNfcePayload(input({ consumerDocument: '11222333000181' }));
    expect(cnpj.cnpj_destinatario).toBe('11222333000181');
  });

  it('usa CFOP/CSOSN do produto quando existem e descrição limitada a 120 caracteres', () => {
    const p: any = buildNfcePayload(input({ items: [item({ cfop: '5102', taxCode: '400', description: 'x'.repeat(200) })] }));
    expect(p.items[0].icms_situacao_tributaria).toBe('400');
    expect(p.items[0].descricao).toHaveLength(120);
  });
});

describe('validação antes de emitir', () => {
  it('aceita um caso correto', () => expect(validateNfceInput(input())).toEqual([]));

  it('aponta cada problema com mensagem acionável', () => {
    const problems = validateNfceInput(input({
      cnpj: '11222333000182', consumerDocument: '123',
      items: [item({ ncm: null }), item({ variantId: 'v2', description: 'Vaso', ncm: '69131000', taxCode: '500' })],
      payments: [{ method: 'CASH', principalCents: 1 }],
    }));
    expect(problems.join('\n')).toMatch(/CNPJ do emitente inválido/);
    expect(problems.join('\n')).toMatch(/"Camiseta \(M\)": cadastre o NCM/);
    expect(problems.join('\n')).toMatch(/"Vaso": CSOSN 500 ainda não é suportado/);
    expect(problems.join('\n')).toMatch(/CPF\/CNPJ do consumidor inválido/);
    expect(problems.join('\n')).toMatch(/Soma dos pagamentos/);
  });
});
