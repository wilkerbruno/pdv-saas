import { BadRequestException, Injectable } from '@nestjs/common';
import { ProviderCodeName } from '../../common/types';
import { ManualProvider } from './manual.provider';
import { MercadoPagoPixProvider } from './mercadopago-pix.provider';
import { MercadoPagoPointProvider } from './mercadopago-point.provider';
import { PagarmeStoneProvider } from './pagarme-stone.provider';
import { PaymentProvider } from './types';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: Map<ProviderCodeName, PaymentProvider>;

  constructor(
    manual: ManualProvider,
    mpPoint: MercadoPagoPointProvider,
    mpPix: MercadoPagoPixProvider,
    pagarme: PagarmeStoneProvider,
  ) {
    this.providers = new Map<ProviderCodeName, PaymentProvider>(
      [manual, mpPoint, mpPix, pagarme].map((p) => [p.code, p] as [ProviderCodeName, PaymentProvider]),
    );
  }

  get(code: ProviderCodeName): PaymentProvider {
    const p = this.providers.get(code);
    if (!p) throw new BadRequestException(`Provedor de pagamento desconhecido: ${code}`);
    return p;
  }
}
