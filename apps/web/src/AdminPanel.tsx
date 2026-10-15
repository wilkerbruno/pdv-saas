import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { brl, parseMoney } from './money';

interface Overview {
  byStatus: Record<string, number>; total: number; mrrCents: number; trialsEndingIn7Days: number;
  newTenants30d: number; revenue30dCents: number; paidInvoices30d: number;
}
interface TenantRow {
  id: string; name: string; email: string; status: string; access: string;
  trialEndsAt: string | null; currentPeriodEnd: string | null; fiscalEnabled: boolean;
  plan: { code: string; name: string; priceCents: number };
}
interface TenantDetail extends TenantRow {
  document?: string | null; counts: { users: number; stores: number };
  invoices: { id: string; amountCents: number; status: string; paidAt: string | null; createdAt: string }[];
  actions: { id: string; action: string; adminEmail: string; createdAt: string }[];
  users: { id: string; name: string; email: string; role: string; active: boolean }[];
}
interface PlanRow {
  id: string; code: string; name: string; priceCents: number; maxCashRegisters: number; maxStores: number;
  fiscalEnabled: boolean; integratedPos: boolean; active: boolean; tenants: number;
}

const STATUS: Record<string, string> = { TRIAL: 'Teste', ACTIVE: 'Ativa', PAST_DUE: 'Em atraso', SUSPENDED: 'Suspensa', CANCELED: 'Cancelada' };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
const toInput = (d: string | null) => (d ? d.slice(0, 10) : '');
const endOfDay = (v: string) => (v ? new Date(v + 'T23:59:59').toISOString() : null);

