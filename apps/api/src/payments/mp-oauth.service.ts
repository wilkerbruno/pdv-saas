import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { decrypt, encrypt } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { httpJson } from './providers/http';
import {
  buildAuthorizationUrl, MP_TOKEN_URL, MpOAuthConfig, mpOAuthConfig, MpTokens, newState, parseTokenResponse,
  pkcePair, STATE_TTL_MS,
} from './mp-oauth';

const MP_PROVIDERS = ['MERCADOPAGO_POINT', 'MERCADOPAGO_PIX'] as const;

/** Conecta a conta Mercado Pago de cada loja por OAuth e mantém o token renovado. */
@Injectable()
export class MercadoPagoOAuthService {
  private readonly log = new Logger(MercadoPagoOAuthService.name);
  private refreshing = new Map<string, Promise<void>>();

  constructor(private prisma: PrismaService) {}

  config(): MpOAuthConfig | null {
    return mpOAuthConfig();
  }

  private requireConfig(): MpOAuthConfig {
    const cfg = this.config();
    if (!cfg) throw new ServiceUnavailableException('OAuth do Mercado Pago não está configurado no servidor (MP_CLIENT_ID / MP_CLIENT_SECRET).');
    return cfg;
  }

  /** Passo 1: gera o link de autorização que o lojista abre para entrar na conta Mercado Pago dele. */
  async start(tenantId: string): Promise<{ url: string }> {
    const cfg = this.requireConfig();
    const state = newState();
    const { verifier, challenge } = pkcePair();
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // limpeza
    await this.prisma.oAuthState.create({
      data: { id: state, tenantId, codeVerifier: verifier, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    return { url: buildAuthorizationUrl(cfg, state, challenge) };
  }

  /** Passo 2: o Mercado Pago volta com `code` e `state`; troca o code pelos tokens e salva. */
  async complete(code: string, state: string): Promise<{ tenantId: string }> {
    const cfg = this.requireConfig();
    const row = await this.prisma.oAuthState.findUnique({ where: { id: state } });
    if (!row || row.expiresAt.getTime() < Date.now()) throw new BadRequestException('Autorização expirada ou inválida. Tente conectar novamente.');
    // Uso único: quem consumir primeiro vence.
    const claimed = await this.prisma.oAuthState.deleteMany({ where: { id: state } });
    if (claimed.count === 0) throw new BadRequestException('Autorização já utilizada.');

    const json = await httpJson(MP_TOKEN_URL, {
      method: 'POST',
      body: {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        ...(cfg.pkce ? { code_verifier: row.codeVerifier } : {}),
        test_token: false,
      },
    });
    await this.save(row.tenantId, parseTokenResponse(json));
    return { tenantId: row.tenantId };
  }

  /** Renova o token da loja (uma renovação por vez por loja: o refresh_token é de uso único). */
  refresh(tenantId: string): Promise<void> {
    const running = this.refreshing.get(tenantId);
    if (running) return running;
    const p = this.doRefresh(tenantId).finally(() => this.refreshing.delete(tenantId));
    this.refreshing.set(tenantId, p);
    return p;
  }

  private async doRefresh(tenantId: string): Promise<void> {
    const cfg = this.requireConfig();
    const integ = await this.prisma.paymentIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MERCADOPAGO_POINT' } },
    });
    if (!integ?.refreshToken) return;

    const json = await httpJson(MP_TOKEN_URL, {
      method: 'POST',
      body: {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: decrypt(integ.refreshToken),
        test_token: false,
      },
    });
    await this.save(tenantId, parseTokenResponse(json));
    this.log.log(`Token do Mercado Pago renovado (loja ${tenantId})`);
  }

  /** Grava os tokens (criptografados) para Point e PIX, preservando a maquininha padrão já escolhida. */
  async save(tenantId: string, t: MpTokens) {
    const data = {
      accessToken: encrypt(t.accessToken),
      refreshToken: t.refreshToken ? encrypt(t.refreshToken) : null,
      expiresAt: t.expiresAt,
      scope: t.scope,
      accountRef: t.userId,
      active: true,
    };
    for (const provider of MP_PROVIDERS) {
      await this.prisma.paymentIntegration.upsert({
        where: { tenantId_provider: { tenantId, provider } },
        update: data,
        create: { tenantId, provider, ...data },
      });
    }
  }

  /** Desativa a conexão quando o Mercado Pago recusa a renovação (precisa reconectar). */
  async deactivate(tenantId: string) {
    await this.prisma.paymentIntegration.updateMany({ where: { tenantId, provider: { in: [...MP_PROVIDERS] } }, data: { active: false } });
  }

  async status(tenantId: string) {
    const integ = await this.prisma.paymentIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MERCADOPAGO_POINT' } },
    });
    return {
      oauthAvailable: !!this.config(),
      connected: !!integ?.active,
      needsReconnect: !!integ && !integ.active,
      mode: integ ? (integ.refreshToken ? 'OAUTH' : 'TOKEN') : null,
      accountRef: integ?.accountRef ?? null,
      deviceId: integ?.deviceId ?? null,
      expiresAt: integ?.expiresAt ?? null,
    };
  }
}

export { ConflictException };
