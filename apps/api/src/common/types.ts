// Tipos de domínio usados no código. Espelham os enums do schema.prisma, mas não dependem
// do client gerado, o que mantém a lógica de negócio testável de forma isolada.

export type RoleName = 'OWNER' | 'MANAGER' | 'CASHIER';
export type TenantStatusName = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
export type PaymentMethodName = 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT' | 'STORE_CREDIT';
export type ProviderCodeName = 'MANUAL' | 'MERCADOPAGO_POINT' | 'MERCADOPAGO_PIX' | 'PAGARME_STONE';
export type PaymentStatusName = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELED';

export interface AuthUser {
  userId: string;
  tenantId: string;
  role: RoleName;
}

export type FiscalStatusName = 'PROCESSING' | 'AUTHORIZED' | 'REJECTED' | 'DENIED' | 'CANCELED' | 'ERROR';
