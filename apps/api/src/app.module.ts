import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard, RolesGuard, SubscriptionGuard } from './common/guards';
import { PrismaModule } from './prisma/prisma.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CatalogModule } from './catalog/catalog.module';
import { StockModule } from './stock/stock.module';
import { CashModule } from './cash/cash.module';
import { CustomersModule } from './customers/customers.module';
import { PaymentsModule } from './payments/payments.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { SalesModule } from './sales/sales.module';
import { ReportsModule } from './reports/reports.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) throw new Error('Defina JWT_SECRET com pelo menos 32 caracteres');
        return { secret, signOptions: { expiresIn: '12h' } };
      },
    }),
    PrismaModule,
    AuthModule,
    BillingModule,
    CatalogModule,
    StockModule,
    CashModule,
    CustomersModule,
    PaymentsModule,
    IntegrationsModule,
    FiscalModule,
    SalesModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [
    // A ordem importa: autentica → checa assinatura → checa perfil.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
