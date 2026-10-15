import { BadRequestException } from '@nestjs/common';
import { planPayments, PlanOptions } from './payment-plan';

const policy = { maxInstallments: 12, freeInstallments: 1, monthlyRateBps: 199, minInstallmentCents: 500, customerPaysInterest: true };
const opts = (over: Partial<PlanOptions> = {}): PlanOptions => ({
  dueCents: 30000,
  exact: true,
  policy,
  supports: (p, m) => (p === 'MERCADOPAGO_POINT' ? m === 'CREDIT' || m === 'DEBIT' : p === 'MANUAL' || m === 'PIX'),
  customerCreditCents: null,
  ...over,
});

describe('planPayments', () => {
  it('pagamento dividido: dinheiro + crédito parcelado com juros no cartão', () => {
    const r = planPayments(
      [
        { method: 'CASH', amountCents: 10000 },
        { method: 'CREDIT', provider: 'MERCADOPAGO_POINT', installments: 6, amountCents: 20000 },
      ],
      opts(),
    );
    expect(r[0]).toMatchObject({ provider: 'MANUAL', interestCents: 0, totalCents: 10000 });
    expect(r[1].provider).toBe('MERCADOPAGO_POINT');
    expect(r[1].interestCents).toBeGreaterThan(0);
    expect(r[1].totalCents).toBe(20000 + r[1].interestCents);
    // R$ 200,00 em 6x a 1,99%: parcela de R$ 35,69 → total R$ 214,14 (conferido à mão)
    expect(r[1].totalCents).toBe(3569 * 6);
  });

  it('crédito à vista e débito não têm juros', () => {
    const r = planPayments([{ method: 'CREDIT', amountCents: 30000 }], opts());
    expect(r[0].interestCents).toBe(0);
    const d = planPayments([{ method: 'DEBIT', amountCents: 30000 }], opts());
    expect(d[0].totalCents).toBe(30000);
  });

  it('rejeita soma diferente do valor da venda', () => {
    expect(() => planPayments([{ method: 'CASH', amountCents: 29999 }], opts())).toThrow(BadRequestException);
    expect(() => planPayments([{ method: 'CASH', amountCents: 30001 }], opts())).toThrow(BadRequestException);
  });

  it('aceita pagamento parcial quando exact=false, mas não acima do restante', () => {
    expect(planPayments([{ method: 'CASH', amountCents: 5000 }], opts({ exact: false }))).toHaveLength(1);
    expect(() => planPayments([{ method: 'CASH', amountCents: 40000 }], opts({ exact: false }))).toThrow(BadRequestException);
  });

  it('rejeita parcelas além do limite e parcelamento fora do crédito', () => {
    expect(() => planPayments([{ method: 'CREDIT', installments: 13, amountCents: 30000 }], opts())).toThrow(BadRequestException);
    expect(() => planPayments([{ method: 'DEBIT', installments: 2, amountCents: 30000 }], opts())).toThrow(BadRequestException);
  });

  it('rejeita provider incompatível com a forma de pagamento', () => {
    expect(() => planPayments([{ method: 'PIX', provider: 'MERCADOPAGO_POINT', amountCents: 30000 }], opts())).toThrow(BadRequestException);
    expect(() => planPayments([{ method: 'CASH', provider: 'MERCADOPAGO_POINT', amountCents: 30000 }], opts())).toThrow(BadRequestException);
  });

  it('vale-troca exige cliente e saldo suficiente', () => {
    const pay = [{ method: 'STORE_CREDIT' as const, amountCents: 30000 }];
    expect(() => planPayments(pay, opts())).toThrow(/cliente/);
    expect(() => planPayments(pay, opts({ customerCreditCents: 10000 }))).toThrow(/insuficiente/);
    expect(planPayments(pay, opts({ customerCreditCents: 30000 }))[0].provider).toBe('MANUAL');
  });

  it('exige ao menos um pagamento e valores positivos', () => {
    expect(() => planPayments([], opts())).toThrow(BadRequestException);
    expect(() => planPayments([{ method: 'CASH', amountCents: 0 }], opts())).toThrow(BadRequestException);
  });
});
