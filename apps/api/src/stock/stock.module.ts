import { Global, Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Global()
@Module({ controllers: [StockController], providers: [StockService], exports: [StockService] })
export class StockModule {}
