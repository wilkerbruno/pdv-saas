import { useCallback, useEffect, useRef, useState } from 'react';
import { api, BASE } from './api';
import { brl, parseMoney } from './money';
import { Variant, describeVariant } from './types';
import { BarcodeScanner } from './BarcodeScanner';

interface Category { id: string; name: string }
interface ProductRow {
  id: string; hasImage?: boolean; name: string; ncm?: string | null; category?: { name: string } | null;
  variants: (Variant & { minStock?: number; costCents?: number })[];
  categoryId?: string | null;
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
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  useEffect(() => { api<Category[]>('/categories').then(setCats).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: ProductRow[]; total: number }>(`/products?q=${encodeURIComponent(q.trim())}`);
      setItems(r.items); setTotal(r.total); setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  if (editing) return <EditProduct product={editing} cats={cats} onClose={() => { setEditing(null); void load(); }} />;
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
          {!p.hasImage && <span className="pill"> sem foto</span>}
          <button className="link" onClick={() => setEditing(p)}>Editar</button>
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


// ───────────── Edição de produto ─────────────

/** Reduz a foto no navegador (lado maior 800 px, JPEG) antes de enviar. */
async function shrinkImage(file: File): Promise<{ mime: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { mime: 'image/jpeg', data: url.split(',')[1] };
}

interface VForm { id: string; barcode: string; sku: string; price: string; cost: string; minStock: string; tamanho: string; cor: string; attrs: Record<string, string> }

function EditProduct({ product, cats, onClose }: { product: ProductRow; cats: Category[]; onClose: () => void }) {
  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.categoryId ?? '');
  const [ncm, setNcm] = useState(product.ncm ?? '');
  const [vs, setVs] = useState<VForm[]>(product.variants.map((v) => ({
    id: v.id, barcode: v.barcode ?? '', sku: v.sku ?? '',
    price: (v.priceCents / 100).toFixed(2).replace('.', ','), cost: ((v.costCents ?? 0) / 100).toFixed(2).replace('.', ','),
    minStock: String(v.minStock ?? 0), tamanho: v.attributes?.tamanho ?? '', cor: v.attributes?.cor ?? '', attrs: v.attributes ?? {},
  })));
  const [hasImage, setHasImage] = useState(!!product.hasImage);
  const [imgVer, setImgVer] = useState(0);
  const [found, setFound] = useState<{ name?: string; ncm?: string; imageUrl?: string; imageToken?: string; source?: string } | null>(null);
  const [pendingToken, setPendingToken] = useState<string | undefined>();
  const [removeImg, setRemoveImg] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const setV = (i: number, k: keyof VForm, val: string) => setVs((cur) => cur.map((x, j) => (j === i ? { ...x, [k]: val } : x)));

  const searchData = async () => {
    setErr(''); setMsg(''); setFound(null);
    const code = vs.map((v) => v.barcode.replace(/\D/g, '')).find((c) => c.length >= 8);
    if (!code) return setErr('Informe o código de barras da variação para buscar');
    setBusy(true);
    try {
      const r = await api<{ found: boolean; alreadyRegistered?: boolean; notes?: string[]; name?: string; ncm?: string; imageUrl?: string; imageToken?: string; source?: string }>(`/barcode-info?code=${code}&excludeProductId=${product.id}`);
      if (r.alreadyRegistered) setErr('Este código já pertence a OUTRO produto da sua loja.');
      else if (!r.found) setErr(`Não encontrado nas bases públicas.${r.notes?.length ? ' ' + r.notes.join('; ') : ''}`);
      else setFound(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const apply = () => {
    if (!found) return;
    if (found.name) setName(found.name);
    if (found.ncm) setNcm(found.ncm);
    if (found.imageToken) { setPendingToken(found.imageToken); setRemoveImg(false); }
    setFound(null); setMsg('Dados aplicados. Clique em Salvar para gravar.');
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setErr(''); setMsg(''); setBusy(true);
    try {
      const img = await shrinkImage(f);
      await api(`/products/${product.id}/image`, { method: 'POST', body: img });
      setHasImage(true); setPendingToken(undefined); setRemoveImg(false); setImgVer((n) => n + 1); setMsg('Foto enviada.');
    } catch (e) { setErr((e as Error).message || 'Não foi possível enviar a foto'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setErr(''); setMsg('');
    if (name.trim().length < 2) return setErr('Informe o nome do produto');
    const rows = [];
    for (const v of vs) {
      const price = parseMoney(v.price); const cost = v.cost ? parseMoney(v.cost) : 0;
      if (price === null || price <= 0) return setErr('Preço inválido');
      if (cost === null) return setErr('Custo inválido');
      rows.push({ v, price, cost });
    }
    setBusy(true);
    try {
      await api(`/products/${product.id}`, { method: 'PATCH', body: {
        name: name.trim(), ncm: ncm.replace(/\D/g, ''),
        ...(categoryId ? { categoryId } : {}),
        ...(pendingToken ? { imageToken: pendingToken } : {}),
        ...(removeImg ? { removeImage: true } : {}),
      } });
      for (const { v, price, cost } of rows) {
        const attributes: Record<string, string> = { ...v.attrs };
        if (v.tamanho.trim()) attributes.tamanho = v.tamanho.trim(); else delete attributes.tamanho;
        if (v.cor.trim()) attributes.cor = v.cor.trim(); else delete attributes.cor;
        await api(`/variants/${v.id}`, { method: 'PATCH', body: {
          ...(v.barcode.trim() ? { barcode: v.barcode.trim() } : {}),
          ...(v.sku.trim() ? { sku: v.sku.trim() } : {}),
          attributes, priceCents: price, costCents: cost, minStock: Math.max(0, parseInt(v.minStock || '0', 10) || 0),
        } });
      }
      onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const showImg = hasImage && !removeImg && !pendingToken;
  return (
    <section className="card">
      <div className="row between"><h2>Editar produto</h2><button className="link" onClick={onClose}>← Voltar</button></div>
      <div className="row gap" style={{ alignItems: 'center' }}>
        {showImg
          ? <img src={`${BASE}/products/${product.id}/image?v=${imgVer}`} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 10 }} />
          : <div className="muted small" style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', border: '1px dashed var(--line)', borderRadius: 10, textAlign: 'center' }}>{pendingToken ? 'Foto nova ao salvar' : 'Sem foto'}</div>}
        <div className="row gap wrap">
          <label className="link" style={{ cursor: 'pointer' }}>Enviar foto
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {(hasImage || pendingToken) && !removeImg && <button className="link" onClick={() => { setRemoveImg(true); setPendingToken(undefined); }}>Remover foto</button>}
        </div>
      </div>

      <button onClick={searchData} disabled={busy}>🔎 Buscar dados pelo código de barras</button>
      {found && (
        <div className="banner info small">
          Encontrado ({found.source}): <strong>{found.name}</strong>{found.ncm ? ` · NCM ${found.ncm}` : ''}{found.imageToken ? ' · com foto' : ''}
          <div className="row gap"><button className="primary" onClick={apply}>Aplicar</button><button onClick={() => setFound(null)}>Ignorar</button></div>
        </div>
      )}

      <div className="grid2">
        <label>Nome *<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Categoria
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>NCM (nota fiscal)<input value={ncm} onChange={(e) => setNcm(e.target.value)} inputMode="numeric" maxLength={10} placeholder="8 dígitos" /></label>
      </div>

      {vs.map((v, i) => (
        <fieldset key={v.id} className="prod">
          <legend className="muted small">{vs.length > 1 ? `Variação ${i + 1}` : 'Dados de venda'}</legend>
          <div className="grid2">
            <label>Código de barras<input value={v.barcode} inputMode="numeric" onChange={(e) => setV(i, 'barcode', e.target.value)} /></label>
            <label>SKU<input value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value)} /></label>
            <label>Preço de venda (R$)<input inputMode="decimal" value={v.price} onChange={(e) => setV(i, 'price', e.target.value)} /></label>
            <label>Custo (R$)<input inputMode="decimal" value={v.cost} onChange={(e) => setV(i, 'cost', e.target.value)} /></label>
            <label>Estoque mínimo<input type="number" min={0} value={v.minStock} onChange={(e) => setV(i, 'minStock', e.target.value)} /></label>
            <label>Tamanho<input value={v.tamanho} onChange={(e) => setV(i, 'tamanho', e.target.value)} /></label>
            <label>Cor<input value={v.cor} onChange={(e) => setV(i, 'cor', e.target.value)} /></label>
          </div>
        </fieldset>
      ))}
      <p className="muted small">A quantidade em estoque é ajustada na lista (campos Estoque e Somar).</p>
      {msg && <div className="banner info small">{msg}</div>}
      {err && <div className="error">{err}</div>}
      <div className="row gap">
        <button className="primary" disabled={busy} onClick={save}>Salvar alterações</button>
        <button onClick={onClose}>Cancelar</button>
      </div>
    </section>
  );
}
