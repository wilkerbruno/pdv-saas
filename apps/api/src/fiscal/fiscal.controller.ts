import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { FiscalService } from './fiscal.service';

class SettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['HOMOLOGACAO', 'PRODUCAO']) environment?: 'HOMOLOGACAO' | 'PRODUCAO';
  @IsOptional() @IsString() cnpj?: string;
  /** Token da empresa no Focus NFe. Em branco mantém o atual. */
  @IsOptional() @IsString() providerToken?: string;
  @IsOptional() @Matches(/^\d{4}$/, { message: 'CFOP deve ter 4 dígitos' }) defaultCfop?: string;
  @IsOptional() @IsString() defaultTaxCode?: string;
  @IsOptional() @IsBoolean() autoEmit?: boolean;
}

class CancelDto {
  @IsString() @MinLength(15) justification: string;
}

@Controller('fiscal')
export class FiscalController {
  constructor(private fiscal: FiscalService) {}

  @Roles('OWNER', 'MANAGER') @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.fiscal.settings(u.tenantId);
  }

  @Roles('OWNER') @Put('settings')
  update(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    return this.fiscal.updateSettings(u.tenantId, dto);
  }

  /** Nota fiscal da venda (null quando ainda não há). O PDV consulta isto logo após a venda. */
  @Get('sales/:saleId')
  async bySale(@CurrentUser() u: AuthUser, @Param('saleId') saleId: string) {
    return (await this.fiscal.getBySale(u.tenantId, saleId)) ?? { status: null };
  }

  /** Emite ou reenvia (após correção de cadastro ou erro de comunicação). */
  @Post('sales/:saleId/emit')
  emit(@CurrentUser() u: AuthUser, @Param('saleId') saleId: string) {
    return this.fiscal.emit(u.tenantId, saleId);
  }

  @Post('sales/:saleId/refresh')
  refresh(@CurrentUser() u: AuthUser, @Param('saleId') saleId: string) {
    return this.fiscal.refresh(u.tenantId, saleId);
  }

  @Roles('OWNER', 'MANAGER') @Post('sales/:saleId/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('saleId') saleId: string, @Body() dto: CancelDto) {
    return this.fiscal.cancel(u.tenantId, saleId, dto.justification);
  }
}
