/** Referência enviada ao Mercado Pago: "mensalidade:<invoiceId>". */
export const INVOICE_REF_PREFIX = 'mensalidade:';

export const invoiceRef = (invoiceId: string) => `${INVOICE_REF_PREFIX}${invoiceId}`;

export function parseInvoiceRef(ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(INVOICE_REF_PREFIX)) return null;
  const id = ref.slice(INVOICE_REF_PREFIX.length);
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/** Converte transaction_amount (reais, número ou string) em centavos, sem erro de ponto flutuante. */
export function amountToCents(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
