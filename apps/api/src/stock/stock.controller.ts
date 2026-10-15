import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { StockService } from './stock.service';

class ReceiveDto {
  @IsString() code: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
}

class AdjustDto {
  @IsString() variantId: string;
  @IsIn(['IN', 'OUT', 'ADJUST']) type: 'IN' | 'OUT' | 'ADJUST';
  @IsInt() @Min(0) qty: number;
  @IsOptional() @IsString() reason?: string;
}

@Controller('stock')
export class StockController {
  constructor(private stock: StockService) {}

  @Roles('OWNER', 'MANAGER') @Post('adjust')
  adjust(@CurrentUser() u: AuthUser, @Body() dto: AdjustDto) {
    return this.stock.adjust(u.tenantId, dto.variantId, dto.type, dto.qty, dto.reason);
  }

  @Roles('OWNER', 'MANAGER') @Post('receive')
  receive(@CurrentUser() u: AuthUser, @Body() dto: ReceiveDto) {
    return this.stock.receiveByCode(u.tenantId, dto.code, dto.qty ?? 1);
  }

  @Get('movements') movements(@CurrentUser() u: AuthUser, @Query('variantId') variantId?: string) {
    return this.stock.movements(u.tenantId, variantId);
  }

  @Get('low') low(@CurrentUser() u: AuthUser) {
    return this.stock.lowStock(u.tenantId);
  }
}
