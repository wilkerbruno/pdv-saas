import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { decrypt } from '../common/crypto';
import { InstallmentPolicyInput, listInstallmentOptions } from '../common/money';
import { ProviderCodeName } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoOAuthService } from './mp-oauth.service';
import { shouldRefresh } from './mp-oauth';
import { PaymentProviderRegistry } from './providers/registry';
import { PaymentProvider, ProviderCredentials } from './providers/types';

export interface PolicyUpdate {
  maxInstallments?: number;
  freeInstallments?: number;
  monthlyRateBps?: number;
  minInstallmentCents?: number;
  customerPaysInterest?: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private registry: PaymentProviderRegistry,
    private mpOAuth: MercadoPagoOAuthService,
  ) {}

  async policy(tenantId: string): Promise<InstallmentPolicyInput> {
    const p = await this.prisma.installmentPolicy.upsert({ where: { tenantId }, update: {}, create: { tenantId } });
    return {
      maxInstallments: p.maxInstallments,
      freeInstallments: p.freeInstallments,
      monthlyRateBps: p.monthlyRateBps,
      minInstallmentCents: p.minInstallmentCents,
      customerPaysInterest: p.customerPaysInterest,
    };
  }

  updatePolicy(tenantId: string, data: PolicyUpdate) {
    return this.prisma.installmentPolicy.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });
  }

  /** Opções de parcelamento (já com juros) para o valor informado. */
  async quote(tenantId: string, amountCents: number) {
    return listInstallmentOptions(amountCents, await this.policy(tenantId));
  }

  provider(code: ProviderCodeName): PaymentProvider {
    return this.registry.get(code);
  }

  /** Credenciais da loja para um adquirente; null para provedores que não precisam (manual). */
  async credentials(tenantId: string, code: ProviderCodeName): Promise<ProviderCredentials | null> {
    const provider = this.registry.get(code);
    if (!provider.requiresIntegration) return null;
    const where = { tenantId_provider: { tenantId, provider: code } };
    let integ = await this.prisma.paymentIntegration.findUnique({ where });
    if (!integ || !integ.active) {
      throw new ConflictException('Esta forma de pagamento não está conectada. Configure em Integrações.');
    }

    // Conexão por OAuth: renova o token perto do vencimento, sem o lojista perceber.
    if (integ.refreshToken && shouldRefresh(integ.expiresAt)) {
      try {
        await this.mpOAuth.refresh(tenantId);
        integ = (await this.prisma.paymentIntegration.findUnique({ where })) ?? integ;
      } catch (e) {
        const expired = !integ.expiresAt || integ.expiresAt.getTime() <= Date.now();
        this.log.warn(`Falha ao renovar token do Mercado Pago (loja ${tenantId}): ${(e as Error).message}`);
        if (expired) {
          await this.mpOAuth.deactivate(tenantId);
          throw new ConflictException('A conexão com o Mercado Pago expirou. Reconecte em Integrações.');
        }
        // ainda válido: segue com o token atual e tenta renovar na próxima vez
      }
    }
    return { accessToken: decrypt(integ.accessToken), accountRef: integ.accountRef, deviceId: integ.deviceId };
  }
}