export function AdminPanel() {
  const [tab, setTab] = useState<'overview' | 'tenants' | 'plans' | 'invoices'>('overview');
  return (
    <main className="settings">
      <section className="card">
        <h2>Administração da plataforma</h2>
        <div className="row gap wrap">
          {([['overview', 'Resumo'], ['tenants', 'Assinaturas'], ['plans', 'Planos'], ['invoices', 'Cobranças']] as const).map(([id, l]) => (
            <button key={id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>
      </section>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'tenants' && <TenantsTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'invoices' && <InvoicesTab />}
    </main>
  );
}

function OverviewTab() {
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<Overview>('/admin/overview').then(setO).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="error">{err}</div>;
  if (!o) return <p className="muted">Carregando…</p>;
  return (
    <section className="card">
      <div className="grid2">
        <div><div className="muted small">Receita mensal recorrente</div><strong>{brl(o.mrrCents)}</strong></div>
        <div><div className="muted small">Recebido (30 dias)</div><strong>{brl(o.revenue30dCents)} · {o.paidInvoices30d} pgtos</strong></div>
        <div><div className="muted small">Lojas</div><strong>{o.total}</strong></div>
        <div><div className="muted small">Novas (30 dias)</div><strong>{o.newTenants30d}</strong></div>
        <div><div className="muted small">Testes acabando em 7 dias</div><strong>{o.trialsEndingIn7Days}</strong></div>
      </div>
      <div className="row gap wrap">
        {Object.entries(o.byStatus).map(([s, n]) => <span key={s} className="pill">{STATUS[s] ?? s}: {n}</span>)}
      </div>
    </section>
  );
}

function TenantsTab() {
  const [items, setItems] = useState<TenantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search.trim()) qs.set('search', search.trim());
      if (status) qs.set('status', status);
      const r = await api<{ total: number; items: TenantRow[] }>(`/admin/tenants?${qs}`);
      setItems(r.items); setTotal(r.total); setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, [page, search, status]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  if (sel) return <TenantEditor id={sel} onBack={() => { setSel(null); void load(); }} />;
  return (
    <section className="card">
      <div className="grid2">
        <input placeholder="Buscar nome, e-mail ou CNPJ" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {err && <div className="error">{err}</div>}
      {items.map((t) => (
        <button key={t.id} className="list-item" onClick={() => setSel(t.id)}>
          <div><strong>{t.name}</strong><div className="muted small">{t.email} · {t.plan.name}</div></div>
          <div className="right small">
            <span className={t.access === 'FULL' ? 'pill ok' : 'pill bad'}>{STATUS[t.status] ?? t.status}</span>
            <div className="muted">até {fmt(t.status === 'TRIAL' ? t.trialEndsAt : t.currentPeriodEnd)}</div>
          </div>
        </button>
      ))}
      {!items.length && !err && <p className="muted">Nenhuma loja encontrada.</p>}
      <div className="row gap">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
        <span className="muted small">Página {page} · {total} lojas</span>
        <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Próxima</button>
      </div>
    </section>
  );
}

function TenantEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [t, setT] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [status, setStatus] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [trial, setTrial] = useState('');
  const [period, setPeriod] = useState('');
  const [fiscal, setFiscal] = useState(false);
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([api<TenantDetail>(`/admin/tenants/${id}`), api<PlanRow[]>('/admin/plans')]);
    setT(d); setPlans(p);
    setStatus(d.status); setPlanCode(d.plan.code); setTrial(toInput(d.trialEndsAt)); setPeriod(toInput(d.currentPeriodEnd)); setFiscal(d.fiscalEnabled);
  }, [id]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e) { setErr((e as Error).message); }
  };
  if (!t) return <section className="card">{err ? <div className="error">{err}</div> : <p className="muted">Carregando…</p>}</section>;

  const save = () => run(() => api(`/admin/tenants/${id}`, {
    method: 'PATCH',
    body: { status, planCode, fiscalEnabled: fiscal, trialEndsAt: endOfDay(trial), currentPeriodEnd: endOfDay(period) },
  }), 'Alterações salvas.');
  const quick = (s: string, label: string) => run(() => api(`/admin/tenants/${id}`, { method: 'PATCH', body: { status: s } }), label);

  return (
    <>
      <section className="card">
        <button className="link" onClick={onBack}>← Voltar</button>
        <h3>{t.name}</h3>
        <div className="muted small">{t.email}{t.document ? ` · ${t.document}` : ''} · {t.counts.users} usuários · {t.counts.stores} lojas</div>
        <div className="row gap wrap">
          <span className={t.access === 'FULL' ? 'pill ok' : 'pill bad'}>{STATUS[t.status] ?? t.status} · acesso {t.access}</span>
        </div>
        {msg && <div className="banner info">{msg}</div>}
        {err && <div className="error">{err}</div>}
        <div className="row gap wrap">
          {t.status !== 'SUSPENDED' && <button onClick={() => quick('SUSPENDED', 'Loja suspensa.')}>Suspender</button>}
          {t.status === 'SUSPENDED' && <button onClick={() => quick('ACTIVE', 'Loja reativada.')}>Reativar</button>}
          {t.status !== 'CANCELED' && <button onClick={() => quick('CANCELED', 'Assinatura cancelada.')}>Cancelar</button>}
        </div>
      </section>

      <section className="card">
        <h3>Assinatura</h3>
        <div className="grid2">
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Plano<select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
            {plans.map((p) => <option key={p.id} value={p.code}>{p.name} ({brl(p.priceCents)}){p.active ? '' : ' · inativo'}</option>)}</select></label>
          <label>Fim do teste<input type="date" value={trial} onChange={(e) => setTrial(e.target.value)} /></label>
          <label>Pago até<input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        </div>
        <label className="row gap"><input type="checkbox" style={{ width: 'auto' }} checked={fiscal} onChange={(e) => setFiscal(e.target.checked)} /> Emissão fiscal (NFC-e) habilitada</label>
        <button className="primary" onClick={save}>Salvar alterações</button>
      </section>

      <section className="card">
        <h3>Liberar dias (pagamento manual / cortesia)</h3>
        <div className="row gap">
          <input type="number" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} style={{ maxWidth: 120 }} />
          <button onClick={() => run(() => api(`/admin/tenants/${id}/extend`, { method: 'POST', body: { days: Number(days) } }), `+${days} dias liberados.`)}>Adicionar dias e ativar</button>
        </div>
      </section>

      <section className="card">
        <h3>Cobranças</h3>
        {t.invoices.map((i) => (
          <div key={i.id} className="row between small"><span>{fmt(i.createdAt)} · {brl(i.amountCents)}</span><span className="pill">{i.status}</span></div>
        ))}
        {!t.invoices.length && <p className="muted small">Sem cobranças.</p>}
        <h3>Histórico administrativo</h3>
        {t.actions.map((a) => <div key={a.id} className="muted small">{fmt(a.createdAt)} · {a.action} · {a.adminEmail}</div>)}
        {!t.actions.length && <p className="muted small">Sem ações registradas.</p>}
      </section>
    </>
  );
}

