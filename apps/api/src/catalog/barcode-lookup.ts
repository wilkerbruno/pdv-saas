// Consulta de dados de produto por código de barras (GTIN/EAN) em bases públicas.
// Nunca inventa dados: se nenhuma fonte confirmar o código, devolve found=false.

export interface BarcodeInfo {
  found: boolean;
  source?: 'cosmos' | 'si5' | 'upcitemdb' | 'openfoodfacts' | 'openbeautyfacts' | 'openproductsfacts';
  gtin: string;
  name?: string;
  brand?: string;
  ncm?: string;
  imageUrl?: string;
  avgPriceCents?: number;
  /** Diagnóstico para a tela: por que não achou (token ausente, falha de rede, não consta nas bases). */
  notes?: string[];
}

/** Valida tamanho (8, 12, 13 ou 14) e dígito verificador GS1. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()) : s);

export function parseCosmos(gtin: string, j: any): BarcodeInfo {
  const name = clean(j?.description);
  if (!name) return { found: false, gtin };
  const ncm = clean(j?.ncm?.code).replace(/\D/g, '');
  const avg = typeof j?.avg_price === 'number' && j.avg_price > 0 ? Math.round(j.avg_price * 100) : undefined;
  return {
    found: true, source: 'cosmos', gtin,
    name: titleCase(name),
    brand: clean(j?.brand?.name) || undefined,
    ncm: ncm.length === 8 ? ncm : undefined,
    imageUrl: clean(j?.thumbnail) || undefined,
    avgPriceCents: avg,
  };
}

export function parseOpenFacts(gtin: string, source: BarcodeInfo['source'], j: any): BarcodeInfo {
  const p = j?.product;
  if (j?.status !== 1 || !p) return { found: false, gtin };
  const base = clean(p.product_name_pt) || clean(p.product_name);
  if (!base) return { found: false, gtin };
  const brand = clean(p.brands).split(',')[0]?.trim() || '';
  const qty = clean(p.quantity);
  const parts = [base];
  if (brand && !base.toLowerCase().includes(brand.toLowerCase())) parts.push(brand);
  if (qty && !base.toLowerCase().includes(qty.toLowerCase())) parts.push(qty);
  return {
    found: true, source, gtin, name: titleCase(parts.join(' ')), brand: brand || undefined,
    imageUrl: clean(p.image_front_small_url) || clean(p.image_front_url) || undefined,
  };
}

/** SI5 Global (global.si5.com.br): plano grátis de 100 consultas/dia; traz NCM e CEST. */
export function parseSi5(gtin: string, j: any): BarcodeInfo {
  const base = clean(j?.produto);
  if (!base) return { found: false, gtin };
  const brand = clean(j?.marca);
  const ncm = clean(j?.ncm).replace(/\D/g, '');
  const name = brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${base} ${brand}` : base;
  const price = typeof j?.preco_medio === 'number' && j.preco_medio > 0 ? Math.round(j.preco_medio * 100) : undefined;
  return {
    found: true, source: 'si5', gtin, name: titleCase(name), brand: brand || undefined,
    ncm: ncm.length === 8 ? ncm : undefined, imageUrl: clean(j?.imagem_url) || undefined, avgPriceCents: price,
  };
}

/** UPCitemdb (plano de teste, sem chave): cobertura internacional, pouca coisa brasileira. */
export function parseUpcItemDb(gtin: string, j: any): BarcodeInfo {
  const it = j?.code === 'OK' && Array.isArray(j.items) ? j.items[0] : null;
  const name = clean(it?.title);
  if (!name) return { found: false, gtin };
  return {
    found: true, source: 'upcitemdb', gtin, name: titleCase(name), brand: clean(it.brand) || undefined,
    imageUrl: (Array.isArray(it.images) && typeof it.images[0] === 'string' ? it.images[0] : '') || undefined,
  };
}

export const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Só https e nunca endereços locais/privados (evita que uma resposta externa faça o servidor acessar a rede interna). */
export function isSafeImageUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (h.includes(':') || h.startsWith('[')) return false; // IPv6 literal
  return true;
}

/** Aceita só JPEG/PNG/WEBP/GIF (nunca SVG) dentro do limite de tamanho; confere a assinatura do arquivo. */
export function checkImage(mime: string, bytes: Uint8Array): string | null {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (!IMAGE_MIMES.includes(m) || bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) return null;
  const hex = Buffer.from(bytes.slice(0, 12)).toString('hex');
  const ok =
    (m === 'image/jpeg' && hex.startsWith('ffd8ff')) ||
    (m === 'image/png' && hex.startsWith('89504e47')) ||
    (m === 'image/gif' && hex.startsWith('47494638')) ||
    (m === 'image/webp' && hex.startsWith('52494646') && hex.slice(16, 24) === '57454250');
  return ok ? m : null;
}
