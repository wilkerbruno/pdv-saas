import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/types';
import { AddPaymentDto, CancelSaleDto, CreateSaleDto } from './sales.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private sales: SalesService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateSaleDto) {
    return this.sales.create(u, dto);
  }

  @Get() list(
    @CurrentUser() u: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.sales.list(u.tenantId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      status,
      page: page ? Number(page) : undefined,
    });
  }

  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.sales.get(u.tenantId, id);
  }

  @Get(':id/receipt') receipt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.sales.receipt(u.tenantId, id);
  }

  /** Consulta o status dos pagamentos pendentes no adquirente. O PDV usa em polling. */
  @Post(':id/refresh') refresh(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.sales.refresh(u.tenantId, id);
  }

  @Post(':id/payments') addPayment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AddPaymentDto) {
    return this.sales.addPayment(u, id, dto);
  }

  @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CancelSaleDto) {
    return this.sales.cancel(u, id, dto.reason);
  }
}
