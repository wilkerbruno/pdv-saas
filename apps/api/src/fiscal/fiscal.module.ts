import { Global, Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { FocusNfeProvider } from './focusnfe.provider';

@Global()
@Module({ controllers: [FiscalController], providers: [FiscalService, FocusNfeProvider], exports: [FiscalService] })
export class FiscalModule {}
