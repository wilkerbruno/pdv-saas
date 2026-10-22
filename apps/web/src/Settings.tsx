import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { brl, parseMoney } from './money';
import { Subscription } from './Subscription';
import { Me } from './types';

export function Settings({ me, onChanged }: { me: Me; onChanged: () => void }) {
  return (
    <main className="settings">
      <Subscription me={me} onPaid={onChanged} />
      <Employees me={me} />
      <MercadoPago me={me} />
      <Installments />
      <Fiscal me={me} onChanged={onChanged} />
    </main>
  );
}

// ───────────────────────── Funcionários ─────────────────────────

interface Employee { id: string; name: string; email: string; role: 'OWNER' | 'MANAGER' | 'CASHIER'; active: boolean }

const ROLE_LABEL: Record<Employee['role'], string> = { OWNER: 'Dono', MANAGER: 'Gerente', CASHIER: 'Caixa' };

function Employees({ me }: { me: Me }) {
  const [list, setList] = useState<Employee[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'MANAGER' | 'CASHIER'>('CASHIER');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const isOwner = me.user.role === 'OWNER';

  const load = useCallback(async () => {
    try { setList(await api<Employee[]>('/users')); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setErr(''); setMsg('');
    try {
      await api('/users', { method: 'POST', body: { name, email, password, role } });
      setName(''); setEmail(''); setPassword(''); setRole('CASHIER');
      setMsg('Funcionário cadastrado.');
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="card">
      <h2>Funcionários</h2>
      <p className="muted small">
        Caixa só acessa a tela de venda. Gerente acessa produtos, relatórios e configurações, mas não pode cadastrar outro gerente nem mexer em
        Mercado Pago/fiscal. Só o dono tem acesso total.
      </p>

      {list?.map((u) => (
        <div key={u.id} className="list-item">
          <div><strong>{u.name}</strong><div className="muted small">{u.email}</div></div>
          <div className="right small">
            <span className={u.active ? 'pill ok' : 'pill bad'}>{ROLE_LABEL[u.role]}</span>
            {!u.active && <div className="muted">Inativo</div>}
          </div>
        </div>
      ))}
      {list && list.length === 0 && <p className="muted">Nenhum funcionário cadastrado ainda.</p>}

      {isOwner || me.user.role === 'MANAGER' ? (
        <>
          <h3>Novo funcionário</h3>
          <div className="grid2">
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Senha<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label>Cargo
              <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="CASHIER">Caixa</option>
                {isOwner && <option value="MANAGER">Gerente</option>}
              </select>
            </label>
          </div>
          <button className="primary" disabled={name.length < 2 || !email || password.length < 8}
            onClick={create}>
            Cadastrar
          </button>
        </>
      ) : null}
      {msg && <div className="banner info">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </section>
  );
}

// ───────────────────────── Mercado Pago ─────────────────────────

interface MpStatus {
  oauthAvailable: boolean; connected: boolean; needsReconnect: boolean; mode: 'OAUTH' | 'TOKEN' | null;
  accountRef: string | null; deviceId: string | null; expiresAt: string | null;
}
interface Terminal { id: string; name?: string; operating_mode?: string }

function MercadoPago({ me }: { me: Me }) {
  const [st, setSt] = useState<MpStatus | null>(null);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const isOwner = me.user.role === 'OWNER';

  const load = useCallback(async () => {
    try {
      const s = await api<MpStatus>('/integrations/mercadopago/status');
      setSt(s);
      if (s.connected) {
        const t = await api<Terminal[]>('/integrations/mercadopago/terminals').catch(() => []);
        setTerminals(Array.isArray(t) ? t : []);
      }
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e) { setErr((e as Error).message); }
  };

  const connectOAuth = async () => {
    try {
      const r = await api<{ url: string }>('/integrations/mercadopago/oauth/start');
      window.location.href = r.url; // o Mercado Pago devolve para a API, que redireciona de volta para cá
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="card">
      <div className="row between">
        <h2>Mercado Pago (maquininha Point e PIX)</h2>
        {st && <span className={st.connected ? 'pill ok' : st.needsReconnect ? 'pill bad' : 'pill'}>
          {st.connected ? 'Conectado' : st.needsReconnect ? 'Reconectar' : 'Não conectado'}
        </span>}
      </div>
      {st?.connected && (
        <p className="muted small">
          Conta {st.accountRef} · {st.mode === 'OAUTH' ? 'conexão por autorização' : 'conexão por token manual'}
          {st.expiresAt && st.mode === 'OAUTH' ? ` · renova sozinha (vence em ${new Date(st.expiresAt).toLocaleDateString('pt-BR')})` : ''}
        </p>
      )}
      {st?.needsReconnect && <div className="banner warn">A conexão expirou. Conecte novamente para voltar a receber por maquininha e PIX.</div>}

      {(!st?.connected || st.needsReconnect) && st?.oauthAvailable && (
        <>
          <p className="muted small">Você entra na sua conta Mercado Pago e autoriza. O dinheiro das vendas cai direto na sua conta.</p>
          <button className="primary" disabled={!isOwner} onClick={connectOAuth}>Conectar com Mercado Pago</button>
        </>
      )}
      {(!st?.connected || st.needsReconnect) && st && !st.oauthAvailable && (
        <>
          <p className="muted small">Cole o Access Token de produção da sua conta (Mercado Pago → Seu negócio → Configurações → Credenciais).</p>
          <label>Access Token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
          <button className="primary" disabled={!isOwner || token.length < 20}
            onClick={() => run(() => api('/integrations/mercadopago', { method: 'PUT', body: { accessToken: token } }).then(() => setToken('')), 'Mercado Pago conectado.')}>
            Salvar e conectar
          </button>
        </>
      )}

      {st?.connected && (
        <>
          <label>Maquininha padrão da loja
            <select value={st.deviceId ?? ''} disabled={!isOwner}
              onChange={(e) => run(() => api('/integrations/mercadopago/default-terminal', { method: 'PUT', body: { deviceId: e.target.value } }), 'Maquininha padrão atualizada.')}>
              <option value="">Selecione…</option>
              {terminals.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}{t.operating_mode ? ` (${t.operating_mode})` : ''}</option>)}
            </select>
          </label>
          {terminals.length === 0 && <p className="muted small">Nenhuma maquininha Point encontrada nesta conta.</p>}
          <div className="row gap">
            <button disabled={!isOwner || !st.deviceId}
              onClick={() => run(() => api('/integrations/mercadopago/terminals/pdv-mode', { method: 'POST', body: { deviceId: st.deviceId } }), 'Maquininha colocada em modo PDV. Reinicie-a para aplicar.')}>
              Colocar em modo PDV
            </button>
            <button className="danger" disabled={!isOwner}
              onClick={() => window.confirm('Desconectar o Mercado Pago?') && run(() => api('/integrations/mercadopago', { method: 'DELETE' }), 'Desconectado.')}>
              Desconectar
            </button>
          </div>
          <p className="muted small">Pagar.me/Stone: em breve. Qualquer outra maquininha funciona no modo "cliente já pagou".</p>
        </>
      )}
      {msg && <div className="banner info">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </section>
  );
}

// ───────────────────────── Parcelamento ─────────────────────────

interface Policy { maxInstallments: number; freeInstallments: number; monthlyRateBps: number; minInstallmentCents: number; customerPaysInterest: boolean }

function Installments() {
  const [p, setP] = useState<Policy | null>(null);
  const [rate, setRate] = useState('');
  const [min, setMin] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Policy>('/payments/policy').then((x) => {
      setP(x);
      setRate((x.monthlyRateBps / 100).toFixed(2).replace('.', ','));
      setMin((x.minInstallmentCents / 100).toFixed(2).replace('.', ','));
    }).catch((e) => setErr(e.message));
  }, []);
  if (!p) return <section className="card"><h2>Parcelamento no crédito</h2>{err && <div className="error">{err}</div>}</section>;

  const save = async () => {
    setErr(''); setMsg('');
    const bps = Math.round(parseFloat(rate.replace(',', '.')) * 100);
    const minCents = parseMoney(min);
    if (!Number.isFinite(bps) || minCents === null) return setErr('Confira a taxa e a parcela mínima');
    try {
      await api('/payments/policy', { method: 'PUT', body: { maxInstallments: p.maxInstallments, freeInstallments: p.freeInstallments, monthlyRateBps: bps, minInstallmentCents: minCents, customerPaysInterest: p.customerPaysInterest } });
      setMsg('Política de parcelamento salva.');
    } catch (e) { setErr((e as Error).message); }
  };
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP({ ...p, [k]: v });
  const num = (v: string) => Math.max(1, parseInt(v || '1', 10) || 1);

  return (
    <section className="card">
      <h2>Parcelamento no crédito</h2>
      <label className="check"><input type="checkbox" checked={p.customerPaysInterest} onChange={(e) => set('customerPaysInterest', e.target.checked)} />
        Cobrar juros do cliente (desmarcado: a loja absorve o custo)</label>
      <div className="grid2">
        <label>Máximo de parcelas<input type="number" min={1} max={24} value={p.maxInstallments} onChange={(e) => set('maxInstallments', num(e.target.value))} /></label>
        <label>Parcelas sem juros (até)<input type="number" min={1} max={24} value={p.freeInstallments} onChange={(e) => set('freeInstallments', num(e.target.value))} /></label>
        <label>Juros ao mês (%)<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label>Parcela mínima (R$)<input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
      </div>
      <p className="muted small">Exemplo: {brl(100000)} em {Math.min(6, p.maxInstallments)}x — o PDV calcula a parcela e envia à maquininha o total já com juros.</p>
      <button onClick={save}>Salvar parcelamento</button>
      {msg && <div className="banner info">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </section>
  );
}

// ───────────────────────── Fiscal ─────────────────────────

interface FiscalSettings {
  enabled: boolean; planAllows: boolean; environment: 'HOMOLOGACAO' | 'PRODUCAO'; cnpj: string | null; hasToken: boolean;
  defaultCfop: string; defaultTaxCode: string; autoEmit: boolean; supportedTaxCodes: string[];
}

function Fiscal({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [s, setS] = useState<FiscalSettings | null>(null);
  const [token, setToken] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const isOwner = me.user.role === 'OWNER';

  useEffect(() => {
    api<FiscalSettings>('/fiscal/settings').then((x) => { setS(x); setCnpj(x.cnpj ?? ''); }).catch((e) => setErr(e.message));
  }, []);
  if (!s) return <section className="card"><h2>Nota fiscal (NFC-e)</h2>{err && <div className="error">{err}</div>}</section>;
  const set = <K extends keyof FiscalSettings>(k: K, v: FiscalSettings[K]) => setS({ ...s, [k]: v });

  const save = async (enabled?: boolean) => {
    setErr(''); setMsg('');
    try {
      const r = await api<FiscalSettings>('/fiscal/settings', { method: 'PUT', body: {
        enabled, environment: s.environment, cnpj, providerToken: token || undefined,
        defaultCfop: s.defaultCfop, defaultTaxCode: s.defaultTaxCode, autoEmit: s.autoEmit,
      } });
      setS(r); setToken(''); setMsg(enabled === undefined ? 'Configurações fiscais salvas.' : enabled ? 'Emissão de NFC-e ativada.' : 'Emissão de NFC-e desativada.');
      onChanged();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="card">
      <div className="row between">
        <h2>Nota fiscal (NFC-e)</h2>
        <span className={s.enabled ? 'pill ok' : 'pill'}>{s.enabled ? 'Ativada' : 'Desativada'}</span>
      </div>
      {!s.planAllows && <div className="banner warn">Seu plano não inclui emissão fiscal. Disponível no plano Pro. MEI normalmente é dispensado de NFC-e na venda ao consumidor — confirme com seu contador.</div>}
      <p className="muted small">A emissão usa o Focus NFe. Cadastre sua empresa e o certificado A1 lá, gere o token da empresa e informe aqui. Comece em <strong>Homologação</strong> (sem valor fiscal) e só depois mude para Produção.</p>
      <div className="grid2">
        <label>Ambiente
          <select value={s.environment} disabled={!isOwner} onChange={(e) => set('environment', e.target.value as FiscalSettings['environment'])}>
            <option value="HOMOLOGACAO">Homologação (testes)</option>
            <option value="PRODUCAO">Produção (valendo)</option>
          </select>
        </label>
        <label>CNPJ da loja<input value={cnpj} disabled={!isOwner} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></label>
        <label>Token do Focus NFe<input type="password" autoComplete="off" disabled={!isOwner} value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.hasToken ? 'já configurado — deixe em branco para manter' : 'cole o token da empresa'} /></label>
        <label>CFOP padrão<input value={s.defaultCfop} disabled={!isOwner} maxLength={4} onChange={(e) => set('defaultCfop', e.target.value.replace(/\D/g, ''))} /></label>
        <label>CSOSN padrão (Simples Nacional)
          <select value={s.defaultTaxCode} disabled={!isOwner} onChange={(e) => set('defaultTaxCode', e.target.value)}>
            {s.supportedTaxCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={s.autoEmit} disabled={!isOwner} onChange={(e) => set('autoEmit', e.target.checked)} />Emitir a nota automaticamente quando a venda for paga</label>
      <p className="muted small">Cada produto precisa do NCM (8 dígitos). Sem ele a nota é recusada antes de ir à SEFAZ, com aviso no PDV.</p>
      <div className="row gap">
        <button disabled={!isOwner} onClick={() => save()}>Salvar</button>
        {s.enabled
          ? <button className="danger" disabled={!isOwner} onClick={() => save(false)}>Desativar emissão</button>
          : <button className="primary" disabled={!isOwner || !s.planAllows} onClick={() => save(true)}>Ativar emissão</button>}
      </div>
      {msg && <div className="banner info">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </section>
  );
}
