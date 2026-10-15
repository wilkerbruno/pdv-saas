import { Module } from '@nestjs/common';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({ controllers: [SalesController, PaymentsWebhookController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
