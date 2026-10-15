import { AccessLevel } from './access';

/**
 * Cache curto (30 s) do nível de acesso por tenant, para não consultar o banco a cada requisição.
 * É local ao processo: com várias instâncias da API, uma mudança pode levar até 30 s para valer em todas.
 */
class AccessCache {
  private map = new Map<string, { level: AccessLevel; until: number }>();

  get(tenantId: string): AccessLevel | undefined {
    const hit = this.map.get(tenantId);
    return hit && hit.until > Date.now() ? hit.level : undefined;
  }
  set(tenantId: string, level: AccessLevel, ttlMs = 30_000) {
    this.map.set(tenantId, { level, until: Date.now() + ttlMs });
  }
  invalidate(tenantId: string) {
    this.map.delete(tenantId);
  }
  clear() {
    this.map.clear();
  }
}

export const accessCache = new AccessCache();
