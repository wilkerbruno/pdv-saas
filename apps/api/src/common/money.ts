// Cálculo de parcelamento. Tudo em centavos (inteiros) para evitar erro de ponto flutuante.

export interface InstallmentPolicyInput {
  maxInstallments: number;
  /** Até N parcelas sem juros para o cliente. */
  freeInstallments: number;
  /** Juros ao mês (pontos-base): 199 = 1,99% a.m. */
  monthlyRateBps: number;
  minInstallmentCents: number;
  /** Se false, o lojista absorve o custo: o cliente nunca paga juros. */
  customerPaysInterest: boolean;
}

export interface InstallmentOption {
  installments: number;
  hasInterest: boolean;
  /** Juros embutidos, em centavos. */
  interestCents: number;
  /** Valor total cobrado (principal + juros). */
  totalCents: number;
  /** Valor de cada parcela; a soma é exatamente totalCents. */
  installmentValues: number[];
}

export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${reais}.${rest}`;
}

/** Divide `totalCents` em n parcelas; a diferença de centavos vai para a primeira. */
export function splitEvenly(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));
}

/**
 * Parcela fixa pela Tabela Price: PMT = PV * i / (1 - (1 + i)^-n).
 * Arredonda a parcela para o centavo; o total é parcela * n.
 */
export function priceInstallment(principalCents: number, n: number, monthlyRateBps: number): number {
  const i = monthlyRateBps / 10000;
  if (i === 0) return Math.round(principalCents / n);
  const pmt = (principalCents * i) / (1 - Math.pow(1 + i, -n));
  return Math.round(pmt);
}

export function quoteInstallments(
  principalCents: number,
  installments: number,
  policy: InstallmentPolicyInput,
): InstallmentOption {
  if (!Number.isInteger(principalCents) || principalCents <= 0) {
    throw new RangeError('Valor deve ser um inteiro positivo em centavos');
  }
  if (!Number.isInteger(installments) || installments < 1 || installments > policy.maxInstallments) {
    throw new RangeError(`Parcelas devem estar entre 1 e ${policy.maxInstallments}`);
  }

  const free =
    installments === 1 ||
    !policy.customerPaysInterest ||
    installments <= policy.freeInstallments ||
    policy.monthlyRateBps === 0;

  if (free) {
    return {
      installments,
      hasInterest: false,
      interestCents: 0,
      totalCents: principalCents,
      installmentValues: splitEvenly(principalCents, installments),
    };
  }

  const parcela = priceInstallment(principalCents, installments, policy.monthlyRateBps);
  const total = parcela * installments;
  return {
    installments,
    hasInterest: true,
    interestCents: total - principalCents,
    totalCents: total,
    installmentValues: Array.from({ length: installments }, () => parcela),
  };
}

/** Opções que a tela de pagamento mostra (respeita a parcela mínima). */
export function listInstallmentOptions(principalCents: number, policy: InstallmentPolicyInput): InstallmentOption[] {
  const options: InstallmentOption[] = [];
  for (let n = 1; n <= policy.maxInstallments; n++) {
    if (n > 1 && Math.floor(principalCents / n) < policy.minInstallmentCents) break;
    options.push(quoteInstallments(principalCents, n, policy));
  }
  return options;
}
