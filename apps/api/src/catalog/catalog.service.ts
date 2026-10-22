import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { BarcodeLookupService } from './barcode-lookup.service';
import { checkImage } from './barcode-lookup';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto, UpdateVariantDto, VariantDto } from './catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService, private barcodes: BarcodeLookupService) {}

  categories(tenantId: string) {
    return this.prisma.category.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto) {
    const exists = await this.prisma.category.findFirst({ where: { tenantId, name: dto.name } });
    if (exists) throw new ConflictException('Categoria já existe');
    return this.prisma.category.create({ data: { tenantId, name: dto.name } });
  }

  async createProduct(tenantId: string, dto: CreateProductDto) {
    await this.assertUniqueCodes(tenantId, dto.variants);
    return this.prisma.$transaction(async (tx: Tx) => {
      const { variants, imageToken, ...data } = dto;
      const image = this.barcodes.takeImage(tenantId, imageToken);
      const product = await tx.product.create({ data: { tenantId, ...data, hasImage: !!image } });
      if (image) await tx.productImage.create({ data: { productId: product.id, mime: image.mime, data: new Uint8Array(image.data) } });
      for (const v of variants) {
        const variant = await tx.productVariant.create({
          data: {
            tenantId,
            productId: product.id,
            sku: v.sku,
            barcode: v.barcode,
            attributes: v.attributes,
            priceCents: v.priceCents,
            costCents: v.costCents ?? 0,
            minStock: v.minStock ?? 0,
            stockQty: v.initialStock ?? 0,
          },
        });
        if (v.initialStock && v.initialStock > 0) {
          await tx.stockMovement.create({
            data: { tenantId, variantId: variant.id, type: 'IN', qty: v.initialStock, balance: v.initialStock, reason: 'Estoque inicial' },
          });
        }
      }
      return tx.product.findUnique({ where: { id: product.id }, include: { variants: true } });
    });
  }

  async productImage(id: string) {
    const img = await this.prisma.productImage.findUnique({ where: { productId: id } });
    if (!img) throw new NotFoundException('Sem foto');
    return img;
  }

  async listProducts(tenantId: string, q?: string, page = 1, pageSize = 30) {
    const where = {
      tenantId,
      active: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { variants: { some: { OR: [{ barcode: q }, { sku: q }] } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { variants: { where: { active: true } }, category: true },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getProduct(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId }, include: { variants: true, category: true } });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return product;
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.getProduct(tenantId, id);
    const { imageToken, removeImage, ...data } = dto;
    const image = this.barcodes.takeImage(tenantId, imageToken);
    return this.prisma.$transaction(async (tx: Tx) => {
      if (image) {
        await tx.productImage.upsert({
          where: { productId: id },
          create: { productId: id, mime: image.mime, data: new Uint8Array(image.data) },
          update: { mime: image.mime, data: new Uint8Array(image.data) },
        });
        (data as any).hasImage = true;
      } else if (removeImage) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        (data as any).hasImage = false;
      }
      return tx.product.update({ where: { id }, data });
    });
  }

  /** Envio manual de foto (o navegador já reduz a imagem). */
  async setImage(tenantId: string, id: string, mime: string, base64: string) {
    await this.getProduct(tenantId, id);
    const buf = Buffer.from(base64, 'base64');
    const okMime = checkImage(mime, buf);
    if (!okMime) throw new BadRequestException('Imagem inválida: use JPG, PNG, WEBP ou GIF de até 1,5 MB');
    const data = new Uint8Array(buf);
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.productImage.upsert({ where: { productId: id }, create: { productId: id, mime: okMime, data }, update: { mime: okMime, data } });
      await tx.product.update({ where: { id }, data: { hasImage: true } });
    });
    return { ok: true };
  }

  async addVariant(tenantId: string, productId: string, dto: VariantDto) {
    await this.getProduct(tenantId, productId);
    await this.assertUniqueCodes(tenantId, [dto]);
    return this.prisma.$transaction(async (tx: Tx) => {
      const variant = await tx.productVariant.create({
        data: {
          tenantId,
          productId,
          sku: dto.sku,
          barcode: dto.barcode,
          attributes: dto.attributes,
          priceCents: dto.priceCents,
          costCents: dto.costCents ?? 0,
          minStock: dto.minStock ?? 0,
          stockQty: dto.initialStock ?? 0,
        },
      });
      if (dto.initialStock && dto.initialStock > 0) {
        await tx.stockMovement.create({
          data: { tenantId, variantId: variant.id, type: 'IN', qty: dto.initialStock, balance: dto.initialStock, reason: 'Estoque inicial' },
        });
      }
      return variant;
    });
  }

  async updateVariant(tenantId: string, variantId: string, dto: UpdateVariantDto) {
    const current = await this.prisma.productVariant.findFirst({ where: { id: variantId, tenantId } });
    if (!current) throw new NotFoundException('Variação não encontrada');
    await this.assertUniqueCodes(tenantId, [dto], variantId);
    return this.prisma.productVariant.update({ where: { id: variantId }, data: dto });
  }

  /** Leitura de código de barras/SKU no PDV. */
  async lookup(tenantId: string, code: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { tenantId, active: true, OR: [{ barcode: code }, { sku: code }] },
      include: { product: { select: { id: true, name: true } } },
    });
    if (!variant) throw new NotFoundException('Código não encontrado');
    return variant;
  }

  /** Busca por nome para o PDV (retorna variações prontas para entrar no carrinho). */
  searchVariants(tenantId: string, q: string) {
    return this.prisma.productVariant.findMany({
      where: {
        tenantId,
        active: true,
        OR: [{ barcode: q }, { sku: q }, { product: { name: { contains: q } } }],
      },
      include: { product: { select: { id: true, name: true } } },
      take: 30,
    });
  }

  private async assertUniqueCodes(
    tenantId: string,
    variants: { sku?: string; barcode?: string }[],
    ignoreVariantId?: string,
  ) {
    const barcodes = variants.map((v) => v.barcode).filter((x): x is string => !!x);
    const skus = variants.map((v) => v.sku).filter((x): x is string => !!x);
    if (new Set(barcodes).size !== barcodes.length || new Set(skus).size !== skus.length) {
      throw new ConflictException('Código de barras ou SKU repetido na mesma requisição');
    }
    if (barcodes.length === 0 && skus.length === 0) return;
    const clash = await this.prisma.productVariant.findFirst({
      where: {
        tenantId,
        ...(ignoreVariantId ? { id: { not: ignoreVariantId } } : {}),
        OR: [
          ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
          ...(skus.length ? [{ sku: { in: skus } }] : []),
        ],
      },
    });
    if (clash) throw new ConflictException('Código de barras ou SKU já cadastrado');
  }
}
