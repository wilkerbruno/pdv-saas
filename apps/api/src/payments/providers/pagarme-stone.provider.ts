import { Injectable, NotImplementedException } from '@nestjs/common';
import { PaymentMethodName } from '../../common/types';
import { ChargeRequest, ChargeResult, PaymentProvider, StatusResult } from './types';

/**
 * Pagar.me + maquininha Stone (Connect Stone). AINDA NÃO IMPLEMENTADO — reservado no registry.
 *
 * O que já sabemos da documentação (https://connect-stone.stone.com.br):
 *  - O PDV cria o pedido na API do Pagar.me; o POS Stone lista os pedidos em aberto e o operador escolhe qual cobrar.
 *  - O resultado volta por webhook do Pagar.me (a cobrança é adicionada ao pedido como "charge").
 *  - Limite de 30 pedidos abertos por terminal, sem expiração: é preciso fechar os abandonados
 *    (rota …/core/v5/orders/{order_id}/closed).
 *  - Cancelamento só antes do pagamento. Estorno NÃO tem rota na API: é feito no POS ou no portal Stone.
 *  - Não há ambiente de testes. Exige ativação do Connect Stone com a Stone e terminais Stone.
 *
 * Implementar após a ativação do Connect Stone, usando a documentação vigente na época.
 */
@Injectable()
export class PagarmeStoneProvider implements PaymentProvider {
  readonly code = 'PAGARME_STONE' as const;
  readonly requiresIntegration = true;

  supports(method: PaymentMethodName) {
    return method === 'DEBIT' || method === 'CREDIT' || method === 'PIX';
  }

  async charge(_c: unknown, _r: ChargeRequest): Promise<ChargeResult> {
    throw this.pending();
  }
  async fetchStatus(): Promise<StatusResult> {
    throw this.pending();
  }
  async cancel(): Promise<void> {
    throw this.pending();
  }

  private pending() {
    return new NotImplementedException('Integração Pagar.me/Stone ainda não disponível. Use o modo manual.');
  }
}
