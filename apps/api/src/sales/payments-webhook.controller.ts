import { Body, Controller, Headers, HttpCode, Logger, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../common/decorators';
import { verifyMercadoPagoSignature } from '../payments/webhook-signature';
import { SalesService } from './sales.service';

/**
 * Notificações do Mercado Pago. O corpo NÃO é confiável: usamos só o id e consultamos o status
 * na API do Mercado Pago com o token da loja dona do pagamento.
 * Configure MP_WEBHOOK_SECRET (assinatura secreta do app) para exigir x-signature válido.
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  private readonly log = new Logger(PaymentsWebhookController.name);

  constructor(private sales: SalesService) {}

  @Public() @HttpCode(200) @Post('mercadopago')
  async mercadopago(
    @Body() body: any,
    @Query() query: Record<string, string>,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    const dataId = String(query['data.id'] ?? body?.data?.id ?? '');
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (secret) {
      if (!verifyMercadoPagoSignature({ secret, xSignature, xRequestId, dataId })) {
        throw new UnauthorizedException('Assinatura inválida');
      }
    } else {
      this.log.warn('MP_WEBHOOK_SECRET não definido: webhook aceito sem validar assinatura');
    }
    if (!dataId) return { handled: false };

    const type = String(body?.type ?? query['type'] ?? '');
    // "order" (Point) e "payment" (PIX) são os dois tipos que usamos.
    if (type && type !== 'order' && type !== 'payment' && !type.startsWith('order') && !type.startsWith('payment')) {
      return { handled: false };
    }
    return this.sales.handleProviderNotification(dataId);
  }
}
