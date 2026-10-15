import { Injectable } from '@nestjs/common';
import { PaymentMethodName } from '../../common/types';
import { ChargeRequest, ChargeResult, PaymentProvider, StatusResult } from './types';

/**
 * Pagamento confirmado pelo operador: dinheiro, vale-troca ou "o cliente pagou na maquininha"
 * (qualquer maquininha sem API). Não depende de nenhuma integração.
 */
@Injectable()
export class ManualProvider implements PaymentProvider {
  readonly code = 'MANUAL' as const;
  readonly requiresIntegration = false;

  supports(_method: PaymentMethodName) {
    return true;
  }

  async charge(_creds: null, _req: ChargeRequest): Promise<ChargeResult> {
    return { status: 'APPROVED' };
  }
  async fetchStatus(): Promise<StatusResult> {
    return { status: 'APPROVED' };
  }
  async cancel(): Promise<void> {}
}
