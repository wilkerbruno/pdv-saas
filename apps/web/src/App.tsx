import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, hasToken, setToken } from './api';
import { brl, parseMoney } from './money';
import { Me } from './types';
import { Pdv } from './Pdv';
import { Reports } from './Reports';
import { Settings } from './Settings';
import { Subscription } from './Subscription';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(hasToken());
  const [view, setView] = useState<'pdv' | 'reports' | 'settings'>('pdv');
  const [flash, setFlash] = useState('');
  const [cash, setCash] = useState<{ session: { id: string; storeId: string } | null; balance?: { expectedCents: number } } | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/auth/me');
      setMe(m);
      setCash(await api('/cash/current'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasToken()) void load();
  }, [load]);

  // Retorno do OAuth do Mercado Pago (?mp=connected | ?mp=error)
  useEffect(() => {
    const mp = new URLSearchParams(window.location.search).get('mp');
    if (!mp) return;
    window.history.replaceState({}, '', window.location.pathname);
    setView('settings');
    setFlash(mp === 'connected' ? 'Mercado Pago conectado com sucesso.' : 'Não foi possível conectar o Mercado Pago. Tente novamente.');
  }, []);

  const logout = () => {
    setToken(null);
    setMe(null);
    setCash(null);
  };

  if (loading) return <div className="center muted">Carregando…</div>;
  if (!me) return <Auth onDone={load} />;

  const blocked = me.tenant.access === 'BLOCKED';
  const showSettings = view === 'settings' && me.user.role !== 'CASHIER' && !blocked;
  const showReports = view === 'reports' && me.user.role !== 'CASHIER' && !blocked;
  const readOnly = me.tenant.access === 'READ_ONLY';

  return (
    <div className="app">
      <header className="topbar">
        <strong>{me.tenant.name}</strong>
        <span className="muted small">
          {me.user.name} · {me.tenant.plan.name}
        </span>
        <nav className="tabs">
          <button className={view === 'pdv' ? 'tab on' : 'tab'} onClick={() => setView('pdv')}>Vender</button>
          {me.user.role !== 'CASHIER' && (
            <>
              <button className={view === 'reports' ? 'tab on' : 'tab'} onClick={() => setView('reports')}>Relatórios</button>
              <button className={view === 'settings' ? 'tab on' : 'tab'} onClick={() => setView('settings')}>Configurações</button>
            </>
          )}
        </nav>
        <button className="link" onClick={logout}>
          Sair
        </button>
      </header>
      {flash && <div className={flash.startsWith('Não') ? 'banner warn' : 'banner info'} onClick={() => setFlash('')}>{flash}</div>}
      {me.tenant.status === 'TRIAL' && me.tenant.trialEndsAt && (
        <div className="banner info">Teste grátis até {new Date(me.tenant.trialEndsAt).toLocaleDateString('pt-BR')}.</div>
      )}
      {readOnly && <div className="banner warn">Assinatura em atraso: o sistema está em modo somente leitura. Regularize para voltar a vender.</div>}
      {blocked ? (
        <div className="center">
          <h2>Assinatura inativa</h2>
          <p className="muted">Regularize o pagamento da mensalidade para voltar a usar o PDV.</p>
          <Subscription me={me} onPaid={load} />
        </div>
      ) : showReports ? (
        <Reports />
      ) : showSettings ? (
        <Settings me={me} onChanged={load} />
      ) : !cash?.session ? (
        <OpenCash me={me} onOpened={load} disabled={readOnly} />
      ) : (
        <Pdv me={me} cash={cash} reloadCash={load} readOnly={readOnly} />
      )}
    </div>
  );
}

function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : f;
      const r = await api<{ token: string }>(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      setToken(r.token);
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>{mode === 'login' ? 'Entrar' : 'Criar conta da loja'}</h1>
      {mode === 'register' && (
        <>
          <label>Nome da loja<input required value={f.companyName} onChange={set('companyName')} /></label>
          <label>Seu nome<input required value={f.name} onChange={set('name')} /></label>
        </>
      )}
      <label>E-mail<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <label>Senha<input required type="password" minLength={mode === 'register' ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Começar teste grátis'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Criar conta da minha loja' : 'Já tenho conta'}
      </button>
    </form>
  );
}

function OpenCash({ me, onOpened, disabled }: { me: Me; onOpened: () => void; disabled: boolean }) {
  const [storeId, setStoreId] = useState(me.tenant.stores[0]?.id ?? '');
  const [value, setValue] = useState('0,00');
  const [err, setErr] = useState('');

  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(value);
    if (cents === null) return setErr('Valor inválido');
    try {
      await api('/cash/open', { method: 'POST', body: { storeId, openingCents: cents } });
      onOpened();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  return (
    <form className="card auth" onSubmit={open}>
      <h2>Abrir caixa</h2>
      {me.tenant.stores.length > 1 && (
        <label>Loja<select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{me.tenant.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      )}
      <label>Troco inicial (R$)<input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={disabled}>Abrir caixa</button>
      <p className="muted small">Troco inicial: {brl(parseMoney(value) ?? 0)}</p>
    </form>
  );
}
