import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentMethodName } from '../../common/types';
import { centsToDecimalString } from '../../common/money';
import { httpJson } from './http';
import { mapMpOrderStatus } from './mp-status';
import { ChargeRequest, ChargeResult, PaymentProvider, ProviderCredentials, StatusResult } from './types';

const BASE = 'https://api.mercadopago.com';

/**
 * Mercado Pago Point via API de Orders (a API antiga de payment-intents está sendo descontinuada).
 * Fluxo: o PDV cria a order → a maquininha recebe a cobrança → o resultado chega por webhook.
 *
 * ⚠ Os campos do corpo abaixo seguem a documentação da API de Orders, mas ainda NÃO foram
 *   testados contra uma maquininha real. Valide na homologação do Mercado Pago
 *   (https://www.mercadopago.com.br/developers/pt/docs) antes de ir para produção.
 */
@Injectable()
export class MercadoPagoPointProvider implements PaymentProvider {
  readonly code = 'MERCADOPAGO_POINT' as const;
  readonly requiresIntegration = true;

  supports(method: PaymentMethodName) {
    return method === 'DEBIT' || method === 'CREDIT';
  }

  async charge(creds: ProviderCredentials | null, req: ChargeRequest): Promise<ChargeResult> {
    const c = this.need(creds);
    const terminalId = req.deviceId ?? c.deviceId;
    if (!terminalId) throw new ServiceUnavailableException('Nenhuma maquininha selecionada');

    const paymentMethod: Record<string, unknown> = {
      default_type: req.method === 'DEBIT' ? 'debit_card' : 'credit_card',
    };
    if (req.method === 'CREDIT') {
      paymentMethod.default_installments = req.installments;
      // Os juros já estão no valor cobrado (calculados pelo PDV), então o terminal não soma outros.
      paymentMethod.installments_cost = 'seller';
    }

    const order = await httpJson(`${BASE}/v1/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'X-Idempotency-Key': req.paymentId },
      body: {
        type: 'point',
        external_reference: `venda-${req.saleNumber}-${req.paymentId}`,
        description: req.description,
        transactions: { payments: [{ amount: centsToDecimalString(req.amountCents) }] },
        config: { point: { terminal_id: terminalId, print_on_terminal: 'no_ticket' }, payment_method: paymentMethod },
      },
    });

    return { status: mapMpOrderStatus(order?.status), externalId: String(order?.id), raw: order };
  }

  async fetchStatus(creds: ProviderCredentials | null, externalId: string): Promise<StatusResult> {
    const c = this.need(creds);
    const order = await httpJson(`${BASE}/v1/orders/${encodeURIComponent(externalId)}`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
    });
    return { status: mapMpOrderStatus(order?.status), raw: order };
  }

  async cancel(creds: ProviderCredentials | null, externalId: string): Promise<void> {
    const c = this.need(creds);
    await httpJson(`${BASE}/v1/orders/${encodeURIComponent(externalId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'X-Idempotency-Key': `cancel-${externalId}` },
    });
  }

  private need(creds: ProviderCredentials | null): ProviderCredentials {
    if (!creds) throw new ServiceUnavailableException('Mercado Pago não conectado');
    return creds;
  }
}
