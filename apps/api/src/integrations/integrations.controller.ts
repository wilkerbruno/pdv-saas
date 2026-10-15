import { BadRequestException, Body, Controller, Delete, Get, Logger, Post, Put, Query, Redirect } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { encrypt } from '../common/crypto';
import { AuthUser, ProviderCodeName } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoOAuthService } from '../payments/mp-oauth.service';
import { PaymentsService } from '../payments/payments.service';
import { httpJson } from '../payments/providers/http';

const MP = 'https://api.mercadopago.com';
const MP_PROVIDERS: ProviderCodeName[] = ['MERCADOPAGO_POINT', 'MERCADOPAGO_PIX'];

class ConnectMercadoPagoDto {
  /** Access Token de produção da conta Mercado Pago da loja. (OAuth virá numa próxima etapa.) */
  @IsString() @MinLength(20) accessToken: string;
  @IsOptional() @IsString() deviceId?: string;
}

class DeviceDto {
  @IsString() deviceId: string;
}

@Controller('integrations')
export class IntegrationsController {
  private readonly log = new Logger(IntegrationsController.name);

  constructor(private prisma: PrismaService, private payments: PaymentsService, private oauth: MercadoPagoOAuthService) {}

  /** Situação da conexão com o Mercado Pago (para a tela de configurações). */
  @Roles('OWNER', 'MANAGER') @Get('mercadopago/status')
  mpStatus(@CurrentUser() u: AuthUser) {
    return this.oauth.status(u.tenantId);
  }

  /** Inicia a conexão por OAuth: devolve o link para o lojista autorizar no Mercado Pago. */
  @Roles('OWNER') @Get('mercadopago/oauth/start')
  oauthStart(@CurrentUser() u: AuthUser) {
    return this.oauth.start(u.tenantId);
  }

  /** Retorno do Mercado Pago (redirect do navegador do lojista). Sem login: a identidade vem do `state` de uso único. */
  @Public() @Get('mercadopago/oauth/callback') @Redirect()
  async oauthCallback(@Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    const web = (process.env.WEB_URL ?? process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    try {
      if (error || !code || !state) throw new BadRequestException(error ?? 'Retorno incompleto');
      await this.oauth.complete(code, state);
      return { url: `${web}/?mp=connected`, statusCode: 302 };
    } catch (e) {
      this.log.warn(`OAuth Mercado Pago falhou: ${(e as Error).message}`);
      return { url: `${web}/?mp=error`, statusCode: 302 };
    }
  }

  /** Lista as conexões da loja, sem expor tokens. */
  @Roles('OWNER', 'MANAGER') @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.paymentIntegration.findMany({
      where: { tenantId: u.tenantId },
      select: { provider: true, accountRef: true, deviceId: true, active: true, createdAt: true },
    });
  }

  /** Conecta a conta Mercado Pago da loja (vale para Point e PIX). Valida o token antes de salvar. */
  @Roles('OWNER') @Put('mercadopago')
  async connect(@CurrentUser() u: AuthUser, @Body() dto: ConnectMercadoPagoDto) {
    const me = await httpJson(`${MP}/users/me`, { headers: { Authorization: `Bearer ${dto.accessToken}` } }).catch(() => {
      throw new BadRequestException('Access Token inválido');
    });
    const accessToken = encrypt(dto.accessToken);
    for (const provider of MP_PROVIDERS) {
      await this.prisma.paymentIntegration.upsert({
        where: { tenantId_provider: { tenantId: u.tenantId, provider } },
        update: { accessToken, refreshToken: null, expiresAt: null, accountRef: String(me.id), deviceId: dto.deviceId, active: true },
        create: { tenantId: u.tenantId, provider, accessToken, accountRef: String(me.id), deviceId: dto.deviceId },
      });
    }
    return { connected: true, accountRef: String(me.id), nickname: me.nickname };
  }

  /** Maquininhas Point vinculadas à conta. Qualquer operador pode listar, para escolher a máquina na hora de cobrar. */
  @Get('mercadopago/terminals')
  async terminals(@CurrentUser() u: AuthUser) {
    const creds = await this.payments.credentials(u.tenantId, 'MERCADOPAGO_POINT');
    const res = await httpJson(`${MP}/terminals/v1/list`, { headers: { Authorization: `Bearer ${creds!.accessToken}` } });
    return res?.data?.terminals ?? res;
  }

  /** Coloca o terminal em modo PDV (necessário para receber cobranças da API). */
  @Roles('OWNER') @Post('mercadopago/terminals/pdv-mode')
  async pdvMode(@CurrentUser() u: AuthUser, @Body() dto: DeviceDto) {
    const creds = await this.payments.credentials(u.tenantId, 'MERCADOPAGO_POINT');
    return httpJson(`${MP}/terminals/v1/setup`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${creds!.accessToken}` },
      body: { terminals: [{ id: dto.deviceId, operating_mode: 'PDV' }] },
    });
  }

  @Roles('OWNER') @Put('mercadopago/default-terminal')
  async defaultTerminal(@CurrentUser() u: AuthUser, @Body() dto: DeviceDto) {
    await this.prisma.paymentIntegration.updateMany({
      where: { tenantId: u.tenantId, provider: { in: MP_PROVIDERS } },
      data: { deviceId: dto.deviceId },
    });
    return { ok: true };
  }

  @Roles('OWNER') @Delete('mercadopago')
  async disconnect(@CurrentUser() u: AuthUser) {
    await this.prisma.paymentIntegration.deleteMany({ where: { tenantId: u.tenantId, provider: { in: MP_PROVIDERS } } });
    return { ok: true };
  }
}
