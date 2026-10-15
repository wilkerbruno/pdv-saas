import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AllowWhenBlocked, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/types';
import { PlatformAdminGuard } from './admin.guard';
import { AdminService, Actor } from './admin.service';
import { CreatePlanDto, ExtendDto, UpdatePlanDto, UpdateTenantDto } from './admin.dto';

const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

/** Painel do dono da plataforma. Fica liberado mesmo se a loja do admin estiver bloqueada. */
@AllowWhenBlocked()
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  private actor(u: AuthUser, req: any): Actor {
    return { id: u.userId, email: req.adminEmail };
  }

  @Get('overview') overview() { return this.admin.overview(); }

  @Get('tenants')
  tenants(@Query() q: Record<string, string>) {
    return this.admin.listTenants({ search: q.search, status: q.status, planCode: q.planCode, page: num(q.page), pageSize: num(q.pageSize) });
  }

  @Get('tenants/:id') tenant(@Param('id') id: string) { return this.admin.tenantDetail(id); }

  @Patch('tenants/:id')
  updateTenant(@CurrentUser() u: AuthUser, @Req() req: any, @Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.admin.updateTenant(this.actor(u, req), id, dto);
  }

  @Post('tenants/:id/extend')
  extend(@CurrentUser() u: AuthUser, @Req() req: any, @Param('id') id: string, @Body() dto: ExtendDto) {
    return this.admin.extend(this.actor(u, req), id, dto);
  }

  @Get('plans') plans() { return this.admin.listPlans(); }

  @Post('plans')
  createPlan(@CurrentUser() u: AuthUser, @Req() req: any, @Body() dto: CreatePlanDto) {
    return this.admin.createPlan(this.actor(u, req), dto);
  }

  @Patch('plans/:id')
  updatePlan(@CurrentUser() u: AuthUser, @Req() req: any, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.admin.updatePlan(this.actor(u, req), id, dto);
  }

  @Get('invoices')
  invoices(@Query() q: Record<string, string>) {
    return this.admin.listInvoices({ status: q.status, page: num(q.page), pageSize: num(q.pageSize) });
  }
}
