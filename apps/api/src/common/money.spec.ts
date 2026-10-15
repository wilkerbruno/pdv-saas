import { centsToDecimalString, listInstallmentOptions, quoteInstallments, splitEvenly } from './money';

const policy = {
  maxInstallments: 12,
  freeInstallments: 3,
  monthlyRateBps: 199,
  minInstallmentCents: 500,
  customerPaysInterest: true,
};

describe('parcelamento', () => {
  it('à vista não tem juros', () => {
    const q = quoteInstallments(10000, 1, policy);
    expect(q.hasInterest).toBe(false);
    expect(q.totalCents).toBe(10000);
    expect(q.installmentValues).toEqual([10000]);
  });

  it('até a quantidade sem juros, soma das parcelas é exatamente o valor (resto na 1ª)', () => {
    const q = quoteInstallments(10000, 3, policy);
    expect(q.hasInterest).toBe(false);
    expect(q.installmentValues).toEqual([3334, 3333, 3333]);
    expect(q.installmentValues.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('acima do limite sem juros usa Tabela Price', () => {
    // R$ 1.000,00 em 6x a 1,99% a.m. → parcela ≈ R$ 178,47 (conferido à mão: 1990 / (1 - 1,0199^-6))
    const q = quoteInstallments(100000, 6, policy);
    expect(q.hasInterest).toBe(true);
    expect(q.installmentValues).toHaveLength(6);
    expect(q.installmentValues[0]).toBe(17847);
    expect(q.totalCents).toBe(17847 * 6);
    expect(q.interestCents).toBe(q.totalCents - 100000);
    expect(q.interestCents).toBeGreaterThan(0);
  });

  it('lojista que absorve juros: cliente nunca paga a mais', () => {
    const q = quoteInstallments(100000, 12, { ...policy, customerPaysInterest: false });
    expect(q.hasInterest).toBe(false);
    expect(q.totalCents).toBe(100000);
  });

  it('taxa zero não gera juros', () => {
    const q = quoteInstallments(100000, 10, { ...policy, monthlyRateBps: 0 });
    expect(q.interestCents).toBe(0);
  });

  it('rejeita parcelas fora do limite e valores inválidos', () => {
    expect(() => quoteInstallments(10000, 13, policy)).toThrow(RangeError);
    expect(() => quoteInstallments(10000, 0, policy)).toThrow(RangeError);
    expect(() => quoteInstallments(0, 1, policy)).toThrow(RangeError);
    expect(() => quoteInstallments(10.5, 1, policy)).toThrow(RangeError);
  });

  it('respeita a parcela mínima ao listar opções', () => {
    // R$ 20,00 com mínimo de R$ 5,00 por parcela → no máximo 4x
    const opts = listInstallmentOptions(2000, policy);
    expect(opts.map((o) => o.installments)).toEqual([1, 2, 3, 4]);
  });

  it('formata centavos', () => {
    expect(centsToDecimalString(2490)).toBe('24.90');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  });
});
