import { Injectable, Logger } from '@nestjs/common';
import { BarcodeInfo, isValidGtin, parseCosmos, parseOpenFacts } from './barcode-lookup';

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

  /** Fontes: Cosmos Bluesoft (precisa de COSMOS_API_TOKEN; melhor base de GTIN do Brasil, traz NCM) e Open *Facts (grátis). */
  async lookup(rawCode: string): Promise<BarcodeInfo> {
    const gtin = rawCode.replace(/\D/g, '');
    if (!isValidGtin(gtin)) return { found: false, gtin };
    const hit = this.cache.get(gtin);
    if (hit && hit.until > Date.now()) return hit.info;

    let info: BarcodeInfo = { found: false, gtin };
    let transientFail = false;

    const token = process.env.COSMOS_API_TOKEN;
    if (token) {
      const r = await this.get(`https://api.cosmos.bluesoft.com.br/gtins/${gtin}.json`, { 'X-Cosmos-Token': token, 'User-Agent': 'Cosmos-API-Request' });
      if (r.ok) info = parseCosmos(gtin, r.json);
      else if (r.status !== 404) transientFail = true;
    }
    for (const [source, host] of OPEN_HOSTS) {
      if (info.found) break;
      const r = await this.get(`https://${host}/api/v2/product/${gtin}.json?fields=product_name,product_name_pt,brands,quantity,image_front_small_url,image_front_url`, { 'User-Agent': UA });
      if (r.ok) info = parseOpenFacts(gtin, source, r.json);
      else if (r.status !== 404) transientFail = true;
    }
    // Falha de rede não é cacheada como "não existe".
    if (info.found || !transientFail) this.cache.set(gtin, { until: Date.now() + (info.found ? 24 : 1) * 3_600_000, info });
    return info;
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
