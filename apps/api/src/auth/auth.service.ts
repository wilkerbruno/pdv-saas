import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { resolveAccess } from '../common/access';
import { RoleName } from '../common/types';
import { CreateUserDto, LoginDto, RegisterDto } from './auth.dto';

const TRIAL_DAYS = 14;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  /** Autocadastro da loja: cria tenant (em teste grátis), loja padrão, política de parcelas e o dono. */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('E-mail já cadastrado');
    }
    const plan = await this.prisma.plan.findFirst({ where: { code: dto.planCode ?? 'basic', active: true } });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const { tenant, user } = await this.prisma.$transaction(async (tx: Tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.companyName,
          document: dto.document,
          email,
          planId: plan.id,
          status: 'TRIAL',
          trialEndsAt,
          fiscalEnabled: false,
        },
      });
      await tx.store.create({ data: { tenantId: tenant.id, name: 'Loja principal' } });
      await tx.installmentPolicy.create({ data: { tenantId: tenant.id } });
      const user = await tx.user.create({
        data: { tenantId: tenant.id, name: dto.name, email, passwordHash, role: 'OWNER' },
      });
      return { tenant, user };
    });

    return this.session(user.id, tenant.id, user.role as RoleName, user.name);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    return this.session(user.id, user.tenantId, user.role as RoleName, user.name);
  }

  async me(userId: string, tenantId: string) {
    const [user, tenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { plan: true, stores: { where: { active: true }, select: { id: true, name: true } } },
      }),
    ]);
    if (!user || !tenant) throw new UnauthorizedException();
    return { user, tenant: this.tenantView(tenant) };
  }

  async createUser(tenantId: string, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('E-mail já cadastrado');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { tenantId, name: dto.name, email, passwordHash, role: dto.role },
      select: { id: true, name: true, email: true, role: true },
    });
    return user;
  }

  listUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: { name: 'asc' },
    });
  }

  private async session(userId: string, tenantId: string, role: RoleName, name: string) {
    const token = await this.jwt.signAsync({ sub: userId, tid: tenantId, role });
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    return { token, user: { id: userId, name, role }, tenant: tenant ? this.tenantView(tenant) : null };
  }

  private tenantView(t: {
    id: string; name: string; status: any; trialEndsAt: Date | null; currentPeriodEnd: Date | null;
    fiscalEnabled: boolean; plan: { code: string; name: string }; stores?: unknown;
  }) {
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      access: resolveAccess(t),
      trialEndsAt: t.trialEndsAt,
      currentPeriodEnd: t.currentPeriodEnd,
      fiscalEnabled: t.fiscalEnabled,
      plan: { code: t.plan.code, name: t.plan.name },
      stores: t.stores,
    };
  }
}
