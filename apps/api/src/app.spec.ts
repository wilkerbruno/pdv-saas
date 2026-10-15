import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { accessCache } from './common/access-cache';
import { PrismaService } from './prisma/prisma.service';

// Sobe o app inteiro (módulos, DI, guards, validação) com um Prisma falso:
// verifica a fiação e as regras de acesso sem precisar de MySQL.
describe('app (fiação e guards)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwt: JwtService;
  let tenant: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'x'.repeat(40);
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);

    const fakePrisma = {
      plan: { findMany: async () => [{ code: 'basic', name: 'Básico', priceCents: 4990 }] },
      tenant: { findUnique: async () => tenant },
      $queryRaw: async () => [{ 1: 1 }],
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => accessCache.clear());

  const tokenFor = (role = 'OWNER') => jwt.signAsync({ sub: 'u1', tid: 't1', role });
  const call = async (path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    return fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as object) },
    });
  };

  it('rota pública responde sem token', async () => {
    const r = await call('/billing/plans');
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveLength(1);
  });

  it('rota protegida sem token → 401; token inválido → 401', async () => {
    expect((await call('/products')).status).toBe(401);
    expect((await call('/products', { token: 'lixo' })).status).toBe(401);
  });

  it('assinatura bloqueada → 402 em tudo, exceto rotas liberadas', async () => {
    tenant = { status: 'CANCELED', trialEndsAt: null, currentPeriodEnd: null };
    const token = await tokenFor();
    expect((await call('/products', { token })).status).toBe(402);
    expect((await call('/sales', { token, method: 'POST', body: '{}' })).status).toBe(402);
  });

  it('inadimplente em somente leitura: GET passa pelo guard, escrita → 402', async () => {
    tenant = { status: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() - 9 * 86400000) };
    const token = await tokenFor();
    expect((await call('/sales', { token, method: 'POST', body: '{}' })).status).toBe(402);
    // GET não é barrado pelo guard de assinatura (o fake não tem tabela de vendas, então o erro é outro, nunca 402/401)
    const get = await call('/products', { token });
    expect([401, 402]).not.toContain(get.status);
  });

  it('perfil: caixa não pode criar produto (403) mesmo com assinatura em dia', async () => {
    tenant = { status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 10 * 86400000) };
    const token = await tokenFor('CASHIER');
    const r = await call('/products', { token, method: 'POST', body: JSON.stringify({ name: 'X', variants: [{ priceCents: 100 }] }) });
    expect(r.status).toBe(403);
  });

  it('validação rejeita corpo inválido (400) para quem tem permissão', async () => {
    tenant = { status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 10 * 86400000) };
    const token = await tokenFor('OWNER');
    const r = await call('/products', { token, method: 'POST', body: JSON.stringify({ name: 'X', variants: [] }) });
    expect(r.status).toBe(400);
  });

  it('gerente não consegue criar usuário com perfil de dono (validação) nem gerente (permissão)', async () => {
    tenant = { status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 10 * 86400000) };
    const token = await tokenFor('MANAGER');
    const user = { name: 'Beto', email: 'beto@loja.com', password: '12345678' };
    const asOwner = await call('/users', { token, method: 'POST', body: JSON.stringify({ ...user, role: 'OWNER' }) });
    expect(asOwner.status).toBe(400);
    const asManager = await call('/users', { token, method: 'POST', body: JSON.stringify({ ...user, role: 'MANAGER' }) });
    expect(asManager.status).toBe(403);
  });

  it('cadastro com e-mail inválido → 400', async () => {
    const r = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Loja', name: 'Ana', email: 'nao-e-email', password: '12345678' }),
    });
    expect(r.status).toBe(400);
  });
});
