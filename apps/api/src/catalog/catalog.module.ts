import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { BarcodeLookupService } from './barcode-lookup.service';
import { CatalogService } from './catalog.service';

@Module({ controllers: [CatalogController], providers: [CatalogService, BarcodeLookupService], exports: [CatalogService] })
export class CatalogModule {}
