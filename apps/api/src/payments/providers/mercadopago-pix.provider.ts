import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentMethodName } from '../../common/types';
import { centsToDecimalString } from '../../common/money';
import { httpJson } from './http';
import { mapMpPaymentStatus } from './mp-status';
import { ChargeRequest, ChargeResult, PaymentProvider, ProviderCredentials, StatusResult } from './types';

const BASE = 'https://api.mercadopago.com';

/** PIX dinâmico (QR Code) pela API de Payments do Mercado Pago. Funciona em qualquer loja, sem maquininha. */
@Injectable()
export class MercadoPagoPixProvider implements PaymentProvider {
  readonly code = 'MERCADOPAGO_PIX' as const;
  readonly requiresIntegration = true;

  supports(method: PaymentMethodName) {
    return method === 'PIX';
  }

  async charge(creds: ProviderCredentials | null, req: ChargeRequest): Promise<ChargeResult> {
    const c = this.need(creds);
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace('Z', '-00:00');
    const payment = await httpJson(`${BASE}/v1/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'X-Idempotency-Key': req.paymentId },
      body: {
        transaction_amount: Number(centsToDecimalString(req.amountCents)),
        description: req.description,
        payment_method_id: 'pix',
        external_reference: `venda-${req.saleNumber}-${req.paymentId}`,
        date_of_expiration: expires,
        payer: { email: req.payerEmail ?? 'cliente@pdv.local' },
        ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
      },
    });
    const tx = payment?.point_of_interaction?.transaction_data;
    return {
      status: mapMpPaymentStatus(payment?.status),
      externalId: String(payment?.id),
      pix: tx?.qr_code ? { copyPaste: tx.qr_code, qrBase64: tx.qr_code_base64 } : undefined,
      raw: { id: payment?.id, status: payment?.status },
    };
  }

  async fetchStatus(creds: ProviderCredentials | null, externalId: string): Promise<StatusResult> {
    const c = this.need(creds);
    const p = await httpJson(`${BASE}/v1/payments/${encodeURIComponent(externalId)}`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
    });
    return { status: mapMpPaymentStatus(p?.status), raw: { id: p?.id, status: p?.status } };
  }

  async cancel(creds: ProviderCredentials | null, externalId: string): Promise<void> {
    const c = this.need(creds);
    await httpJson(`${BASE}/v1/payments/${encodeURIComponent(externalId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${c.accessToken}` },
      body: { status: 'cancelled' },
    });
  }

  private need(creds: ProviderCredentials | null): ProviderCredentials {
    if (!creds) throw new ServiceUnavailableException('Mercado Pago não conectado');
    return creds;
  }
}
