import { useCallback, useEffect, useRef, useState } from 'react';
import { api, BASE } from './api';
import { brl, parseMoney } from './money';
import { Variant, describeVariant } from './types';
import { BarcodeScanner } from './BarcodeScanner';

interface Category { id: string; name: string }
interface ProductRow {
  id: string; hasImage?: boolean; name: string; ncm?: string | null; category?: { name: string } | null;
  variants: (Variant & { minStock?: number })[];
}
interface Entry { id: number; name: string; added: number; balance: number }

export function Products() {
  return (
    <main className="settings">
      <QuickEntry />
      <ProductList />
    </main>
  );
}

// ───────────── Entrada rápida: bipa o código, soma 1; código novo abre o cadastro ─────────────

function QuickEntry() {
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('1');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    const n = Math.max(1, parseInt(qty || '1', 10) || 1);
    setBusy(true); setErr('');
    try {
      const r = await api<{ found: boolean; variant?: Variant; added?: number; balance?: number }>('/stock/receive', { method: 'POST', body: { code: c, qty: n } });
      if (r.found && r.variant) {
        setEntries((x) => [{ id: ++seq.current, name: describeVariant(r.variant!), added: r.added!, balance: r.balance! }, ...x].slice(0, 8));
        setCode(''); setQty('1');
      } else {
        setNewCode(c); // não cadastrado: abre o formulário já com o código
      }
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); input.current?.focus(); }
  };

  // Câmera: cada leitura soma a quantidade do campo "Qtd."; código novo fecha a câmera e abre o cadastro.
  const onCamera = async (c: string) => {
    const n = Math.max(1, parseInt(qty || '1', 10) || 1);
    try {
      const r = await api<{ found: boolean; variant?: Variant; added?: number; balance?: number }>('/stock/receive', { method: 'POST', body: { code: c, qty: n } });
      if (r.found && r.variant) {
        const name = describeVariant(r.variant);
        setEntries((x) => [{ id: ++seq.current, name, added: r.added!, balance: r.balance! }, ...x].slice(0, 8));
        setQty('1');
        return `+${r.added} ${name} (estoque ${r.balance})`;
      }
      setScanning(false);
      setNewCode(c);
      return;
    } catch (e) { return (e as Error).message; }
  };

  return (
    <>
      {scanning && <BarcodeScanner onCode={onCamera} onClose={() => setScanning(false)} />}
      <section className="card">
        <h2>Entrada rápida por código de barras</h2>
        <p className="muted small">Bipe o produto: se já estiver cadastrado, soma ao estoque (1 por bipe, ou a quantidade digitada ao lado). Se for novo, abre o cadastro.</p>
        <form className="row gap qeform" onSubmit={submit}>
          <input ref={input} autoFocus className="search" placeholder="Código de barras ou SKU" value={code} onChange={(e) => setCode(e.target.value)} disabled={newCode !== null} />
          <label className="qtybox">Qtd.
            <input type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} disabled={newCode !== null} />
          </label>
          <button className="primary" disabled={busy || newCode !== null}>Adicionar</button>
        </form>
        <button className="cam" disabled={newCode !== null} onClick={() => setScanning(true)}>📷 Ler com a câmera do celular</button>
        {err && <div className="error">{err}</div>}
        {entries.length > 0 && (
          <ul className="results">
            {entries.map((x) => (
              <li key={x.id} className="entry"><span>{x.name}</span><strong>+{x.added}</strong><span className="muted small">estoque {x.balance}</span></li>
            ))}
          </ul>
        )}
        {newCode === null && <button className="link" onClick={() => setNewCode('')}>Cadastrar produto sem código de barras</button>}
      </section>

      {newCode !== null && (
        <NewProduct
          initialCode={newCode}
          onCancel={() => { setNewCode(null); setCode(''); setTimeout(() => input.current?.focus(), 0); }}
          onCreated={(name, stock) => {
            setEntries((x) => [{ id: ++seq.current, name: `${name} (novo)`, added: stock, balance: stock }, ...x].slice(0, 8));
            setNewCode(null); setCode(''); setQty('1');
            setTimeout(() => input.current?.focus(), 0);
          }}
        />
      )}
    </>
  );
}

// ───────────── Cadastro de produto ─────────────

