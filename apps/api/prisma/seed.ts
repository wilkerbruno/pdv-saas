import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Valores de exemplo: ajuste os preços dos planos conforme a sua estratégia comercial.
const PLANS = [
  { code: 'basic', name: 'Básico', priceCents: 4990, maxCashRegisters: 1, maxStores: 1, fiscalEnabled: false, integratedPos: false },
  { code: 'pro', name: 'Pro', priceCents: 9990, maxCashRegisters: 3, maxStores: 1, fiscalEnabled: true, integratedPos: true },
  { code: 'multi', name: 'Multi-loja', priceCents: 19990, maxCashRegisters: 10, maxStores: 5, fiscalEnabled: true, integratedPos: true },
];

async function main() {
  for (const p of PLANS) {
    await prisma.plan.upsert({ where: { code: p.code }, update: p, create: p });
  }
  console.log(`Planos: ${PLANS.map((p) => p.code).join(', ')}`);

  if (process.env.SEED_DEMO !== '1') return;

  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'pro' } });
  const email = 'demo@pdv.local';
  if (await prisma.user.findUnique({ where: { email } })) return console.log('Demo já existe');

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Loja Demo',
      email,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    },
  });
  await prisma.store.create({ data: { tenantId: tenant.id, name: 'Loja principal' } });
  await prisma.installmentPolicy.create({ data: { tenantId: tenant.id } });
  await prisma.user.create({
    data: { tenantId: tenant.id, name: 'Dono Demo', email, passwordHash: await bcrypt.hash('demo12345', 10), role: 'OWNER' },
  });

  const camiseta = await prisma.product.create({ data: { tenantId: tenant.id, name: 'Camiseta Básica', ncm: '61091000' } });
  for (const [i, tamanho] of ['P', 'M', 'G'].entries()) {
    await prisma.productVariant.create({
      data: {
        tenantId: tenant.id, productId: camiseta.id, sku: `CAM-${tamanho}`, barcode: `789000000000${i}`,
        attributes: { tamanho, cor: 'Branca' }, priceCents: 5990, costCents: 2500, stockQty: 20, minStock: 3,
      },
    });
  }
  const vaso = await prisma.product.create({ data: { tenantId: tenant.id, name: 'Vaso Decorativo', ncm: '69131000' } });
  await prisma.productVariant.create({
    data: { tenantId: tenant.id, productId: vaso.id, sku: 'VASO-01', barcode: '7890000000100', priceCents: 12990, costCents: 5000, stockQty: 8, minStock: 2 },
  });
  console.log('Demo criado: demo@pdv.local / demo12345');
}

main().finally(() => prisma.$disconnect());
