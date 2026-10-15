import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { AllowWhenBlocked, CurrentUser, Public, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginDto, RegisterDto } from './auth.dto';

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public() @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @AllowWhenBlocked() @Get('auth/me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.userId, u.tenantId);
  }

  @Roles('OWNER', 'MANAGER') @Get('users')
  list(@CurrentUser() u: AuthUser) {
    return this.auth.listUsers(u.tenantId);
  }

  @Roles('OWNER', 'MANAGER') @Post('users')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    // Só o dono cria gerentes; gerente cria apenas operadores de caixa.
    if (dto.role === 'MANAGER' && u.role !== 'OWNER') throw new ForbiddenException('Somente o dono pode criar gerentes');
    return this.auth.createUser(u.tenantId, dto);
  }
}