function NewProduct({ initialCode, onCancel, onCreated }: { initialCode: string; onCancel: () => void; onCreated: (name: string, stock: number) => void }) {
  const [f, setF] = useState({ name: '', barcode: initialCode, sku: '', price: '', cost: '', stock: '1', minStock: '0', ncm: '', tamanho: '', cor: '', categoryId: '' });
  const [cats, setCats] = useState<Category[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api<Category[]>('/categories').then(setCats).catch(() => undefined); }, []);
  useEffect(() => { nameRef.current?.focus(); }, [initialCode]);

  // Busca automática dos dados pelo código de barras (só preenche campos ainda vazios).
  const [info, setInfo] = useState<{ state: 'idle' | 'busy' | 'found' | 'none' | 'dup' | 'error'; notes?: string[]; source?: string; imageUrl?: string; imageToken?: string; avg?: number }>({ state: 'idle' });
  const lastLooked = useRef('');
  const lookup = useCallback(async (raw: string) => {
    const code = raw.replace(/\D/g, '');
    if (![8, 12, 13, 14].includes(code.length) || code === lastLooked.current) return;
    lastLooked.current = code;
    setInfo({ state: 'busy' });
    try {
      const r = await api<{ found: boolean; alreadyRegistered?: boolean; source?: string; name?: string; ncm?: string; imageUrl?: string; avgPriceCents?: number; imageToken?: string; notes?: string[] }>(`/barcode-info?code=${code}`);
      if (r.alreadyRegistered) return setInfo({ state: 'dup' });
      if (!r.found) return setInfo({ state: 'none', notes: r.notes });
      setF((cur) => ({ ...cur, name: cur.name.trim() ? cur.name : (r.name ?? ''), ncm: cur.ncm.trim() ? cur.ncm : (r.ncm ?? '') }));
      setInfo({ state: 'found', source: r.source, imageUrl: r.imageUrl, imageToken: r.imageToken, avg: r.avgPriceCents });
    } catch (e) { lastLooked.current = ''; setInfo({ state: 'error', notes: [(e as Error).message] }); }
  }, []);
  useEffect(() => { if (initialCode) void lookup(initialCode); }, [initialCode, lookup]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const price = parseMoney(f.price);
    const cost = f.cost ? parseMoney(f.cost) : 0;
    if (f.name.trim().length < 2) return setErr('Informe o nome do produto');
    if (price === null || price <= 0) return setErr('Informe um preço válido');
    if (cost === null) return setErr('Custo inválido');
    const stock = Math.max(0, parseInt(f.stock || '0', 10) || 0);
    const attributes: Record<string, string> = {};
    if (f.tamanho.trim()) attributes.tamanho = f.tamanho.trim();
    if (f.cor.trim()) attributes.cor = f.cor.trim();
    setBusy(true);
    try {
      await api('/products', { method: 'POST', body: {
        name: f.name.trim(),
        ...(f.categoryId ? { categoryId: f.categoryId } : {}),
        ...(f.ncm.replace(/\D/g, '') ? { ncm: f.ncm.replace(/\D/g, '') } : {}),
        ...(info.state === 'found' && info.imageToken ? { imageToken: info.imageToken } : {}),
        variants: [{
          ...(f.barcode.trim() ? { barcode: f.barcode.trim() } : {}),
          ...(f.sku.trim() ? { sku: f.sku.trim() } : {}),
          ...(Object.keys(attributes).length ? { attributes } : {}),
          priceCents: price, costCents: cost, initialStock: stock, minStock: Math.max(0, parseInt(f.minStock || '0', 10) || 0),
        }],
      } });
      onCreated(f.name.trim(), stock);
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h2>Novo produto</h2>
      <form onSubmit={save} className="settings" style={{ padding: 0 }}>
        <div className="grid2">
          <label>Código de barras
            <input value={f.barcode} onChange={set('barcode')} inputMode="numeric" onBlur={(e) => void lookup(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(f.barcode); nameRef.current?.focus(); } }} />
          </label>
          <label>Nome *<input ref={nameRef} value={f.name} onChange={set('name')}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); priceRef.current?.focus(); } }} /></label>
          <label>Preço de venda (R$) *<input ref={priceRef} inputMode="decimal" value={f.price} onChange={set('price')} placeholder="0,00" /></label>
          <label>Custo (R$)<input inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="0,00" /></label>
          <label>Quantidade em estoque<input type="number" min={0} value={f.stock} onChange={set('stock')} /></label>
          <label>Estoque mínimo<input type="number" min={0} value={f.minStock} onChange={set('minStock')} /></label>
          <label>Tamanho<input value={f.tamanho} onChange={set('tamanho')} placeholder="P, M, G, 38…" /></label>
          <label>Cor<input value={f.cor} onChange={set('cor')} /></label>
          <label>Categoria
            <select value={f.categoryId} onChange={set('categoryId')}>
              <option value="">Sem categoria</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>SKU (opcional)<input value={f.sku} onChange={set('sku')} /></label>
          <label>NCM (para nota fiscal)<input value={f.ncm} onChange={set('ncm')} inputMode="numeric" maxLength={10} placeholder="8 dígitos" /></label>
        </div>
        {info.state === 'busy' && <p className="muted small">Buscando dados do produto…</p>}
        {info.state === 'found' && (
          <div className="row gap small" style={{ alignItems: 'center' }}>
            {info.imageUrl && <img src={info.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8 }} />}
            <span className="muted">Dados preenchidos automaticamente ({({ cosmos: 'Cosmos', si5: 'SI5 Global', upcitemdb: 'UPCitemdb' } as Record<string, string>)[info.source ?? ''] ?? 'Open Food Facts'}). Confira nome e NCM antes de salvar.{info.imageToken ? ' A foto será salva com o produto.' : ''}
              {info.avg ? ` Preço médio de mercado: ${brl(info.avg)}.` : ''}</span>
          </div>
        )}
        {info.state === 'none' && <p className="muted small">Produto não encontrado nas bases públicas. Preencha manualmente.{info.notes?.length ? ` (${info.notes.join('; ')})` : ''}</p>}
        {info.state === 'dup' && <p className="error">Este código já está cadastrado na sua loja.</p>}
        {info.state === 'error' && <p className="muted small">Não foi possível consultar agora. Preencha manualmente. {info.notes?.[0]}</p>}
        {err && <div className="error">{err}</div>}
        <div className="row gap">
          <button className="primary" disabled={busy}>Salvar produto</button>
          <button type="button" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </section>
  );
}

