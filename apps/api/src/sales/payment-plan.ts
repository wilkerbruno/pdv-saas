import { BadRequestException } from '@nestjs/common';
import { InstallmentPolicyInput, quoteInstallments } from '../common/money';
import { PaymentMethodName, ProviderCodeName } from '../common/types';

export interface PaymentInput {
  method: PaymentMethodName;
  provider?: ProviderCodeName;
  installments?: number;
  /** Valor que abate a venda (sem juros). */
  amountCents: number;
  brand?: string;
  deviceId?: string;
}

export interface PlannedPayment {
  method: PaymentMethodName;
  provider: ProviderCodeName;
  installments: number;
  principalCents: number;
  interestCents: number;
  /** O que será efetivamente cobrado do cliente: principal + juros. */
  totalCents: number;
  brand?: string;
  deviceId?: string;
}

export interface PlanOptions {
  /** Valor da venda (ou o que falta pagar) que os pagamentos precisam cobrir. */
  dueCents: number;
  /** true: a soma tem que fechar exatamente `dueCents`. false: aceita pagamento parcial (≤ due). */
  exact: boolean;
  policy: InstallmentPolicyInput;
  supports: (provider: ProviderCodeName, method: PaymentMethodName) => boolean;
  /** Saldo de vale-troca do cliente da venda; null quando não há cliente. */
  customerCreditCents: number | null;
}

/**
 * Valida os pagamentos informados no PDV e calcula os juros de cada um.
 * Função pura: não acessa banco nem rede, o que permite testar todas as regras.
 */
export function planPayments(inputs: PaymentInput[], opts: PlanOptions): PlannedPayment[] {
  if (inputs.length === 0) throw new BadRequestException('Informe ao menos um pagamento');

  const planned = inputs.map((p): PlannedPayment => {
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
      throw new BadRequestException('Valor do pagamento deve ser positivo (em centavos)');
    }

    const fixedManual = p.method === 'CASH' || p.method === 'STORE_CREDIT';
    const provider: ProviderCodeName = fixedManual ? 'MANUAL' : (p.provider ?? 'MANUAL');
    if (fixedManual && p.provider && p.provider !== 'MANUAL') {
      throw new BadRequestException(`${p.method === 'CASH' ? 'Dinheiro' : 'Vale-troca'} não usa maquininha`);
    }
    if (!opts.supports(provider, p.method)) {
      throw new BadRequestException(`${provider} não aceita ${p.method}`);
    }

    const installments = p.installments ?? 1;
    if (p.method !== 'CREDIT' && installments !== 1) {
      throw new BadRequestException('Parcelamento só é possível no crédito');
    }

    let interestCents = 0;
    if (p.method === 'CREDIT') {
      try {
        interestCents = quoteInstallments(p.amountCents, installments, opts.policy).interestCents;
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }

    return {
      method: p.method,
      provider,
      installments,
      principalCents: p.amountCents,
      interestCents,
      totalCents: p.amountCents + interestCents,
      brand: p.brand,
      deviceId: p.deviceId,
    };
  });

  const principal = planned.reduce((s, p) => s + p.principalCents, 0);
  if (opts.exact ? principal !== opts.dueCents : principal > opts.dueCents) {
    throw new BadRequestException(
      opts.exact
        ? `Soma dos pagamentos (${principal}) difere do valor a pagar (${opts.dueCents})`
        : `Pagamentos (${principal}) excedem o valor restante (${opts.dueCents})`,
    );
  }

  const storeCredit = planned.filter((p) => p.method === 'STORE_CREDIT').reduce((s, p) => s + p.principalCents, 0);
  if (storeCredit > 0) {
    if (opts.customerCreditCents === null) throw new BadRequestException('Informe o cliente para usar vale-troca');
    if (storeCredit > opts.customerCreditCents) throw new BadRequestException('Saldo de vale-troca insuficiente');
  }

  return planned;
}
