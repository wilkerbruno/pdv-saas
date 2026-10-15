import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BarcodeInfo, checkImage, isSafeImageUrl, isValidGtin, parseCosmos, parseOpenFacts, parseSi5, parseUpcItemDb } from './barcode-lookup';

const UA = 'PDV-SaaS/1.0 (cadastro de produtos)';
const OPEN_HOSTS: [NonNullable<BarcodeInfo['source']>, string][] = [
  ['openfoodfacts', 'world.openfoodfacts.org'],
  ['openbeautyfacts', 'world.openbeautyfacts.org'],
  ['openproductsfacts', 'world.openproductsfacts.org'],
];

@Injectable()
export class BarcodeLookupService {
  private log = new Logger(BarcodeLookupService.name);
  private cache = new Map<string, { until: number; info: BarcodeInfo }>();
  /** Fotos já baixadas aguardando o salvamento do produto (token → bytes), 30 min, presas à loja que consultou. */
  private pending = new Map<string, { tenantId: string; mime: string; data: Buffer; until: number }>();

  /** Baixa a foto no servidor e devolve um token para o cadastro anexá-la. O cliente nunca informa URL (sem SSRF). */
  async prepareImage(tenantId: string, imageUrl?: string): Promise<string | undefined> {
    if (!imageUrl || !isSafeImageUrl(imageUrl)) return undefined;
    try {
      const res = await fetch(imageUrl, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (!res.ok || !isSafeImageUrl(res.url || imageUrl)) return undefined;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > 1_500_000) return undefined;
      const data = Buffer.from(await res.arrayBuffer());
      const mime = checkImage(res.headers.get('content-type') ?? '', data);
      if (!mime) return undefined;
      const now = Date.now();
      for (const [k, v] of this.pending) if (v.until < now) this.pending.delete(k);
      if (this.pending.size >= 200) this.pending.delete(this.pending.keys().next().value as string);
      const token = randomBytes(18).toString('hex');
      this.pending.set(token, { tenantId, mime, data, until: now + 30 * 60_000 });
      return token;
    } catch (e) {
      this.log.warn(`Não foi possível baixar a foto do produto: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** Consome o token (uso único) se pertencer à loja. */
  takeImage(tenantId: string, token?: string): { mime: string; data: Buffer } | undefined {
    if (!token) return undefined;
    const hit = this.pending.get(token);
    if (!hit || hit.tenantId !== tenantId || hit.until < Date.now()) return undefined;
    this.pending.delete(token);
    return { mime: hit.mime, data: hit.data };
  }

  /** Fontes, em ordem: Cosmos (COSMOS_API_TOKEN, pago), SI5 Global (SI5_API_TOKEN, grátis 100/dia, traz NCM), Open *Facts e UPCitemdb (sem chave). */
  async lookup(rawCode: string): Promise<BarcodeInfo> {
    const gtin = rawCode.replace(/\D/g, '');
    if (!isValidGtin(gtin)) return { found: false, gtin };
    const hit = this.cache.get(gtin);
    if (hit && hit.until > Date.now()) return hit.info;

    let info: BarcodeInfo = { found: false, gtin };
    let transientFail = false;
    const notes: string[] = [];

    const token = process.env.COSMOS_API_TOKEN;
    if (!token) notes.push('Cosmos não configurado (defina COSMOS_API_TOKEN)');
    if (token) {
      const r = await this.get(`https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`, { 'X-Cosmos-Token': token, 'User-Agent': 'Cosmos-API-Request' });
      if (r.ok) info = parseCosmos(gtin, r.json);
      else if (r.status !== 404) { transientFail = true; notes.push(`Cosmos indisponível (${r.status || 'sem conexão'})`); }
    }
    const si5 = process.env.SI5_API_TOKEN;
    if (!info.found && si5) {
      const r = await this.get(`https://global.si5.com.br/api/produtos/${gtin}`, { Authorization: `Bearer ${si5}`, 'User-Agent': UA });
      if (r.ok) info = parseSi5(gtin, r.json);
      else if (r.status !== 404) { transientFail = true; notes.push(r.status === 429 ? 'SI5: limite diário de consultas atingido' : r.status === 401 ? 'SI5: token inválido' : `SI5 indisponível (${r.status || 'sem conexão'})`); }
    }
    if (!token && !si5) notes.push('Dica: configure SI5_API_TOKEN (grátis, 100 consultas/dia) para achar produtos brasileiros');
    for (const [source, host] of OPEN_HOSTS) {
      if (info.found) break;
      const r = await this.get(`https://${host}/api/v2/product/${gtin}.json?fields=product_name,product_name_pt,brands,quantity,image_front_small_url,image_front_url`, { 'User-Agent': UA });
      if (r.ok) info = parseOpenFacts(gtin, source, r.json);
      else if (r.status !== 404) { transientFail = true; notes.push(`${host} indisponível (${r.status || 'sem conexão'})`); }
    }
    if (!info.found) {
      const r = await this.get(`https://api.upcitemdb.com/prod/trial/lookup?upc=${gtin}`, { Accept: 'application/json', 'User-Agent': UA });
      if (r.ok) info = parseUpcItemDb(gtin, r.json);
      else if (r.status !== 404) { transientFail = true; notes.push(r.status === 429 ? 'UPCitemdb: limite atingido' : `UPCitemdb indisponível (${r.status || 'sem conexão'})`); }
    }
    // Falha de rede não é cacheada como "não existe".
    if (info.found || !transientFail) this.cache.set(gtin, { until: Date.now() + (info.found ? 24 : 1) * 3_600_000, info });
    return info.found ? info : { ...info, notes };
  }

  private async get(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; json?: any }> {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, status: res.status, json: await res.json() };
    } catch (e) {
      this.log.warn(`Consulta de código de barras falhou (${new URL(url).host}): ${(e as Error).message}`);
      return { ok: false, status: 0 };
    }
  }
}