// ───────────── Lista, preço e estoque ─────────────

function ProductList() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: ProductRow[]; total: number }>(`/products?q=${encodeURIComponent(q.trim())}`);
      setItems(r.items); setTotal(r.total); setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <section className="card">
      <div className="row between"><h2>Produtos cadastrados</h2><span className="muted small">{total} itens</span></div>
      <input className="search" placeholder="Buscar por nome ou código" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <div className="error">{err}</div>}
      {items.length === 0 && !err && <p className="muted small">Nenhum produto encontrado.</p>}
      {items.map((p) => (
        <div key={p.id} className="prod">
          {p.hasImage && <img src={`${BASE}/products/${p.id}/image`} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 8, verticalAlign: 'middle', marginRight: 8 }} />}
          <strong>{p.name}</strong>
          {p.category && <span className="muted small"> · {p.category.name}</span>}
          {p.variants.map((v) => <VariantRow key={v.id} v={v} onSaved={load} />)}
        </div>
      ))}
    </section>
  );
}

function VariantRow({ v, onSaved }: { v: Variant; onSaved: () => void }) {
  const [price, setPrice] = useState((v.priceCents / 100).toFixed(2).replace('.', ','));
  const [stock, setStock] = useState(String(v.stockQty));
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = async () => {
    setErr(''); setMsg('');
    const cents = parseMoney(price);
    const st = parseInt(stock, 10);
    if (cents === null || cents <= 0) return setErr('Preço inválido');
    if (!Number.isInteger(st) || st < 0) return setErr('Estoque inválido');
    try {
      if (cents !== v.priceCents) await api(`/variants/${v.id}`, { method: 'PATCH', body: { priceCents: cents } });
      if (st !== v.stockQty) await api('/stock/adjust', { method: 'POST', body: { variantId: v.id, type: 'ADJUST', qty: st, reason: 'Ajuste manual' } });
      setMsg('Salvo'); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };

  const receive = async () => {
    const n = parseInt(add, 10);
    if (!Number.isInteger(n) || n <= 0) return setErr('Informe a quantidade a somar');
    setErr(''); setMsg('');
    try {
      await api('/stock/adjust', { method: 'POST', body: { variantId: v.id, type: 'IN', qty: n, reason: 'Entrada manual' } });
      setAdd(''); setMsg(`+${n}`); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="vrow">
      <div className="vname">
        <span>{v.attributes ? Object.values(v.attributes).join(' / ') : 'Padrão'}</span>
        <span className="muted small">{v.barcode ?? v.sku ?? 'sem código'} · {brl(v.priceCents)}</span>
      </div>
      <label className="qtybox">Preço<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="qtybox">Estoque<input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></label>
      <button onClick={save}>Salvar</button>
      <label className="qtybox">Somar<input type="number" min={1} value={add} onChange={(e) => setAdd(e.target.value)} placeholder="+qtd" /></label>
      <button onClick={receive}>Entrada</button>
      {msg && <span className="muted small">{msg}</span>}
      {err && <span className="error">{err}</span>}
    </div>
  );
}
