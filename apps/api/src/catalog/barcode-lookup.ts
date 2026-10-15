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
