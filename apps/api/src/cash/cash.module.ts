import { Global, Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

@Global()
@Module({ controllers: [CashController], providers: [CashService], exports: [CashService] })
export class CashModule {}
