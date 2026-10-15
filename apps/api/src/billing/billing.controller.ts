import { Body, Controller, Get, Headers, HttpCode, Logger, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { verifyMercadoPagoSignature } from '../payments/webhook-signature';
import { IsString } from 'class-validator';
import { AllowWhenBlocked, CurrentUser, Public, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { BillingService } from './billing.service';

class ChangePlanDto {
  @IsString() planCode: string;
}

@Controller('billing')
export class BillingController {
  private readonly log = new Logger(BillingController.name);

  constructor(private billing: BillingService) {}

  @Public() @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @AllowWhenBlocked() @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.billing.status(u.tenantId);
  }

  @AllowWhenBlocked() @Roles('OWNER') @Post('plan')
  changePlan(@CurrentUser() u: AuthUser, @Body() dto: ChangePlanDto) {
    return this.billing.changePlan(u.tenantId, dto.planCode);
  }

  /** Gera o PIX da mensalidade. Liberado mesmo com a conta bloqueada, para o dono conseguir regularizar. */
  @AllowWhenBlocked() @Roles('OWNER') @Post('checkout')
  checkout(@CurrentUser() u: AuthUser) {
    return this.billing.checkout(u.tenantId);
  }

  @AllowWhenBlocked() @Roles('OWNER') @Get('invoices/:id')
  invoice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.billing.invoiceStatus(u.tenantId, id);
  }

  /** Webhook do Mercado Pago (conta da plataforma). Exige x-signature quando há segredo configurado. */
  @Public() @HttpCode(200) @Post('webhook/mercadopago')
  async webhook(
    @Body() body: any,
    @Query() query: Record<string, string>,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    const dataId = String(query['data.id'] ?? body?.data?.id ?? '');
    const secret = process.env.BILLING_MP_WEBHOOK_SECRET ?? process.env.MP_WEBHOOK_SECRET;
    if (secret) {
      if (!verifyMercadoPagoSignature({ secret, xSignature, xRequestId, dataId })) throw new UnauthorizedException('Assinatura inválida');
    } else {
      this.log.warn('Segredo do webhook de cobrança não definido: aceito sem validar assinatura');
    }
    const type = String(body?.type ?? query['type'] ?? '');
    if (!dataId || (type && !type.startsWith('payment'))) return { handled: false };
    return this.billing.handleNotification(dataId);
  }
}