function PlansTab() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Partial<PlanRow> | null>(null);
  const [price, setPrice] = useState('');
  const load = useCallback(() => api<PlanRow[]>('/admin/plans').then(setPlans).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const open = (p: Partial<PlanRow>) => { setErr(''); setEdit(p); setPrice(p.priceCents != null ? (p.priceCents / 100).toFixed(2).replace('.', ',') : ''); };
  const save = async () => {
    if (!edit) return;
    const cents = parseMoney(price);
    if (cents == null) return setErr('Preço inválido');
    const body = {
      name: edit.name, priceCents: cents, maxCashRegisters: Number(edit.maxCashRegisters ?? 1), maxStores: Number(edit.maxStores ?? 1),
      fiscalEnabled: !!edit.fiscalEnabled, integratedPos: !!edit.integratedPos, active: edit.active ?? true,
    };
    try {
      if (edit.id) await api(`/admin/plans/${edit.id}`, { method: 'PATCH', body });
      else await api('/admin/plans', { method: 'POST', body: { ...body, code: edit.code } });
      setEdit(null); setErr(''); await load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <section className="card">
        <div className="row between"><h3>Planos</h3><button onClick={() => open({ active: true, maxCashRegisters: 1, maxStores: 1 })}>+ Novo plano</button></div>
        {err && !edit && <div className="error">{err}</div>}
        {plans.map((p) => (
          <button key={p.id} className="list-item" onClick={() => open(p)}>
            <div><strong>{p.name}</strong> <span className="muted small">({p.code})</span>
              <div className="muted small">{p.maxCashRegisters} caixa(s) · {p.maxStores} loja(s){p.fiscalEnabled ? ' · fiscal' : ''}{p.integratedPos ? ' · maquininha' : ''}</div></div>
            <div className="right small"><strong>{brl(p.priceCents)}</strong>
              <div className="muted">{p.tenants} lojas{p.active ? '' : ' · inativo'}</div></div>
          </button>
        ))}
      </section>
      {edit && (
        <section className="card">
          <h3>{edit.id ? `Editar ${edit.code}` : 'Novo plano'}</h3>
          <div className="grid2">
            {!edit.id && <label>Código<input value={edit.code ?? ''} placeholder="ex.: gold" onChange={(e) => setEdit({ ...edit, code: e.target.value.toLowerCase() })} /></label>}
            <label>Nome<input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Preço mensal (R$)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label>Caixas<input type="number" min={1} value={edit.maxCashRegisters ?? 1} onChange={(e) => setEdit({ ...edit, maxCashRegisters: Number(e.target.value) })} /></label>
            <label>Lojas<input type="number" min={1} value={edit.maxStores ?? 1} onChange={(e) => setEdit({ ...edit, maxStores: Number(e.target.value) })} /></label>
          </div>
          <label className="row gap"><input type="checkbox" style={{ width: 'auto' }} checked={!!edit.fiscalEnabled} onChange={(e) => setEdit({ ...edit, fiscalEnabled: e.target.checked })} /> Inclui NFC-e</label>
          <label className="row gap"><input type="checkbox" style={{ width: 'auto' }} checked={!!edit.integratedPos} onChange={(e) => setEdit({ ...edit, integratedPos: e.target.checked })} /> Inclui maquininha integrada</label>
          <label className="row gap"><input type="checkbox" style={{ width: 'auto' }} checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Disponível para novos clientes</label>
          {err && <div className="error">{err}</div>}
          <div className="row gap"><button className="primary" onClick={save}>Salvar</button><button onClick={() => setEdit(null)}>Cancelar</button></div>
        </section>
      )}
    </>
  );
}

function InvoicesTab() {
  const [items, setItems] = useState<{ id: string; tenantId: string; planCode: string; amountCents: number; status: string; paidAt: string | null; createdAt: string; tenant: { name: string } }[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ items: typeof items }>(`/admin/invoices?pageSize=50${status ? `&status=${status}` : ''}`).then((r) => setItems(r.items)).catch((e) => setErr(e.message));
  }, [status]);
  return (
    <section className="card">
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Todas</option><option value="PENDING">Pendentes</option><option value="PAID">Pagas</option><option value="EXPIRED">Expiradas</option>
      </select>
      {err && <div className="error">{err}</div>}
      {items.map((i) => (
        <div key={i.id} className="row between small">
          <span>{fmt(i.createdAt)} · {i.tenant.name} · {i.planCode}</span>
          <span><strong>{brl(i.amountCents)}</strong> <span className={i.status === 'PAID' ? 'pill ok' : 'pill'}>{i.status}</span></span>
        </div>
      ))}
      {!items.length && !err && <p className="muted small">Nenhuma cobrança.</p>}
    </section>
  );
}
