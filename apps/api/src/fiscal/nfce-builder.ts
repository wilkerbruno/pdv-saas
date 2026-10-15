import { PaymentMethodName } from '../common/types';
import { isValidCnpj, isValidConsumerDocument, onlyDigits } from './documents';

// Montagem do corpo da NFC-e (layout do Focus NFe: POST /v2/nfce?ref=…).
// Regras e campos conferidos em https://doc.focusnfe.com.br/reference/emitir_nfce
// ⚠ Escopo: Simples Nacional com CSOSN sem campos adicionais. Outros regimes exigem mais campos de ICMS.

/** CSOSN suportados (não exigem base de cálculo/alíquota/ST no item). */
export const SUPPORTED_CSOSN = ['102', '103', '300', '400'] as const;

export interface FiscalItemInput {
  variantId: string;
  code: string; // sku || código de barras || id da variação
  description: string;
  qty: number;
  unitPriceCents: number;
  /** Desconto já dado no item. */
  discountCents: number;
  unit: string;
  ncm?: string | null;
  cfop?: string | null;
  taxCode?: string | null; // CSOSN
  origin: number;
}

export interface FiscalPaymentInput {
  method: PaymentMethodName;
  /** Valor que abate a venda (sem juros de parcelamento). */
  principalCents: number;
  brand?: string | null;
}

export interface NfceInput {
  cnpj: string;
  defaultCfop: string;
  defaultTaxCode: string;
  items: FiscalItemInput[];
  /** Desconto dado na venda inteira (rateado entre os itens). */
  saleDiscountCents: number;
  payments: FiscalPaymentInput[];
  consumerDocument?: string | null;
  issuedAt: Date;
}

/** Rateia `total` na proporção de `weights` (maior resto): a soma é exatamente `total`. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => {
      if (rest > 0 && weights[i] > 0) {
        out[i]++;
        rest--;
      }
    });
  return out;
}

/** Forma de pagamento da NF-e (tPag). PIX = 17 (Pagamento Instantâneo). */
export function paymentCode(m: PaymentMethodName): string {
  return { CASH: '01', CREDIT: '03', DEBIT: '04', STORE_CREDIT: '05', PIX: '17' }[m];
}

/** Bandeira (tBand): 01 Visa, 02 Mastercard, 03 Amex, 99 outras/desconhecida. */
export function brandCode(brand?: string | null): string {
  const b = (brand ?? '').toLowerCase();
  if (b.includes('visa')) return '01';
  if (b.includes('master')) return '02';
  if (b.includes('amex') || b.includes('american')) return '03';
  return '99';
}

/** Data/hora ISO com fuso (a SEFAZ exige offset), por padrão UTC−3. */
export function formatWithOffset(d: Date, offsetMinutes = -180): string {
  const local = new Date(d.getTime() + offsetMinutes * 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

const reais = (cents: number) => Number((cents / 100).toFixed(2));

/** Problemas que impediriam a emissão. Lista vazia = pode emitir. */
export function validateNfceInput(input: NfceInput): string[] {
  const problems: string[] = [];
  if (!isValidCnpj(input.cnpj)) problems.push('CNPJ do emitente inválido nas configurações fiscais');
  if (!/^\d{4}$/.test(input.defaultCfop)) problems.push('CFOP padrão inválido nas configurações fiscais');

  input.items.forEach((it) => {
    const tax = it.taxCode || input.defaultTaxCode;
    const cfop = it.cfop || input.defaultCfop;
    if (!/^\d{8}$/.test(onlyDigits(it.ncm))) problems.push(`"${it.description}": cadastre o NCM (8 dígitos)`);
    if (!/^\d{4}$/.test(cfop)) problems.push(`"${it.description}": CFOP inválido`);
    if (!(SUPPORTED_CSOSN as readonly string[]).includes(tax)) {
      problems.push(`"${it.description}": CSOSN ${tax} ainda não é suportado (use ${SUPPORTED_CSOSN.join(', ')})`);
    }
  });

  if (input.consumerDocument && !isValidConsumerDocument(input.consumerDocument)) {
    problems.push('CPF/CNPJ do consumidor inválido');
  }
  const itemsTotal = input.items.reduce((s, i) => s + i.unitPriceCents * i.qty - i.discountCents, 0);
  const due = itemsTotal - input.saleDiscountCents;
  const paid = input.payments.reduce((s, p) => s + p.principalCents, 0);
  if (due !== paid) problems.push(`Soma dos pagamentos (${paid}) difere do total da nota (${due})`);
  return problems;
}

/** Corpo da NFC-e. Chame `validateNfceInput` antes. */
export function buildNfcePayload(input: NfceInput, offsetMinutes = -180) {
  const base = input.items.map((i) => i.unitPriceCents * i.qty - i.discountCents);
  const share = allocateProportionally(input.saleDiscountCents, base);
  const doc = onlyDigits(input.consumerDocument);

  const payload: Record<string, unknown> = {
    cnpj_emitente: onlyDigits(input.cnpj),
    data_emissao: formatWithOffset(input.issuedAt, offsetMinutes),
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    presenca_comprador: '1', // presencial
    modalidade_frete: '9', // sem frete
    local_destino: '1', // operação interna
    items: input.items.map((it, idx) => ({
      numero_item: String(idx + 1),
      codigo_produto: it.code,
      descricao: it.description.slice(0, 120),
      codigo_ncm: onlyDigits(it.ncm),
      cfop: it.cfop || input.defaultCfop,
      unidade_comercial: it.unit,
      quantidade_comercial: it.qty,
      valor_unitario_comercial: reais(it.unitPriceCents),
      unidade_tributavel: it.unit,
      quantidade_tributavel: it.qty,
      valor_unitario_tributavel: reais(it.unitPriceCents),
      valor_bruto: reais(it.unitPriceCents * it.qty),
      valor_desconto: reais(it.discountCents + share[idx]),
      icms_origem: String(it.origin),
      icms_situacao_tributaria: it.taxCode || input.defaultTaxCode,
    })),
    formas_pagamento: input.payments.map((p) => {
      const card = p.method === 'CREDIT' || p.method === 'DEBIT';
      return {
        forma_pagamento: paymentCode(p.method),
        valor_pagamento: reais(p.principalCents),
        // Cartão sem integração direta da automação com a credenciadora (tpIntegra = 2).
        ...(card ? { tipo_integracao: '2', bandeira_operadora: brandCode(p.brand) } : {}),
      };
    }),
  };

  if (doc.length === 11) {
    payload.cpf_destinatario = doc;
    payload.indicador_inscricao_estadual_destinatario = '9';
  } else if (doc.length === 14) {
    payload.cnpj_destinatario = doc;
    payload.indicador_inscricao_estadual_destinatario = '9';
  }
  return payload;
}
