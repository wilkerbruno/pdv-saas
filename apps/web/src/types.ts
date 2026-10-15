export type Method = 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT' | 'STORE_CREDIT';
export type Provider = 'MANUAL' | 'MERCADOPAGO_POINT' | 'MERCADOPAGO_PIX' | 'PAGARME_STONE';

export interface Variant {
  id: string;
  priceCents: number;
  stockQty: number;
  barcode?: string | null;
  sku?: string | null;
  attributes?: Record<string, string> | null;
  product: { id: string; name: string };
}
export interface CartLine {
  variant: Variant;
  qty: number;
}
export interface InstallmentOption {
  installments: number;
  hasInterest: boolean;
  interestCents: number;
  totalCents: number;
  installmentValues: number[];
}
export interface PaymentDraft {
  method: Method;
  provider: Provider;
  installments: number;
  amountCents: number;
  interestCents: number;
  deviceId?: string;
}
export interface PaymentRow {
  id: string;
  method: Method;
  provider: Provider;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELED';
  installments: number;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  pixCopyPaste?: string | null;
  pixQrBase64?: string | null;
}
export interface Sale {
  id: string;
  number: number;
  status: 'PENDING' | 'PAID' | 'CANCELED';
  subtotalCents: number;
  discountCents: number;
  interestCents: number;
  totalCents: number;
  payments: PaymentRow[];
}
export interface Me {
  user: { id: string; name: string; email: string; role: 'OWNER' | 'MANAGER' | 'CASHIER'; platformAdmin?: boolean };
  tenant: {
    id: string;
    name: string;
    status: string;
    access: 'FULL' | 'READ_ONLY' | 'BLOCKED';
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    fiscalEnabled?: boolean;
    plan: { code: string; name: string };
    stores: { id: string; name: string }[];
  };
}

export const METHOD_LABEL: Record<Method, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
  STORE_CREDIT: 'Vale-troca',
};
export const describeVariant = (v: Variant) => {
  const attrs = v.attributes ? Object.values(v.attributes).join(' / ') : '';
  return attrs ? `${v.product.name} (${attrs})` : v.product.name;
};

export interface FiscalDoc {
  status: null | 'PROCESSING' | 'AUTHORIZED' | 'REJECTED' | 'DENIED' | 'CANCELED' | 'ERROR';
  number?: string | null;
  series?: string | null;
  danfeUrl?: string | null;
  message?: string | null;
}
