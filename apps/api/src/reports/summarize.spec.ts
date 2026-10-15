import { dayKey, summarize } from './summarize';
import { ReportsService } from './reports.service';

const sale = (iso: string, total: number, items: any[], payments: any[], extra: any = {}) => ({
  createdAt: new Date(iso), paidAt: new Date(iso), totalCents: total, discountCents: 0, interestCents: 0, items, payments, ...extra,
});

describe('summarize', () => {
  it('agrupa dia no fuso de Brasília (23h local não vira o dia seguinte)', () => {
    expect(dayKey(new Date('2026-10-15T02:30:00Z'), -180)).toBe('2026-10-14');
    expect(dayKey(new Date('2026-10-15T03:00:00Z'), -180)).toBe('2026-10-15');
  });

  it('totais, ticket médio, formas de pagamento e ranking', () => {
    const r = summarize([
      sale('2026-10-14T15:00:00Z', 10000, [{ description: 'Camiseta P', qty: 2, totalCents: 8000 }, { description: 'Boné', qty: 1, totalCents: 2000 }],
        [{ method: 'PIX', status: 'APPROVED', principalCents: 10000, interestCents: 0, totalCents: 10000 }]),
      sale('2026-10-15T15:00:00Z', 5300, [{ description: 'Camiseta P', qty: 1, totalCents: 4000 }],
        [{ method: 'CREDIT', status: 'APPROVED', principalCents: 5000, interestCents: 300, totalCents: 5300 },
         { method: 'DEBIT', status: 'DECLINED', principalCents: 5000, interestCents: 0, totalCents: 5000 }], { interestCents: 300 }),
    ]);
    expect(r.salesCount).toBe(2);
    expect(r.revenueCents).toBe(15300);
    expect(r.interestCents).toBe(300);
    expect(r.avgTicketCents).toBe(7650);
    expect(r.byMethod).toEqual([{ method: 'PIX', count: 1, totalCents: 10000 }, { method: 'CREDIT', count: 1, totalCents: 5300 }]);
    expect(r.byDay.map((d) => d.day)).toEqual(['2026-10-14', '2026-10-15']);
    expect(r.topProducts[0]).toEqual({ description: 'Camiseta P', qty: 3, totalCents: 12000 });
  });

  it('vazio não divide por zero', () => {
    expect(summarize([]).avgTicketCents).toBe(0);
  });
});

describe('ReportsService.summary', () => {
  it('valida datas e limite de período; converte o dia para UTC', async () => {
    let where: any;
    const svc = new ReportsService({ sale: { findMany: async (a: any) => { where = a.where; return []; } } } as any);
    await expect(svc.summary('t', '15/10/2026', '2026-10-15')).rejects.toThrow();
    await expect(svc.summary('t', '2026-10-16', '2026-10-15')).rejects.toThrow();
    await expect(svc.summary('t', '2026-01-01', '2026-12-31')).rejects.toThrow(/máximo/);
    await svc.summary('t', '2026-10-15', '2026-10-15');
    expect(where.paidAt.gte.toISOString()).toBe('2026-10-15T03:00:00.000Z');
    expect(where.paidAt.lt.toISOString()).toBe('2026-10-16T03:00:00.000Z');
    expect(where.tenantId).toBe('t');
  });
});
