import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { brl, parseMoney } from './money';
import { CartLine, describeVariant, FiscalDoc, Me, Sale, Variant } from './types';
import { PaymentFlow } from './PaymentFlow';
import { BarcodeScanner } from './BarcodeScanner';

interface Props {
  me: Me;
  cash: { session: { id: string; storeId: string } | null; balance?: { expectedCents: number } };
  reloadCash: () => void;
  readOnly: boolean;
}

export function Pdv({ me, cash, reloadCash, readOnly }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Variant[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ sale: Sale; receipt: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [showCash, setShowCash] = useState(false);
  const [scanning, setScanning] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const subtotal = cart.reduce((s, l) => s + l.variant.priceCents * l.qty, 0);
  const discountCents = Math.min(parseMoney(discount) ?? 0, subtotal);
  const due = subtotal - discountCents;

  const add = useCallback((v: Variant) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.variant.id === v.id);
      if (i >= 0) return c.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { variant: v, qty: 1 }];
    });
    setMsg('');
  }, []);

  // Busca ao digitar (nome) com pequeno atraso.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults([]);
    const t = setTimeout(() => {
      api<Variant[]>(`/variants/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Leitor de código de barras "digita" o código e envia Enter.
  const onEnter = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    try {
      add(await api<Variant>(`/variants/lookup?code=${encodeURIComponent(code)}`));
      setQuery('');
      setResults([]);
    } catch {
      if (results.length === 1) {
        add(results[0]);
        setQuery('');
        setResults([]);
      } else setMsg('Código não encontrado');
    }
    input.current?.focus();
  };

  // Leitura pela câmera: cada código lido soma 1 no carrinho (a câmera continua aberta).
  const onCamera = async (code: string) => {
    try {
      const v = await api<Variant>(`/variants/lookup?code=${encodeURIComponent(code)}`);
      add(v);
      return `+1 ${describeVariant(v)}`;
    } catch {
      return `Código ${code} não cadastrado`;
    }
  };

  const setQty = (id: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.variant.id !== id) : c.map((l) => (l.variant.id === id ? { ...l, qty } : l))));

  const finished = (sale: Sale, receipt: string) => {
    setPaying(false);
    setDone({ sale, receipt });
    setCart([]);
    setDiscount('');
    reloadCash();
  };

  return (
    <main className="pdv">
      <section className="panel">
        <form onSubmit={onEnter}>
          <input
            ref={input}
            autoFocus
            className="search"
            placeholder="Bipe o código de barras ou busque pelo nome"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <button className="cam" onClick={() => setScanning(true)}>📷 Ler com a câmera</button>
        {msg && <div className="error">{msg}</div>}
        <ul className="results">
          {results.map((v) => (
            <li key={v.id}>
              <button onClick={() => { add(v); setQuery(''); setResults([]); input.current?.focus(); }}>
                <span>{describeVariant(v)}</span>
                <span className="muted small">estoque {v.stockQty}</span>
                <strong>{brl(v.priceCents)}</strong>
              </button>
            </li>
          ))}
        </ul>
        <div className="row gap">
          <button className="link" onClick={() => setShowCash(true)}>Caixa: {brl(cash.balance?.expectedCents ?? 0)}</button>
        </div>
      </section>

      <section className="panel cart">
        <h2>Venda</h2>
        {cart.length === 0 && <p className="muted">Nenhum item. Bipe ou busque um produto.</p>}
        <ul className="lines">
          {cart.map((l) => (
            <li key={l.variant.id}>
              <div>
                <div>{describeVariant(l.variant)}</div>
                <div className="muted small">{brl(l.variant.priceCents)} cada</div>
              </div>
              <div className="qty">
                <button onClick={() => setQty(l.variant.id, l.qty - 1)} aria-label="Diminuir">−</button>
                <input className="qtyinput" type="number" min={1} inputMode="numeric" value={l.qty} aria-label="Quantidade"
                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isInteger(n)) setQty(l.variant.id, n); }} />
                <button onClick={() => setQty(l.variant.id, l.qty + 1)} aria-label="Aumentar">+</button>
              </div>
              <strong>{brl(l.variant.priceCents * l.qty)}</strong>
            </li>
          ))}
        </ul>
        <div className="totals">
          <div className="row between"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
          <label className="row between">Desconto (R$)
            <input className="small-input" inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <div className="row between total"><span>Total</span><span>{brl(due)}</span></div>
        </div>
        <button className="primary big" disabled={cart.length === 0 || readOnly} onClick={() => setPaying(true)}>
          Pagar {due > 0 ? brl(due) : ''}
        </button>
      </section>

      {scanning && <BarcodeScanner onCode={onCamera} onClose={() => setScanning(false)} />}

      {paying && (
        <PaymentFlow
          cart={cart}
          discountCents={discountCents}
          dueCents={due}
          storeId={cash.session!.storeId}
          onClose={() => setPaying(false)}
          onFinished={finished}
        />
      )}
      {done && (
        <div className="modal"><div className="card">
          <h2>Venda #{done.sale.number} concluída ✅</h2>
          {me.tenant.fiscalEnabled && <FiscalStatus saleId={done.sale.id} />}
          <pre className="receipt">{done.receipt}</pre>
          <div className="row gap">
            <button onClick={() => window.print()}>Imprimir</button>
            <button className="primary" onClick={() => { setDone(null); input.current?.focus(); }}>Nova venda</button>
          </div>
        </div></div>
      )}
      {showCash && <CashPanel me={me} onClose={() => setShowCash(false)} reload={reloadCash} />}
    </main>
  );
}

function CashPanel({ me, onClose, reload }: { me: Me; onClose: () => void; reload: () => void }) {
  const [type, setType] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [value, setValue] = useState('');
  const [counted, setCounted] = useState('');
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');

  const move = async () => {
    const cents = parseMoney(value);
    if (!cents) return setErr('Valor inválido');
    try {
      await api('/cash/movements', { method: 'POST', body: { type, amountCents: cents } });
      setInfo(`${type === 'SANGRIA' ? 'Sangria' : 'Suprimento'} de ${brl(cents)} registrado`);
      setErr('');
      setValue('');
      reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const close = async () => {
    const cents = parseMoney(counted);
    if (cents === null) return setErr('Informe o valor contado');
    try {
      const r = await api<{ differenceCents: number }>('/cash/close', { method: 'POST', body: { countedCents: cents } });
      setInfo(r.differenceCents === 0 ? 'Caixa fechado sem diferença.' : `Caixa fechado. Diferença: ${brl(r.differenceCents)}`);
      setErr('');
      reload();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="modal"><div className="card">
      <h2>Caixa — {me.user.name}</h2>
      <div className="row gap">
        <select value={type} onChange={(e) => setType(e.target.value as 'SANGRIA' | 'SUPRIMENTO')}>
          <option value="SANGRIA">Sangria (retirada)</option>
          <option value="SUPRIMENTO">Suprimento (reforço)</option>
        </select>
        <input inputMode="decimal" placeholder="Valor" value={value} onChange={(e) => setValue(e.target.value)} />
        <button onClick={move}>Registrar</button>
      </div>
      <hr />
      <label>Fechar caixa — dinheiro contado (R$)
        <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
      </label>
      <button onClick={close}>Fechar caixa</button>
      {info && <div className="banner info">{info}</div>}
      {err && <div className="error">{err}</div>}
      <button className="link" onClick={onClose}>Voltar</button>
    </div></div>
  );
}


/** Acompanha a NFC-e da venda: emitindo → autorizada (link do cupom) ou recusada (com o motivo e botão de reenviar). */
function FiscalStatus({ saleId }: { saleId: string }) {
  const [doc, setDoc] = useState<FiscalDoc>({ status: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stop = false;
    let tries = 0;
    const tick = async () => {
      try {
        const d = await api<FiscalDoc>(`/fiscal/sales/${saleId}`);
        if (stop) return;
        setDoc(d);
        const final = d.status && d.status !== 'PROCESSING';
        if (final || ++tries > 20) return; // ~40 s
      } catch { /* tenta de novo */ }
      setTimeout(tick, 2000);
    };
    void tick();
    return () => { stop = true; };
  }, [saleId]);

  const resend = async () => {
    setBusy(true); setErr('');
    try { setDoc(await api<FiscalDoc>(`/fiscal/sales/${saleId}/emit`, { method: 'POST' })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const st = doc.status;
  return (
    <div className="fiscal">
      {(st === null || st === 'PROCESSING') && <span>Emitindo NFC-e…</span>}
      {st === 'AUTHORIZED' && (
        <span>NFC-e nº {doc.number} série {doc.series} autorizada ✅{' '}
          {doc.danfeUrl && <a href={doc.danfeUrl} target="_blank" rel="noreferrer">Abrir cupom fiscal</a>}</span>
      )}
      {(st === 'REJECTED' || st === 'ERROR' || st === 'DENIED') && (
        <>
          <span className="error">NFC-e não emitida: {doc.message ?? 'erro desconhecido'}</span>
          <button disabled={busy} onClick={resend}>Reenviar nota</button>
        </>
      )}
      {st === 'CANCELED' && <span>NFC-e cancelada.</span>}
      {err && <span className="error">{err}</span>}
    </div>
  );
}
