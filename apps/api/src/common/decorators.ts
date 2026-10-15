import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser, RoleName } from './types';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_WHEN_BLOCKED = 'allowWhenBlocked';
export const ROLES = 'roles';

/** Rota sem autenticação (login, cadastro, webhooks, lista de planos). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Rota liberada mesmo com a assinatura bloqueada (o lojista precisa conseguir pagar). */
export const AllowWhenBlocked = () => SetMetadata(ALLOW_WHEN_BLOCKED, true);
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
