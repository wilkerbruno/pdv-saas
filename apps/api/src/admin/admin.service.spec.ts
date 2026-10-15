import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { isPlatformAdminEmail } from './admin-emails';
import { accessCache } from '../common/access-cache';

const actor = { id: 'u1', email: 'admin@x.com' };

function make() {
  const tenant: any = { id: 't1', status: 'SUSPENDED', currentPeriodEnd: null, trialEndsAt: null, fiscalEnabled: false };
  const plans: any[] = [{ id: 'p1', code: 'basic', priceCents: 4990 }];
  const audits: any[] = [];
  const prisma: any = {
    tenant: {
      findUnique: async ({ where }: any) => (where.id === 't1' ? tenant : null),
      update: async ({ data }: any) => Object.assign(tenant, data),
    },
    plan: {
      findUnique: async ({ where }: any) => plans.find((p) => (where.code ? p.code === where.code : p.id === where.id)) ?? null,
      create: async ({ data }: any) => { const p = { id: 'p' + (plans.length + 1), ...data }; plans.push(p); return p; },
      update: async ({ where, data }: any) => Object.assign(plans.find((p) => p.id === where.id), data),
    },
    adminAction: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
  const billing: any = { markPaid: async (id: string, days: number) => ({ id, days }) };
  return { svc: new AdminService(prisma, billing), tenant, plans, audits };
}

describe('isPlatformAdminEmail', () => {
  it('compara sem diferenciar maiúsculas e ignora vazio', () => {
    expect(isPlatformAdminEmail('A@x.com', ' a@x.com , b@x.com')).toBe(true);
    expect(isPlatformAdminEmail('c@x.com', 'a@x.com')).toBe(false);
    expect(isPlatformAdminEmail('a@x.com', '')).toBe(false);
    expect(isPlatformAdminEmail(null, 'a@x.com')).toBe(false);
  });
});

describe('AdminService', () => {
  it('atualiza a loja, invalida o cache e registra auditoria', async () => {
    const { svc, tenant, audits } = make();
    accessCache.set('t1', 'BLOCKED');
    await svc.updateTenant(actor, 't1', { status: 'ACTIVE', planCode: 'basic', currentPeriodEnd: '2030-01-01T00:00:00.000Z' });
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.planId).toBe('p1');
    expect(tenant.currentPeriodEnd).toEqual(new Date('2030-01-01T00:00:00.000Z'));
    expect(accessCache.get('t1')).toBeUndefined();
    expect(audits[0]).toMatchObject({ action: 'TENANT_UPDATE', tenantId: 't1', adminEmail: 'admin@x.com' });
  });

  it('rejeita loja/plano inexistente e alteração vazia', async () => {
    const { svc } = make();
    await expect(svc.updateTenant(actor, 'nope', { status: 'ACTIVE' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updateTenant(actor, 't1', { planCode: 'zzz' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updateTenant(actor, 't1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('extend usa markPaid e audita', async () => {
    const { svc, audits } = make();
    expect(await svc.extend(actor, 't1', { days: 15 })).toEqual({ id: 't1', days: 15 });
    expect(audits[0]).toMatchObject({ action: 'EXTEND', details: { days: 15 } });
  });

  it('cria plano sem duplicar o código e edita', async () => {
    const { svc } = make();
    await expect(svc.createPlan(actor, { code: 'basic', name: 'X', priceCents: 1 })).rejects.toBeInstanceOf(ConflictException);
    const p = await svc.createPlan(actor, { code: 'gold', name: 'Gold', priceCents: 29900 });
    expect((await svc.updatePlan(actor, p.id, { active: false })).active).toBe(false);
    await expect(svc.updatePlan(actor, 'x', { active: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});
