import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { CatalogService } from './catalog.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto, UpdateVariantDto, UploadImageDto, VariantDto } from './catalog.dto';

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
  async barcodeInfo(@CurrentUser() u: AuthUser, @Query('code') code = '', @Query('excludeProductId') excludeProductId?: string) {
    const gtin = code.replace(/\D/g, '');
    const exists = gtin ? await this.catalog.lookup(u.tenantId, gtin).then((v: any) => v.product.id !== excludeProductId, () => false) : false;
    if (exists) return { found: false, gtin, alreadyRegistered: true };
    const info = await this.barcodes.lookup(gtin);
    if (!info.found || !info.imageUrl) return info;
    return { ...info, imageToken: await this.barcodes.prepareImage(u.tenantId, info.imageUrl) };
  }

  /** Foto do produto. Pública porque <img> não envia o token; o id é um cuid imprevisível e a foto não é sensível. */
  @Public() @Get('products/:id/image')
  async image(@Param('id') id: string, @Res({ passthrough: true }) res: any) {
    const img = await this.catalog.productImage(id);
    res.set({
      'Content-Type': img.mime,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(Buffer.from(img.data));
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

  @Roles('OWNER', 'MANAGER') @Post('products/:id/image')
  setImage(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UploadImageDto) {
    return this.catalog.setImage(u.tenantId, id, dto.mime, dto.data);
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
