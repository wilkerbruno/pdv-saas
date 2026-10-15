import { resolveAccess } from './access';

const d = (s: string) => new Date(s);

describe('acesso por assinatura', () => {
  it('trial dentro do prazo libera tudo', () => {
    expect(resolveAccess({ status: 'TRIAL', trialEndsAt: d('2026-10-20'), currentPeriodEnd: null }, d('2026-10-15'))).toBe('FULL');
  });

  it('trial vencido vai para somente leitura e depois bloqueia (sem tolerância)', () => {
    const s = { status: 'TRIAL' as const, trialEndsAt: d('2026-10-01'), currentPeriodEnd: null };
    expect(resolveAccess(s, d('2026-10-05'))).toBe('READ_ONLY');
    expect(resolveAccess(s, d('2026-10-20'))).toBe('BLOCKED');
  });

  it('trial sem data de fim é bloqueado', () => {
    expect(resolveAccess({ status: 'TRIAL', trialEndsAt: null, currentPeriodEnd: null }, d('2026-10-15'))).toBe('BLOCKED');
  });

  it('assinante em dia ou dentro da tolerância tem acesso total', () => {
    const s = { status: 'ACTIVE' as const, trialEndsAt: null, currentPeriodEnd: d('2026-10-10') };
    expect(resolveAccess(s, d('2026-10-09'))).toBe('FULL');
    expect(resolveAccess(s, d('2026-10-14'))).toBe('FULL'); // 4 dias de atraso
  });

  it('inadimplente: leitura após a tolerância e bloqueio total depois', () => {
    const s = { status: 'PAST_DUE' as const, trialEndsAt: null, currentPeriodEnd: d('2026-10-01') };
    expect(resolveAccess(s, d('2026-10-10'))).toBe('READ_ONLY'); // 9 dias
    expect(resolveAccess(s, d('2026-10-20'))).toBe('BLOCKED'); // 19 dias
  });

  it('cancelado e suspenso são bloqueados', () => {
    for (const status of ['CANCELED', 'SUSPENDED'] as const) {
      expect(resolveAccess({ status, trialEndsAt: null, currentPeriodEnd: d('2030-01-01') }, d('2026-10-15'))).toBe('BLOCKED');
    }
  });
});
