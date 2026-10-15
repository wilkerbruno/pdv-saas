import { TenantStatusName } from './types';

export type AccessLevel = 'FULL' | 'READ_ONLY' | 'BLOCKED';

export interface BillingState {
  status: TenantStatusName;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface AccessOptions {
  /** Dias após o vencimento com acesso total (assinatura paga). */
  graceDays: number;
  /** Dias seguintes em modo somente leitura, antes do bloqueio total. */
  readOnlyDays: number;
}

export const DEFAULT_ACCESS_OPTIONS: AccessOptions = { graceDays: 5, readOnlyDays: 10 };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide o nível de acesso do tenant:
 *  - dentro do prazo (trial ou período pago) → FULL
 *  - vencido: tolerância (só assinantes) → FULL, depois somente leitura, depois bloqueio.
 */
export function resolveAccess(
  state: BillingState,
  now: Date = new Date(),
  opts: AccessOptions = DEFAULT_ACCESS_OPTIONS,
): AccessLevel {
  if (state.status === 'CANCELED' || state.status === 'SUSPENDED') return 'BLOCKED';

  const isTrial = state.status === 'TRIAL';
  const dueAt = isTrial ? state.trialEndsAt : state.currentPeriodEnd;

  if (!dueAt) return isTrial ? 'BLOCKED' : 'FULL';

  const overdueDays = (now.getTime() - dueAt.getTime()) / DAY_MS;
  if (overdueDays <= 0) return 'FULL';

  const grace = isTrial ? 0 : opts.graceDays;
  if (overdueDays <= grace) return 'FULL';
  if (overdueDays <= grace + opts.readOnlyDays) return 'READ_ONLY';
  return 'BLOCKED';
}
