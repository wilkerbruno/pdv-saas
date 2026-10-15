import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CashService } from '../cash/cash.service';
import { centsToDecimalString } from '../common/money';
import { AuthUser, PaymentStatusName } from '../common/types';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { isValidConsumerDocument } from '../fiscal/documents';
import { AddPaymentDto, CreateSaleDto } from './sales.dto';
import { planPayments, PlannedPayment } from './payment-plan';

interface VariantRow {
  id: string;
  priceCents: number;
  attributes: unknown;
  product: { name: string };
}

interface PaymentRow {
  id: string;
  tenantId: string;
  method: any;
  provider: any;
  status: PaymentStatusName;
  installments: number;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  externalId: string | null;
}

@Injectable()
export class SalesService {
  private readonly log = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private cash: CashService,
    private stock: StockService,
    private payments: PaymentsService,
    private fiscal: FiscalService,
  ) {}

  // ───────────────────────── criar venda ─────────────────────────

  async create(user: AuthUser, dto: CreateSaleDto) {
    const { tenantId } = user;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { allowNegativeStock: true, email: true } });
    if (!tenant) throw new NotFoundException();
    const session = await this.cash.requireOpen(tenantId, user.userId, dto.storeId);

    // Itens: preço sempre vem do banco (o cliente da API não decide o preço).
    const ids = [...new Set(dto.items.map((i) => i.variantId))];
    const variants = (await this.prisma.productVariant.findMany({
      where: { tenantId, id: { in: ids }, active: true },
      include: { product: { select: { name: true } } },
    })) as VariantRow[];
    if (variants.length !== ids.length) throw new BadRequestException('Produto inválido ou inativo');
    const byId = new Map(variants.map((v) => [v.id, v]));

    const items = dto.items.map((i) => {
      const v = byId.get(i.variantId)!;
      const gross = v.priceCents * i.qty;
      const discount = i.discountCents ?? 0;
      if (discount > gross) throw new BadRequestException('Desconto do item maior que o valor do item');
      return {
        variantId: v.id,
        description: describe(v),
        qty: i.qty,
        unitPriceCents: v.priceCents,
        discountCents: discount,
        totalCents: gross - discount,
      };
    });

    const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
    const discountCents = dto.discountCents ?? 0;
    if (discountCents > subtotalCents) throw new BadRequestException('Desconto maior que o total da venda');
    const dueCents = subtotalCents - discountCents;
    if (dueCents <= 0) throw new BadRequestException('Venda sem valor a pagar');
    if (dto.consumerDocument && !isValidConsumerDocument(dto.consumerDocument)) {
      throw new BadRequestException('CPF/CNPJ informado para a nota é inválido');
    }

    const customerCredit = await this.customerCredit(tenantId, dto.customerId);
    const planned = planPayments(dto.payments, {
      dueCents,
      exact: true,
      policy: await this.payments.policy(tenantId),
      supports: (p, m) => this.payments.provider(p).supports(m),
      customerCreditCents: customerCredit,
    });
    await this.assertConnected(tenantId, planned);

    const sale = await this.prisma.$transaction(async (tx: Tx) => {
      const { saleSeq } = await tx.tenant.update({ where: { id: tenantId }, data: { saleSeq: { increment: 1 } }, select: { saleSeq: true } });
      const interest = planned.reduce((s, p) => s + p.interestCents, 0);
      const created = await tx.sale.create({
        data: {
          tenantId,
          storeId: session.storeId,
          cashSessionId: session.id,
          userId: user.userId,
          customerId: dto.customerId,
          consumerDocument: dto.consumerDocument,
          number: saleSeq,
          status: 'PENDING',
          subtotalCents,
          discountCents,
          interestCents: interest,
          totalCents: dueCents + interest,
          items: { create: items },
          payments: { create: planned.map((p) => paymentRow(tenantId, p)) },
        },
      });
      for (const i of items) {
        await this.stock.move(tx, {
          tenantId, variantId: i.variantId, type: 'SALE', qty: i.qty, saleId: created.id,
          reason: `Venda #${saleSeq}`, allowNegative: tenant.allowNegativeStock,
        });
      }
      await this.spendStoreCredit(tx, tenantId, dto.customerId, planned);
      return created;
    });

    await this.chargeIntegrated(tenantId, sale.id, tenant.email);
    await this.finalizeIfPaid(tenantId, sale.id);
    return this.get(tenantId, sale.id);
  }

  /** Adiciona um pagamento a uma venda pendente (ex.: trocar a forma depois de uma recusa). */
  async addPayment(user: AuthUser, saleId: string, dto: AddPaymentDto) {
    const { tenantId } = user;
    const sale = await this.load(tenantId, saleId);
    if (sale.status !== 'PENDING') throw new ConflictException('A venda não está aguardando pagamento');

    const covered = sale.payments
      .filter((p: PaymentRow) => p.status === 'PENDING' || p.status === 'APPROVED')
      .reduce((s: number, p: PaymentRow) => s + p.principalCents, 0);
    const dueCents = sale.subtotalCents - sale.discountCents;
    const remaining = dueCents - covered;
    if (remaining <= 0) throw new ConflictException('A venda já está totalmente coberta');

    const planned = planPayments([dto], {
      dueCents: remaining,
      exact: false,
      policy: await this.payments.policy(tenantId),
      supports: (p, m) => this.payments.provider(p).supports(m),
      customerCreditCents: await this.customerCredit(tenantId, sale.customerId ?? undefined),
    });
    await this.assertConnected(tenantId, planned);

    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.payment.create({ data: { saleId, ...paymentRow(tenantId, planned[0]) } });
      await this.spendStoreCredit(tx, tenantId, sale.customerId ?? undefined, planned);
      await this.recomputeTotals(tx, saleId);
    });

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { email: true } });
    await this.chargeIntegrated(tenantId, saleId, tenant?.email);
    await this.finalizeIfPaid(tenantId, saleId);
    return this.get(tenantId, saleId);
  }

  // ───────────────────────── consulta ─────────────────────────

  async get(tenantId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, tenantId },
      include: { items: true, payments: { orderBy: { createdAt: 'asc' } }, customer: { select: { id: true, name: true } } },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return sale;
  }

  async list(tenantId: string, opts: { from?: Date; to?: Date; status?: string; page?: number }) {
    const pageSize = 30;
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const where = {
      tenantId,
      ...(opts.status ? { status: opts.status as any } : {}),
      ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { payments: true } }),
      this.prisma.sale.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Consulta o adquirente para pagamentos pendentes (usado pelo polling do PDV e como rede de segurança do webhook). */
  async refresh(tenantId: string, saleId: string) {
    const sale = await this.load(tenantId, saleId);
    for (const p of sale.payments as PaymentRow[]) {
      if (p.status === 'PENDING' && p.externalId && p.provider !== 'MANUAL') {
        await this.syncPayment(tenantId, p);
      }
    }
    await this.finalizeIfPaid(tenantId, saleId);
    return this.get(tenantId, saleId);
  }

  /** Recibo NÃO fiscal em texto (58/80 mm). O cupom fiscal (NFC-e) será gerado pelo módulo fiscal. */
  async receipt(tenantId: string, id: string) {
    const [sale, tenant] = await Promise.all([
      this.get(tenantId, id),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, document: true } }),
    ]);
    const fiscalDoc = await this.fiscal.getBySale(tenantId, id);
    const money = (c: number) => `R$ ${centsToDecimalString(c).replace('.', ',')}`;
    const lines = [
      tenant?.name ?? '',
      tenant?.document ? `CNPJ/CPF: ${tenant.document}` : '',
      fiscalDoc?.status === 'AUTHORIZED' ? `NFC-e nº ${fiscalDoc.number} série ${fiscalDoc.series}` : '*** RECIBO — SEM VALOR FISCAL ***',
      `Venda #${sale.number}  ${sale.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      '--------------------------------',
      ...sale.items.map((i: any) => `${i.qty}x ${i.description}\n   ${money(i.unitPriceCents)}  =  ${money(i.totalCents)}`),
      '--------------------------------',
      `Subtotal: ${money(sale.subtotalCents)}`,
      sale.discountCents ? `Desconto: -${money(sale.discountCents)}` : '',
      sale.interestCents ? `Juros do parcelamento: ${money(sale.interestCents)}` : '',
      `TOTAL: ${money(sale.totalCents)}`,
      ...sale.payments
        .filter((p: PaymentRow) => p.status === 'APPROVED')
        .map((p: PaymentRow) => `${labelMethod(p.method)}${p.installments > 1 ? ` ${p.installments}x` : ''}: ${money(p.totalCents)}`),
    ];
    return { text: lines.filter(Boolean).join('\n') };
  }

  // ───────────────────────── cancelamento ─────────────────────────

  async cancel(user: AuthUser, saleId: string, reason?: string) {
    const { tenantId } = user;
    const sale = await this.load(tenantId, saleId);
    if (sale.status === 'CANCELED') return this.get(tenantId, saleId);
    if (sale.status === 'PAID' && user.role === 'CASHIER') {
      throw new ForbiddenException('Somente gerente ou dono pode cancelar uma venda já paga');
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      const claimed = await tx.sale.updateMany({ where: { id: saleId, tenantId, status: { not: 'CANCELED' } }, data: { status: 'CANCELED' } });
      if (claimed.count === 0) return; // outra requisição já cancelou
      for (const i of sale.items) {
        await this.stock.move(tx, { tenantId, variantId: i.variantId, type: 'RETURN', qty: i.qty, saleId, reason: reason ?? `Cancelamento da venda #${sale.number}` });
      }
      const credit = (sale.payments as PaymentRow[])
        .filter((p) => p.method === 'STORE_CREDIT' && (p.status === 'APPROVED' || p.status === 'PENDING'))
        .reduce((s, p) => s + p.principalCents, 0);
      if (credit > 0 && sale.customerId) {
        await tx.customer.update({ where: { id: sale.customerId }, data: { creditBalanceCents: { increment: credit } } });
      }
      await tx.payment.updateMany({ where: { saleId, status: 'PENDING' }, data: { status: 'CANCELED' } });
    });

    // Cancela cobranças ainda abertas no adquirente (melhor esforço).
    for (const p of sale.payments as PaymentRow[]) {
      if (p.status === 'PENDING' && p.externalId && p.provider !== 'MANUAL') {
        try {
          await this.payments.provider(p.provider).cancel(await this.payments.credentials(tenantId, p.provider), p.externalId);
        } catch (e) {
          this.log.warn(`Não foi possível cancelar ${p.externalId} no adquirente: ${(e as Error).message}`);
        }
      }
    }

    // Pagamentos já aprovados em maquininha/PIX precisam ser estornados pelo lojista no adquirente.
    const manualRefundNeeded = (sale.payments as PaymentRow[])
      .filter((p) => p.status === 'APPROVED' && p.provider !== 'MANUAL')
      .map((p) => ({ paymentId: p.id, provider: p.provider, totalCents: p.totalCents, externalId: p.externalId }));
    // Nota já autorizada continua válida até ser cancelada na SEFAZ (prazo curto: ~30 min no NFC-e).
    const fiscalDoc = await this.fiscal.getBySale(tenantId, saleId);
    const fiscalCancelRequired = fiscalDoc?.status === 'AUTHORIZED';
    return { sale: await this.get(tenantId, saleId), manualRefundNeeded, fiscalCancelRequired };
  }

  // ───────────────────────── pagamentos integrados ─────────────────────────

  /** Chamado pelo webhook: localiza o pagamento pelo id externo e sincroniza com o adquirente. */
  async handleProviderNotification(externalId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { externalId, provider: { in: ['MERCADOPAGO_POINT', 'MERCADOPAGO_PIX'] } },
    });
    if (!payment) return { handled: false };
    await this.syncPayment(payment.tenantId, payment as PaymentRow);
    await this.finalizeIfPaid(payment.tenantId, payment.saleId);
    return { handled: true };
  }

  private async syncPayment(tenantId: string, p: PaymentRow) {
    const creds = await this.payments.credentials(tenantId, p.provider);
    const { status, raw } = await this.payments.provider(p.provider).fetchStatus(creds, p.externalId!);
    if (status === p.status) return;
    // Só avança a partir de PENDING: evita que uma notificação atrasada reabra pagamento encerrado.
    const r = await this.prisma.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status, raw: raw as any } });
    if (r.count > 0 && status !== 'APPROVED') {
      await this.prisma.$transaction(async (tx: Tx) => {
        const row = await tx.payment.findUnique({ where: { id: p.id }, select: { saleId: true } });
        if (row) await this.recomputeTotals(tx, row.saleId);
      });
    }
  }

  private async chargeIntegrated(tenantId: string, saleId: string, payerEmail?: string) {
    const sale = await this.load(tenantId, saleId);
    const base = process.env.PUBLIC_API_URL;
    for (const p of sale.payments as (PaymentRow & { brand?: string })[]) {
      if (p.status !== 'PENDING' || p.provider === 'MANUAL' || p.externalId) continue;
      try {
        const provider = this.payments.provider(p.provider);
        const creds = await this.payments.credentials(tenantId, p.provider);
        const result = await provider.charge(creds, {
          paymentId: p.id,
          saleNumber: sale.number,
          description: `Venda #${sale.number}`,
          method: p.method,
          installments: p.installments,
          amountCents: p.totalCents,
          payerEmail,
          deviceId: (await this.pendingDevice(p.id)) ?? undefined,
          notificationUrl: base ? `${base}/payments/webhook/mercadopago` : undefined,
        });
        await this.prisma.payment.update({
          where: { id: p.id },
          data: {
            status: result.status,
            externalId: result.externalId,
            pixCopyPaste: result.pix?.copyPaste,
            pixQrBase64: result.pix?.qrBase64,
            raw: result.raw as any,
          },
        });
      } catch (e) {
        this.log.error(`Falha ao cobrar pagamento ${p.id}: ${(e as Error).message}`);
        await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'DECLINED', raw: { error: (e as Error).message } } });
        await this.prisma.$transaction((tx: Tx) => this.recomputeTotals(tx, saleId));
      }
    }
  }

  /** Maquininha escolhida na criação do pagamento (guardada em `raw.deviceId`). */
  private async pendingDevice(paymentId: string): Promise<string | null> {
    const row = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { raw: true } });
    const raw = row?.raw as { deviceId?: string } | null;
    return raw?.deviceId ?? null;
  }

  /** Marca a venda como paga quando os pagamentos aprovados cobrem todo o valor. */
  async finalizeIfPaid(tenantId: string, saleId: string) {
    const sale = await this.load(tenantId, saleId);
    if (sale.status !== 'PENDING') return;
    const approved = (sale.payments as PaymentRow[]).filter((p) => p.status === 'APPROVED').reduce((s, p) => s + p.principalCents, 0);
    if (approved >= sale.subtotalCents - sale.discountCents) {
      const r = await this.prisma.sale.updateMany({ where: { id: saleId, tenantId, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date() } });
      // Venda acabou de ser paga: dispara a NFC-e (se a loja usa) sem atrasar a resposta do PDV.
      if (r.count > 0) void this.fiscal.autoEmit(tenantId, saleId);
    }
  }

  // ───────────────────────── utilidades ─────────────────────────

  private async load(tenantId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({ where: { id, tenantId }, include: { items: true, payments: true } });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return sale;
  }

  private async customerCredit(tenantId: string, customerId?: string): Promise<number | null> {
    if (!customerId) return null;
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { creditBalanceCents: true } });
    if (!c) throw new BadRequestException('Cliente não encontrado');
    return c.creditBalanceCents;
  }

  /** Falha cedo (antes de criar a venda) se algum meio integrado não estiver conectado. */
  private async assertConnected(tenantId: string, planned: PlannedPayment[]) {
    for (const p of planned) await this.payments.credentials(tenantId, p.provider);
  }

  private async spendStoreCredit(tx: Tx, tenantId: string, customerId: string | undefined, planned: PlannedPayment[]) {
    const total = planned.filter((p) => p.method === 'STORE_CREDIT').reduce((s, p) => s + p.principalCents, 0);
    if (total === 0) return;
    if (!customerId) throw new BadRequestException('Informe o cliente para usar vale-troca');
    const r = await tx.customer.updateMany({
      where: { id: customerId, tenantId, creditBalanceCents: { gte: total } },
      data: { creditBalanceCents: { decrement: total } },
    });
    if (r.count === 0) throw new BadRequestException('Saldo de vale-troca insuficiente');
  }

  /** Juros e total da venda refletem só os pagamentos vigentes (pendentes ou aprovados). */
  private async recomputeTotals(tx: Tx, saleId: string) {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { payments: true } });
    if (!sale) return;
    const interest = (sale.payments as PaymentRow[])
      .filter((p) => p.status === 'PENDING' || p.status === 'APPROVED')
      .reduce((s, p) => s + p.interestCents, 0);
    await tx.sale.update({ where: { id: saleId }, data: { interestCents: interest, totalCents: sale.subtotalCents - sale.discountCents + interest } });
  }
}

function describe(v: VariantRow): string {
  const attrs = v.attributes && typeof v.attributes === 'object' ? Object.values(v.attributes as Record<string, string>).join(' / ') : '';
  return attrs ? `${v.product.name} (${attrs})` : v.product.name;
}

function paymentRow(tenantId: string, p: PlannedPayment) {
  return {
    tenantId,
    method: p.method,
    provider: p.provider,
    status: (p.provider === 'MANUAL' ? 'APPROVED' : 'PENDING') as PaymentStatusName,
    installments: p.installments,
    principalCents: p.principalCents,
    interestCents: p.interestCents,
    totalCents: p.totalCents,
    brand: p.brand,
    raw: p.deviceId ? { deviceId: p.deviceId } : undefined,
  };
}

function labelMethod(m: string): string {
  return ({ CASH: 'Dinheiro', PIX: 'PIX', DEBIT: 'Débito', CREDIT: 'Crédito', STORE_CREDIT: 'Vale-troca' } as Record<string, string>)[m] ?? m;
}
