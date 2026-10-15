import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService) {}

  async open(tenantId: string, userId: string, storeId: string, openingCents: number) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId, active: true } });
    if (!store) throw new NotFoundException('Loja não encontrada');
    const existing = await this.prisma.cashSession.findFirst({ where: { tenantId, storeId, openedById: userId, closedAt: null } });
    if (existing) throw new ConflictException('Você já tem um caixa aberto nesta loja');
    return this.prisma.cashSession.create({ data: { tenantId, storeId, openedById: userId, openingCents } });
  }

  current(tenantId: string, userId: string, storeId?: string) {
    return this.prisma.cashSession.findFirst({
      where: { tenantId, openedById: userId, closedAt: null, ...(storeId ? { storeId } : {}) },
      orderBy: { openedAt: 'desc' },
    });
  }

  async requireOpen(tenantId: string, userId: string, storeId?: string) {
    const s = await this.current(tenantId, userId, storeId);
    if (!s) throw new ConflictException('Abra o caixa antes de vender');
    return s;
  }

  async addMovement(tenantId: string, userId: string, type: 'SANGRIA' | 'SUPRIMENTO', amountCents: number, note?: string) {
    const session = await this.requireOpen(tenantId, userId);
    if (type === 'SANGRIA') {
      const { expectedCents } = await this.balance(tenantId, session.id);
      if (amountCents > expectedCents) throw new BadRequestException('Sangria maior que o dinheiro em caixa');
    }
    return this.prisma.cashMovement.create({ data: { cashSessionId: session.id, type, amountCents, note } });
  }

  /** Dinheiro esperado em caixa: abertura + vendas em dinheiro + suprimentos − sangrias. */
  async balance(tenantId: string, cashSessionId: string) {
    const session = await this.prisma.cashSession.findFirst({ where: { id: cashSessionId, tenantId } });
    if (!session) throw new NotFoundException('Caixa não encontrado');

    const [cash, movements] = await Promise.all([
      this.prisma.payment.aggregate({
        _sum: { principalCents: true },
        where: { tenantId, method: 'CASH', status: 'APPROVED', sale: { cashSessionId, status: { not: 'CANCELED' } } },
      }),
      this.prisma.cashMovement.groupBy({ by: ['type'], where: { cashSessionId }, _sum: { amountCents: true } }),
    ]);
    const sum = (t: string) => movements.find((m: { type: string }) => m.type === t)?._sum.amountCents ?? 0;
    const cashSales = cash._sum.principalCents ?? 0;
    const expectedCents = session.openingCents + cashSales + sum('SUPRIMENTO') - sum('SANGRIA');
    return { openingCents: session.openingCents, cashSales, suprimento: sum('SUPRIMENTO'), sangria: sum('SANGRIA'), expectedCents };
  }

  async close(tenantId: string, userId: string, countedCents: number) {
    const session = await this.requireOpen(tenantId, userId);
    const { expectedCents } = await this.balance(tenantId, session.id);
    const pending = await this.prisma.sale.count({ where: { tenantId, cashSessionId: session.id, status: 'PENDING' } });
    if (pending > 0) throw new ConflictException(`Existem ${pending} venda(s) aguardando pagamento neste caixa`);

    const closed = await this.prisma.cashSession.update({
      where: { id: session.id },
      data: { closedAt: new Date(), countedCents, expectedCents },
    });
    return { ...closed, differenceCents: countedCents - expectedCents };
  }
}
