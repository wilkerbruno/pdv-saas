import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Tx } from '../prisma/prisma.service';

export type StockOp = 'IN' | 'OUT' | 'ADJUST' | 'SALE' | 'RETURN';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  /**
   * Movimenta o estoque dentro de uma transação. Para saídas, a verificação de saldo é atômica
   * (UPDATE ... WHERE stockQty >= qty), então duas vendas simultâneas não vendem o mesmo item.
   * `ADJUST` define o saldo para `qty` (contagem de inventário).
   */
  async move(
    tx: Tx,
    p: { tenantId: string; variantId: string; type: StockOp; qty: number; reason?: string; saleId?: string; allowNegative?: boolean },
  ) {
    const { tenantId, variantId, type, qty } = p;
    if (!Number.isInteger(qty) || qty < 0 || (type !== 'ADJUST' && qty === 0)) {
      throw new BadRequestException('Quantidade inválida');
    }

    let balance: number;
    if (type === 'ADJUST') {
      const r = await tx.productVariant.updateMany({ where: { id: variantId, tenantId }, data: { stockQty: qty } });
      if (r.count === 0) throw new NotFoundException('Variação não encontrada');
      balance = qty;
    } else if (type === 'OUT' || type === 'SALE') {
      const r = await tx.productVariant.updateMany({
        where: { id: variantId, tenantId, ...(p.allowNegative ? {} : { stockQty: { gte: qty } }) },
        data: { stockQty: { decrement: qty } },
      });
      if (r.count === 0) {
        const exists = await tx.productVariant.findFirst({ where: { id: variantId, tenantId }, select: { id: true } });
        throw exists ? new BadRequestException('Estoque insuficiente') : new NotFoundException('Variação não encontrada');
      }
      balance = (await tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQty: true } }))!.stockQty;
    } else {
      const r = await tx.productVariant.updateMany({ where: { id: variantId, tenantId }, data: { stockQty: { increment: qty } } });
      if (r.count === 0) throw new NotFoundException('Variação não encontrada');
      balance = (await tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQty: true } }))!.stockQty;
    }

    return tx.stockMovement.create({
      data: { tenantId, variantId, type, qty, balance, reason: p.reason, saleId: p.saleId },
    });
  }

  adjust(tenantId: string, variantId: string, type: 'IN' | 'OUT' | 'ADJUST', qty: number, reason?: string) {
    return this.prisma.$transaction((tx: Tx) => this.move(tx, { tenantId, variantId, type, qty, reason }));
  }

  movements(tenantId: string, variantId?: string) {
    return this.prisma.stockMovement.findMany({
      where: { tenantId, ...(variantId ? { variantId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Variações com saldo igual ou abaixo do mínimo. */
  async lowStock(tenantId: string) {
    const rows = (await this.prisma.$queryRaw`
      SELECT id, productId, sku, stockQty, minStock FROM ProductVariant
      WHERE tenantId = ${tenantId} AND active = 1 AND stockQty <= minStock
      ORDER BY stockQty ASC LIMIT 200`) as { id: string; productId: string; sku: string | null; stockQty: number; minStock: number }[];
    return rows;
  }
}
