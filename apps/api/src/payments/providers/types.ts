import { PaymentMethodName, PaymentStatusName, ProviderCodeName } from '../../common/types';

/** Credenciais da loja para um adquirente (já descriptografadas). */
export interface ProviderCredentials {
  accessToken: string;
  accountRef?: string | null;
  deviceId?: string | null;
}

export interface ChargeRequest {
  paymentId: string; // usado como chave de idempotência
  saleNumber: number;
  description: string;
  method: PaymentMethodName;
  installments: number;
  /** Valor cobrado de fato: principal + juros de parcelamento. */
  amountCents: number;
  payerEmail?: string;
  /** Maquininha escolhida para esta cobrança (sobrepõe a padrão da loja). */
  deviceId?: string;
  /** URL pública para notificações, quando o gateway aceita uma por cobrança. */
  notificationUrl?: string;
}

export interface ChargeResult {
  status: PaymentStatusName;
  externalId?: string;
  pix?: { copyPaste: string; qrBase64?: string };
  raw?: unknown;
}

export interface StatusResult {
  status: PaymentStatusName;
  raw?: unknown;
}

/**
 * Contrato único para qualquer meio de pagamento. Para suportar uma nova adquirente,
 * basta implementar esta interface e registrá-la no PaymentProviderRegistry.
 */
export interface PaymentProvider {
  readonly code: ProviderCodeName;
  /** true quando exige credenciais da loja (PaymentIntegration). */
  readonly requiresIntegration: boolean;
  /** Combinações forma de pagamento × provider aceitas. */
  supports(method: PaymentMethodName): boolean;
  charge(creds: ProviderCredentials | null, req: ChargeRequest): Promise<ChargeResult>;
  fetchStatus(creds: ProviderCredentials | null, externalId: string): Promise<StatusResult>;
  cancel(creds: ProviderCredentials | null, externalId: string): Promise<void>;
}
