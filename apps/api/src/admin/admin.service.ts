import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { accessCache } from '../common/access-cache';
import { resolveAccess } from '../common/access';
import { BillingService } from '../billing/billing.service';
import { CreatePlanDto, ExtendDto, UpdatePlanDto, UpdateTenantDto } from './admin.dto';

export interface Actor { id: string; email: string }
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private billing: BillingService) {}

  private audit(actor: Actor, action: string, tenantId: string | null, details?: unknown) {
    return this.prisma.adminAction.create({
      data: { adminId: actor.id, adminEmail: actor.email, tenantId, action, details: (details ?? undefined) as any },
    });
  }

  async overview() {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * DAY);
    const ago30 = new Date(now.getTime() - 30 * DAY);
    const [grouped, activeTenants, trialsEnding, newTenants, paid30] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { plan: { select: { priceCents: true } } } }),
      this.prisma.tenant.count({ where: { status: 'TRIAL', trialEndsAt: { gte: now, lte: in7 } } }),
      this.prisma.tenant.count({ where: { createdAt: { gte: ago30 } } }),
      this.prisma.billingInvoice.aggregate({ where: { status: 'PAID', paidAt: { gte: ago30 } }, _sum: { amountCents: true }, _count: { _all: true } }),
    ]);
    const byStatus: Record<string, number> = { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0, CANCELED: 0 };
    for (const g of grouped) byStatus[g.status] = g._count._all;
    return {
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      mrrCents: activeTenants.reduce((s: number, t: any) => s + t.plan.priceCents, 0),
      trialsEndingIn7Days: trialsEnding,
      newTenants30d: newTenants,
      revenue30dCents: paid30._sum.amountCents ?? 0,
      paidInvoices30d: paid30._count._all,
    };
  }

  async listTenants(q: { search?: string; status?: string; planCode?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.planCode) where.plan = { code: q.planCode };
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.OR = [{ name: { contains: s } }, { email: { contains: s } }, { document: { contains: s } }];
    }
    const [total, rows] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { plan: { select: { code: true, name: true, priceCents: true } } },
      }),
    ]);
    return { total, page, pageSize, items: rows.map((t: any) => this.tenantRow(t)) };
  }

  private tenantRow(t: any) {
    return {
      id: t.id, name: t.name, email: t.email, document: t.document, status: t.status,
      access: resolveAccess(t), trialEndsAt: t.trialEndsAt, currentPeriodEnd: t.currentPeriodEnd,
      fiscalEnabled: t.fiscalEnabled, createdAt: t.createdAt, plan: t.plan,
    };
  }

  async tenantDetail(id: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id },
      include: { plan: true, _count: { select: { users: true, stores: true } } },
    });
    if (!t) throw new NotFoundException('Loja não encontrada');
    const [invoices, actions, users] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, planCode: true, amountCents: true, status: true, expiresAt: true, paidAt: true, createdAt: true },
      }),
      this.prisma.adminAction.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.user.findMany({ where: { tenantId: id }, select: { id: true, name: true, email: true, role: true, active: true } }),
    ]);
    return { ...this.tenantRow(t), plan: t.plan, counts: t._count, invoices, actions, users };
  }

  async updateTenant(actor: Actor, id: string, dto: UpdateTenantDto) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Loja não encontrada');
    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.fiscalEnabled !== undefined) data.fiscalEnabled = dto.fiscalEnabled;
    if (dto.trialEndsAt !== undefined) data.trialEndsAt = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;
    if (dto.currentPeriodEnd !== undefined) data.currentPeriodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null;
    if (dto.planCode !== undefined) {
      const plan = await this.prisma.plan.findUnique({ where: { code: dto.planCode } });
      if (!plan) throw new NotFoundException('Plano não encontrado');
      data.planId = plan.id;
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nada para alterar');
    const updated = await this.prisma.tenant.update({ where: { id }, data });
    accessCache.invalidate(id); // vale imediatamente
    await this.audit(actor, 'TENANT_UPDATE', id, dto);
    return updated;
  }

  /** Libera mais N dias (ex.: cortesia ou pagamento recebido fora do sistema) e reativa a loja. */
  async extend(actor: Actor, id: string, dto: ExtendDto) {
    const updated = await this.billing.markPaid(id, dto.days);
    await this.audit(actor, 'EXTEND', id, { days: dto.days });
    return updated;
  }

  async listPlans() {
    const [plans, counts] = await Promise.all([
      this.prisma.plan.findMany({ orderBy: { priceCents: 'asc' } }),
      this.prisma.tenant.groupBy({ by: ['planId'], _count: { _all: true } }),
    ]);
    const byPlan = new Map(counts.map((c: any) => [c.planId, c._count._all] as [string, number]));
    return plans.map((p: any) => ({ ...p, tenants: byPlan.get(p.id) ?? 0 }));
  }

  async createPlan(actor: Actor, dto: CreatePlanDto) {
    if (await this.prisma.plan.findUnique({ where: { code: dto.code } })) throw new ConflictException('Já existe um plano com esse código');
    const plan = await this.prisma.plan.create({ data: dto });
    await this.audit(actor, 'PLAN_CREATE', null, dto);
    return plan;
  }

  /** Planos não são apagados (lojas e faturas referenciam o código): desative com active=false. */
  async updatePlan(actor: Actor, id: string, dto: UpdatePlanDto) {
    if (!(await this.prisma.plan.findUnique({ where: { id } }))) throw new NotFoundException('Plano não encontrado');
    if (Object.keys(dto).length === 0) throw new BadRequestException('Nada para alterar');
    const plan = await this.prisma.plan.update({ where: { id }, data: dto });
    await this.audit(actor, 'PLAN_UPDATE', null, { id, ...dto });
    return plan;
  }

  async listInvoices(q: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.billingInvoice.count({ where }),
      this.prisma.billingInvoice.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, tenantId: true, planCode: true, amountCents: true, status: true, expiresAt: true, paidAt: true, createdAt: true, tenant: { select: { name: true } } },
      }),
    ]);
    return { total, page, pageSize, items: rows };
  }
}
