import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { brl } from './money';

interface Summary {
  salesCount: number; revenueCents: number; interestCents: number; discountCents: number; avgTicketCents: number;
  byMethod: { method: string; count: number; totalCents: number }[];
  byDay: { day: string; count: number; totalCents: number }[];
  topProducts: { description: string; qty: number; totalCents: number }[];
}

const METHOD: Record<string, string> = { CASH: 'Dinheiro', PIX: 'PIX', DEBIT: 'Débito', CREDIT: 'Crédito', STORE_CREDIT: 'Crédito de loja' };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function Reports() {
  const today = iso(new Date());
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { setData(await api<Summary>(`/reports/summary?from=${from}&to=${to}`)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const max = Math.max(1, ...(data?.byDay.map((d) => d.totalCents) ?? [1]));
  const preset = (days: number) => { setFrom(iso(new Date(Date.now() - (days - 1) * 86_400_000))); setTo(today); };

  return (
    <main className="settings">
      <section className="card">
        <h2>Relatório de vendas</h2>
        <div className="grid2">
          <label>De<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="row gap">
          <button onClick={() => preset(1)}>Hoje</button>
          <button onClick={() => preset(7)}>7 dias</button>
          <button onClick={() => preset(30)}>30 dias</button>
        </div>
        {busy && <p className="muted small">Carregando…</p>}
        {err && <div className="error">{err}</div>}
      </section>

      {data && (
        <>
          <section className="card">
            <div className="grid2">
              <div><div className="muted small">Faturamento</div><strong>{brl(data.revenueCents)}</strong></div>
              <div><div className="muted small">Vendas</div><strong>{data.salesCount}</strong></div>
              <div><div className="muted small">Ticket médio</div><strong>{brl(data.avgTicketCents)}</strong></div>
              <div><div className="muted small">Descontos / juros cobrados</div><strong>{brl(data.discountCents)} / {brl(data.interestCents)}</strong></div>
            </div>
          </section>

          <section className="card">
            <h2>Por dia</h2>
            {data.byDay.length === 0 && <p className="muted small">Sem vendas no período.</p>}
            {data.byDay.map((d) => (
              <div key={d.day} className="barrow">
                <span className="small">{d.day.slice(8)}/{d.day.slice(5, 7)}</span>
                <div className="bar"><i style={{ width: `${(d.totalCents / max) * 100}%` }} /></div>
                <span className="small">{brl(d.totalCents)} · {d.count}</span>
              </div>
            ))}
          </section>

          <section className="card">
            <h2>Formas de pagamento</h2>
            {data.byMethod.map((m) => (
              <div key={m.method} className="row between"><span>{METHOD[m.method] ?? m.method} <span className="muted small">({m.count})</span></span><strong>{brl(m.totalCents)}</strong></div>
            ))}
          </section>

          <section className="card">
            <h2>Mais vendidos</h2>
            {data.topProducts.map((p) => (
              <div key={p.description} className="row between"><span>{p.description} <span className="muted small">× {p.qty}</span></span><strong>{brl(p.totalCents)}</strong></div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
