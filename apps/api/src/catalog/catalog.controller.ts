import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { CatalogService } from './catalog.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto, UpdateVariantDto, VariantDto } from './catalog.dto';

@Controller()
export class CatalogController {
  constructor(private catalog: CatalogService, private barcodes: BarcodeLookupService) {}

  @Get('categories') categories(@CurrentUser() u: AuthUser) {
    return this.catalog.categories(u.tenantId);
  }

  @Roles('OWNER', 'MANAGER') @Post('categories')
  createCategory(@CurrentUser() u: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(u.tenantId, dto);
  }

  /** Dados públicos do produto pelo código de barras, para pré-preencher o cadastro (o usuário confere antes de salvar). */
  @Roles('OWNER', 'MANAGER') @Get('barcode-info')
  async barcodeInfo(@CurrentUser() u: AuthUser, @Query('code') code = '') {
    const gtin = code.replace(/\D/g, '');
    const exists = gtin ? await this.catalog.lookup(u.tenantId, gtin).then(() => true, () => false) : false;
    if (exists) return { found: false, gtin, alreadyRegistered: true };
    return this.barcodes.lookup(gtin);
  }

  @Get('products')
  list(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('page') page?: string) {
    return this.catalog.listProducts(u.tenantId, q, page ? Math.max(1, Number(page)) : 1);
  }

  @Get('products/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.catalog.getProduct(u.tenantId, id);
  }

  @Roles('OWNER', 'MANAGER') @Post('products')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateProductDto) {
    return this.catalog.createProduct(u.tenantId, dto);
  }

  @Roles('OWNER', 'MANAGER') @Patch('products/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(u.tenantId, id, dto);
  }

  @Roles('OWNER', 'MANAGER') @Post('products/:id/variants')
  addVariant(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: VariantDto) {
    return this.catalog.addVariant(u.tenantId, id, dto);
  }

  @Roles('OWNER', 'MANAGER') @Patch('variants/:id')
  updateVariant(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.catalog.updateVariant(u.tenantId, id, dto);
  }

  @Get('variants/lookup') lookup(@CurrentUser() u: AuthUser, @Query('code') code: string) {
    return this.catalog.lookup(u.tenantId, code);
  }

  @Get('variants/search') search(@CurrentUser() u: AuthUser, @Query('q') q = '') {
    return this.catalog.searchVariants(u.tenantId, q);
  }
}
