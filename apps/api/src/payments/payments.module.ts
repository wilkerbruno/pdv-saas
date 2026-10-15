import { Global, Module } from '@nestjs/common';
import { MercadoPagoOAuthService } from './mp-oauth.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ManualProvider } from './providers/manual.provider';
import { MercadoPagoPixProvider } from './providers/mercadopago-pix.provider';
import { MercadoPagoPointProvider } from './providers/mercadopago-point.provider';
import { PagarmeStoneProvider } from './providers/pagarme-stone.provider';
import { PaymentProviderRegistry } from './providers/registry';

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MercadoPagoOAuthService,
    PaymentProviderRegistry,
    ManualProvider,
    MercadoPagoPointProvider,
    MercadoPagoPixProvider,
    PagarmeStoneProvider,
  ],
  exports: [PaymentsService, PaymentProviderRegistry, MercadoPagoOAuthService],
})
export class PaymentsModule {}
