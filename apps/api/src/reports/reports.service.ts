import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { summarize } from './summarize';

const MAX_DAYS = 92;
const TZ_OFFSET_MIN = -180; // America/Sao_Paulo (sem horário de verão desde 2019)

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** from/to no formato YYYY-MM-DD (dias inclusivos, no fuso de Brasília). */
  async summary(tenantId: string, from: string, to: string) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(from) || !re.test(to)) throw new BadRequestException('Use datas no formato AAAA-MM-DD');
    const start = new Date(new Date(`${from}T00:00:00.000Z`).getTime() - TZ_OFFSET_MIN * 60_000);
    const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() - TZ_OFFSET_MIN * 60_000 + 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new BadRequestException('Período inválido');
    if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_DAYS) throw new BadRequestException(`Período máximo de ${MAX_DAYS} dias`);

    const sales = await this.prisma.sale.findMany({
      where: { tenantId, status: 'PAID', paidAt: { gte: start, lt: end } },
      select: {
        createdAt: true, paidAt: true, totalCents: true, discountCents: true, interestCents: true,
        items: { select: { description: true, qty: true, totalCents: true } },
        payments: { select: { method: true, status: true, principalCents: true, interestCents: true, totalCents: true } },
      },
    });
    return { from, to, ...summarize(sales, TZ_OFFSET_MIN) };
  }
}
