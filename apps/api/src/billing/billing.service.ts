import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { centsToDecimalString } from '../common/money';
import { httpJson } from '../payments/providers/http';
import { amountToCents, invoiceRef, parseInvoiceRef } from './billing-pix';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAccess } from '../common/access';
import { accessCache } from '../common/access-cache';

const PERIOD_DAYS = 30;
const MP = 'https://api.mercadopago.com';
const INVOICE_TTL_MS = 60 * 60 * 1000; // PIX da mensalidade vale 1 h

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {}

  private platformToken() {
    const t = process.env.PLATFORM_MP_ACCESS_TOKEN;
    if (!t) throw new ServiceUnavailableException('Cobrança de mensalidade não configurada (PLATFORM_MP_ACCESS_TOKEN)');
    return t;
  }

  plans() {
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: 'asc' } });
  }

  async status(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!t) throw new NotFoundException();
    return {
      status: t.status,
      access: resolveAccess(t),
      plan: t.plan,
      trialEndsAt: t.trialEndsAt,
      currentPeriodEnd: t.currentPeriodEnd,
    };
  }

  /**
   * Registra um pagamento de mensalidade aprovado: estende o período e reativa a conta.
   * Chamado pelo webhook do gateway de cobrança (a implementar) após validar a assinatura.
   * Se a conta estava vencida, o novo período conta a partir de agora; se em dia, soma ao fim atual.
   */
  async markPaid(tenantId: string, days = PERIOD_DAYS) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException();
    const base = t.currentPeriodEnd && t.currentPeriodEnd.getTime() > Date.now() ? t.currentPeriodEnd : new Date();
    const currentPeriodEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE', currentPeriodEnd } });
    accessCache.invalidate(tenantId); // libera o acesso imediatamente após o pagamento
    return updated;
  }

  async changePlan(tenantId: string, planCode: string) {
    const plan = await this.prisma.plan.findFirst({ where: { code: planCode, active: true } });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return this.prisma.tenant.update({ where: { id: tenantId }, data: { planId: plan.id } });
  }

  /** Gera (ou reaproveita) o PIX da mensalidade do plano atual da loja. */
  async checkout(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!t) throw new NotFoundException();
    if (t.plan.priceCents <= 0) throw new BadRequestException('Este plano não tem cobrança');
    const token = this.platformToken();

    const reusable = await this.prisma.billingInvoice.findFirst({
      where: { tenantId, status: 'PENDING', planCode: t.plan.code, amountCents: t.plan.priceCents, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable?.pixCopyPaste) return this.present(reusable);

    const expiresAt = new Date(Date.now() + INVOICE_TTL_MS);
    const inv = await this.prisma.billingInvoice.create({
      data: { tenantId, planCode: t.plan.code, amountCents: t.plan.priceCents, expiresAt },
    });
    const base = process.env.PUBLIC_API_URL;
    const payment = await httpJson(`${MP}/v1/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Idempotency-Key': inv.id },
      body: {
        transaction_amount: Number(centsToDecimalString(inv.amountCents)),
        description: `Mensalidade ${t.plan.name} - ${t.name}`,
        payment_method_id: 'pix',
        external_reference: invoiceRef(inv.id),
        date_of_expiration: expiresAt.toISOString().replace('Z', '-00:00'),
        payer: { email: t.email },
        ...(base && base.startsWith('https://') ? { notification_url: `${base}/billing/webhook/mercadopago` } : {}),
      },
    });
    const tx = payment?.point_of_interaction?.transaction_data;
    const updated = await this.prisma.billingInvoice.update({
      where: { id: inv.id },
      data: { externalId: String(payment?.id), pixCopyPaste: tx?.qr_code ?? null, pixQrBase64: tx?.qr_code_base64 ?? null },
    });
    return this.present(updated);
  }

  /** Estado da cobrança em aberto (a tela consulta enquanto o cliente paga). Também confere no MP se o webhook atrasou. */
  async invoiceStatus(tenantId: string, invoiceId: string) {
    const inv = await this.prisma.billingInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!inv) throw new NotFoundException();
    if (inv.status === 'PENDING' && inv.externalId) await this.handleNotification(inv.externalId).catch(() => undefined);
    const fresh = await this.prisma.billingInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    return { id: inv.id, status: fresh?.status ?? inv.status };
  }

  /**
   * Notificação do Mercado Pago: o corpo não é confiável, então consultamos o pagamento na API.
   * Só libera se aprovado, com a referência de uma cobrança nossa e valor igual ou maior. Idempotente.
   */
  async handleNotification(paymentId: string) {
    if (!/^\d{3,20}$/.test(paymentId)) return { handled: false };
    const p = await httpJson(`${MP}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${this.platformToken()}` },
    });
    const invoiceId = parseInvoiceRef(p?.external_reference);
    if (!invoiceId) return { handled: false };
    const inv = await this.prisma.billingInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) return { handled: false };
    if (inv.status === 'PAID') return { handled: true, duplicate: true };
    if (p?.status !== 'approved') return { handled: true, status: p?.status };
    const paid = amountToCents(p?.transaction_amount);
    if (paid === null || paid < inv.amountCents) {
      this.log.warn(`Cobrança ${inv.id}: valor pago (${paid}) menor que o devido (${inv.amountCents})`);
      return { handled: true, underpaid: true };
    }
    // Só um processo vence a corrida: PENDING/EXPIRED -> PAID
    const won = await this.prisma.billingInvoice.updateMany({
      where: { id: inv.id, status: { not: 'PAID' } },
      data: { status: 'PAID', paidAt: new Date(), externalId: String(p.id) },
    });
    if (won.count !== 1) return { handled: true, duplicate: true };
    await this.markPaid(inv.tenantId);
    return { handled: true, paid: true };
  }

  private present(i: { id: string; amountCents: number; pixCopyPaste: string | null; pixQrBase64: string | null; expiresAt: Date }) {
    return { invoiceId: i.id, amountCents: i.amountCents, copyPaste: i.pixCopyPaste, qrBase64: i.pixQrBase64, expiresAt: i.expiresAt };
  }
}
