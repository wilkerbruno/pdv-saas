export interface ReportSale {
  createdAt: Date;
  paidAt: Date | null;
  totalCents: number;
  discountCents: number;
  interestCents: number;
  items: { description: string; qty: number; totalCents: number }[];
  payments: { method: string; status: string; principalCents: number; interestCents: number; totalCents: number }[];
}

export interface Summary {
  salesCount: number;
  revenueCents: number; // total das vendas (já com juros do cliente)
  interestCents: number;
  discountCents: number;
  avgTicketCents: number;
  byMethod: { method: string; count: number; totalCents: number }[];
  byDay: { day: string; count: number; totalCents: number }[];
  topProducts: { description: string; qty: number; totalCents: number }[];
}

/** "YYYY-MM-DD" do instante no fuso dado (offset em minutos em relação ao UTC, ex.: -180). */
export function dayKey(d: Date, tzOffsetMin: number): string {
  return new Date(d.getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** Resume vendas PAGAS. Só pagamentos APROVADOS entram na divisão por forma de pagamento. */
export function summarize(sales: ReportSale[], tzOffsetMin = -180, topN = 10): Summary {
  let revenue = 0, interest = 0, discount = 0;
  const methods = new Map<string, { count: number; totalCents: number }>();
  const days = new Map<string, { count: number; totalCents: number }>();
  const products = new Map<string, { qty: number; totalCents: number }>();

  for (const s of sales) {
    revenue += s.totalCents;
    interest += s.interestCents;
    discount += s.discountCents;
    const d = dayKey(s.paidAt ?? s.createdAt, tzOffsetMin);
    const day = days.get(d) ?? { count: 0, totalCents: 0 };
    day.count++; day.totalCents += s.totalCents; days.set(d, day);
    for (const p of s.payments) {
      if (p.status !== 'APPROVED') continue;
      const m = methods.get(p.method) ?? { count: 0, totalCents: 0 };
      m.count++; m.totalCents += p.totalCents; methods.set(p.method, m);
    }
    for (const i of s.items) {
      const pr = products.get(i.description) ?? { qty: 0, totalCents: 0 };
      pr.qty += i.qty; pr.totalCents += i.totalCents; products.set(i.description, pr);
    }
  }

  return {
    salesCount: sales.length,
    revenueCents: revenue,
    interestCents: interest,
    discountCents: discount,
    avgTicketCents: sales.length ? Math.round(revenue / sales.length) : 0,
    byMethod: [...methods].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.totalCents - a.totalCents),
    byDay: [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    topProducts: [...products].map(([description, v]) => ({ description, ...v })).sort((a, b) => b.totalCents - a.totalCents).slice(0, topN),
  };
}
