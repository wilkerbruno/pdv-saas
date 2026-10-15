import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAccess, AccessLevel } from './access';
import { accessCache } from './access-cache';
import { ALLOW_WHEN_BLOCKED, IS_PUBLIC, ROLES } from './decorators';
import { AuthUser, RoleName } from './types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Token ausente');

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tid: string; role: RoleName }>(token);
      const user: AuthUser = { userId: payload.sub, tenantId: payload.tid, role: payload.role };
      req.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}

/** Aplica o bloqueio por assinatura: BLOCKED nega tudo; READ_ONLY só deixa GET. */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_BLOCKED, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user) return true; // o JwtAuthGuard já barrou

    const level = await this.levelFor(user.tenantId);
    if (level === 'BLOCKED') {
      throw new HttpException('Assinatura inativa. Regularize o pagamento para continuar.', HttpStatus.PAYMENT_REQUIRED);
    }
    if (level === 'READ_ONLY' && req.method !== 'GET') {
      throw new HttpException('Assinatura em atraso: modo somente leitura.', HttpStatus.PAYMENT_REQUIRED);
    }
    return true;
  }

  private async levelFor(tenantId: string): Promise<AccessLevel> {
    const cached = accessCache.get(tenantId);
    if (cached) return cached;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true },
    });
    const level: AccessLevel = tenant ? resolveAccess(tenant) : 'BLOCKED';
    accessCache.set(tenantId, level);
    return level;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Sem permissão para esta ação');
    return true;
  }
}
