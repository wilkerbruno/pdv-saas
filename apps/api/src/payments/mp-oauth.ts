import { createHash, randomBytes } from 'crypto';

// OAuth do Mercado Pago (Authorization Code + PKCE).
// Doc: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation
//  - code vale 10 min; access token vale 180 dias (expires_in = 15552000 s); renovação por refresh_token.

export const MP_AUTH_URL = 'https://auth.mercadopago.com.br/authorization';
export const MP_TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface MpOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pkce: boolean;
}

/** Lê a configuração do ambiente; null quando o OAuth não está configurado (a loja usa o token manual). */
export function mpOAuthConfig(env: NodeJS.ProcessEnv = process.env): MpOAuthConfig | null {
  const clientId = env.MP_CLIENT_ID;
  const clientSecret = env.MP_CLIENT_SECRET;
  const base = env.PUBLIC_API_URL;
  const redirectUri = env.MP_REDIRECT_URI ?? (base ? `${base.replace(/\/$/, '')}/integrations/mercadopago/oauth/callback` : '');
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri, pkce: (env.MP_OAUTH_PKCE ?? 'true') !== 'false' };
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newState(): string {
  return b64url(randomBytes(24));
}

/** Par PKCE: verifier (43–128 caracteres) e challenge S256 = BASE64URL(SHA256(verifier)). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48)); // 64 caracteres
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function buildAuthorizationUrl(cfg: MpOAuthConfig, state: string, challenge?: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: cfg.redirectUri,
  });
  if (cfg.pkce && challenge) {
    q.set('code_challenge', challenge);
    q.set('code_challenge_method', 'S256');
  }
  return `${MP_AUTH_URL}?${q.toString()}`;
}

export interface MpTokens {
  accessToken: string;
  refreshToken: string | null;
  userId: string | null;
  expiresAt: Date;
  scope: string | null;
}

/** Converte a resposta de /oauth/token. Sem expires_in, assume os 180 dias padrão. */
export function parseTokenResponse(json: any, now: Date = new Date()): MpTokens {
  if (!json || typeof json.access_token !== 'string') throw new Error('Resposta de OAuth sem access_token');
  const seconds = Number(json.expires_in) > 0 ? Number(json.expires_in) : 15552000;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    userId: json.user_id != null ? String(json.user_id) : null,
    expiresAt: new Date(now.getTime() + seconds * 1000),
    scope: typeof json.scope === 'string' ? json.scope : null,
  };
}

/** Renova com folga: a partir de 7 dias antes do vencimento. */
export function shouldRefresh(expiresAt: Date | null | undefined, now: Date = new Date(), marginDays = 7): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - now.getTime() <= marginDays * 24 * 60 * 60 * 1000;
}
