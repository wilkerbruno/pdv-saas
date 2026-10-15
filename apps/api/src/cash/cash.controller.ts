import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/types';
import { CashService } from './cash.service';

class OpenDto {
  @IsString() storeId: string;
  @IsInt() @Min(0) openingCents: number;
}
class MovementDto {
  @IsIn(['SANGRIA', 'SUPRIMENTO']) type: 'SANGRIA' | 'SUPRIMENTO';
  @IsInt() @Min(1) amountCents: number;
  @IsOptional() @IsString() note?: string;
}
class CloseDto {
  @IsInt() @Min(0) countedCents: number;
}

@Controller('cash')
export class CashController {
  constructor(private cash: CashService) {}

  @Post('open') open(@CurrentUser() u: AuthUser, @Body() dto: OpenDto) {
    return this.cash.open(u.tenantId, u.userId, dto.storeId, dto.openingCents);
  }

  @Get('current') async current(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    const session = await this.cash.current(u.tenantId, u.userId, storeId);
    if (!session) return { session: null };
    return { session, balance: await this.cash.balance(u.tenantId, session.id) };
  }

  @Post('movements') movement(@CurrentUser() u: AuthUser, @Body() dto: MovementDto) {
    return this.cash.addMovement(u.tenantId, u.userId, dto.type, dto.amountCents, dto.note);
  }

  @Post('close') close(@CurrentUser() u: AuthUser, @Body() dto: CloseDto) {
    return this.cash.close(u.tenantId, u.userId, dto.countedCents);
  }
}
