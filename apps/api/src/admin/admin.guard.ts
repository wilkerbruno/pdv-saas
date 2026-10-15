import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/types';
import { isPlatformAdminEmail } from './admin-emails';

/** Libera só quem está em PLATFORM_ADMIN_EMAILS. Reconfere no banco a cada chamada (remover o e-mail revoga na hora). */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const u: AuthUser | undefined = req.user;
    if (!u) throw new ForbiddenException('Acesso restrito ao administrador da plataforma');
    const row = await this.prisma.user.findUnique({ where: { id: u.userId }, select: { email: true, active: true } });
    if (!row || !row.active || !isPlatformAdminEmail(row.email)) {
      throw new ForbiddenException('Acesso restrito ao administrador da plataforma');
    }
    req.adminEmail = row.email;
    return true;
  }
}
