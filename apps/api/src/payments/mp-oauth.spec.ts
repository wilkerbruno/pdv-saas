import { createHash } from 'crypto';
import { MercadoPagoOAuthService } from './mp-oauth.service';
import { buildAuthorizationUrl, mpOAuthConfig, newState, parseTokenResponse, pkcePair, shouldRefresh } from './mp-oauth';
import { decrypt } from '../common/crypto';

const cfg = { clientId: '123', clientSecret: 'sec', redirectUri: 'https://api.x.com/integrations/mercadopago/oauth/callback', pkce: true };

describe('helpers do OAuth', () => {
  it('PKCE: challenge é o SHA-256 em base64url do verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    expect(newState()).not.toBe(newState());
  });

  it('monta a URL de autorização com os parâmetros exigidos', () => {
    const u = new URL(buildAuthorizationUrl(cfg, 'st', 'ch'));
    expect(u.origin + u.pathname).toBe('https://auth.mercadopago.com.br/authorization');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '123', response_type: 'code', platform_id: 'mp', state: 'st', redirect_uri: cfg.redirectUri,
      code_challenge: 'ch', code_challenge_method: 'S256',
    });
    expect(new URL(buildAuthorizationUrl({ ...cfg, pkce: false }, 'st', 'ch')).searchParams.has('code_challenge')).toBe(false);
  });

  it('configuração vem do ambiente e deriva a redirect_uri da URL pública', () => {
    expect(mpOAuthConfig({})).toBeNull();
    const c = mpOAuthConfig({ MP_CLIENT_ID: '1', MP_CLIENT_SECRET: 's', PUBLIC_API_URL: 'https://api.x.com/' } as any);
    expect(c?.redirectUri).toBe('https://api.x.com/integrations/mercadopago/oauth/callback');
    expect(c?.pkce).toBe(true);
    expect(mpOAuthConfig({ MP_CLIENT_ID: '1', MP_CLIENT_SECRET: 's', PUBLIC_API_URL: 'x', MP_OAUTH_PKCE: 'false' } as any)?.pkce).toBe(false);
  });

  it('interpreta a resposta de token e calcula a validade', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const t = parseTokenResponse({ access_token: 'AT', refresh_token: 'RT', user_id: 241983636, expires_in: 15552000, scope: 'offline_access read write' }, now);
    expect(t).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', userId: '241983636', scope: 'offline_access read write' });
    expect(t.expiresAt.toISOString()).toBe('2027-04-13T00:00:00.000Z'); // 180 dias
    expect(() => parseTokenResponse({}, now)).toThrow();
  });

  it('renova a partir de 7 dias antes do vencimento', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    expect(shouldRefresh(new Date('2026-10-30T00:00:00Z'), now)).toBe(false);
    expect(shouldRefresh(new Date('2026-10-21T00:00:00Z'), now)).toBe(true);
    expect(shouldRefresh(null, now)).toBe(false);
  });
});

// Serviço com um banco em memória e fetch simulado.
describe('MercadoPagoOAuthService', () => {
  const states = new Map<string, any>();
  const integrations = new Map<string, any>();
  const prisma: any = {
    oAuthState: {
      deleteMany: async ({ where }: any) => {
        if (where.id) return { count: states.delete(where.id) ? 1 : 0 };
        return { count: 0 };
      },
      create: async ({ data }: any) => { states.set(data.id, data); return data; },
      findUnique: async ({ where }: any) => states.get(where.id) ?? null,
    },
    paymentIntegration: {
      upsert: async ({ where, update, create }: any) => {
        const k = `${where.tenantId_provider.tenantId}:${where.tenantId_provider.provider}`;
        integrations.set(k, integrations.has(k) ? { ...integrations.get(k), ...update } : create);
      },
      findUnique: async ({ where }: any) => integrations.get(`${where.tenantId_provider.tenantId}:${where.tenantId_provider.provider}`) ?? null,
    },
  };
  let calls: any[] = [];
  let n = 0; // contador de respostas (não é zerado junto com `calls`)

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'c'.repeat(64);
    Object.assign(process.env, { MP_CLIENT_ID: '123', MP_CLIENT_SECRET: 'sec', PUBLIC_API_URL: 'https://api.x.com' });
    states.clear(); integrations.clear(); calls = []; n = 0;
    jest.spyOn(global, 'fetch').mockImplementation((async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ access_token: 'AT-' + ++n, refresh_token: 'RT-' + n, user_id: 77, expires_in: 15552000 }), { status: 200 });
    }) as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('fluxo completo: start → callback troca o code (com verifier) e salva tokens criptografados nos dois provedores', async () => {
    const svc = new MercadoPagoOAuthService(prisma);
    const { url } = await svc.start('t1');
    const q = new URL(url).searchParams;
    const state = q.get('state')!;
    expect(q.get('code_challenge_method')).toBe('S256');

    expect(await svc.complete('CODE123', state)).toEqual({ tenantId: 't1' });
    expect(calls[0].url).toBe('https://api.mercadopago.com/oauth/token');
    expect(calls[0].body).toMatchObject({ grant_type: 'authorization_code', code: 'CODE123', client_id: '123', client_secret: 'sec', redirect_uri: 'https://api.x.com/integrations/mercadopago/oauth/callback' });
    // o verifier enviado bate com o challenge do link
    const verifier = calls[0].body.code_verifier;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(q.get('code_challenge'));

    for (const p of ['MERCADOPAGO_POINT', 'MERCADOPAGO_PIX']) {
      const row = integrations.get(`t1:${p}`);
      expect(row.accessToken).not.toContain('AT-1');
      expect(decrypt(row.accessToken)).toBe('AT-1');
      expect(decrypt(row.refreshToken)).toBe('RT-1');
      expect(row).toMatchObject({ accountRef: '77', active: true });
    }
  });

  it('state é de uso único e expira', async () => {
    const svc = new MercadoPagoOAuthService(prisma);
    const state = new URL((await svc.start('t1')).url).searchParams.get('state')!;
    await svc.complete('C', state);
    await expect(svc.complete('C', state)).rejects.toThrow(/inválida|expirada/);
    await expect(svc.complete('C', 'inexistente')).rejects.toThrow();

    const s2 = new URL((await svc.start('t1')).url).searchParams.get('state')!;
    states.get(s2).expiresAt = new Date(Date.now() - 1000);
    await expect(svc.complete('C', s2)).rejects.toThrow(/expirada/);
  });

  it('renovação usa o refresh_token e atualiza os tokens; chamadas simultâneas viram uma só', async () => {
    const svc = new MercadoPagoOAuthService(prisma);
    const state = new URL((await svc.start('t1')).url).searchParams.get('state')!;
    await svc.complete('C', state);
    calls = [];
    await Promise.all([svc.refresh('t1'), svc.refresh('t1'), svc.refresh('t1')]);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT-1' });
    expect(decrypt(integrations.get('t1:MERCADOPAGO_POINT').accessToken)).toBe('AT-2');
  });

  it('sem configuração no servidor, start informa o problema', async () => {
    delete process.env.MP_CLIENT_ID;
    await expect(new MercadoPagoOAuthService(prisma).start('t1')).rejects.toThrow(/não está configurado/);
  });
});
