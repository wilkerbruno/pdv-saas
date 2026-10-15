import { Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

export class CreateCustomerDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() document?: string;
  @IsOptional() @IsEmail() email?: string;
}

export class CreditDto {
  @IsInt() @Min(1) amountCents: number;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string, q?: string) {
    return this.prisma.customer.findMany({
      where: { tenantId, ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({ data: { tenantId, ...dto } });
  }

  async addCredit(tenantId: string, id: string, amountCents: number) {
    const r = await this.prisma.customer.updateMany({
      where: { id, tenantId },
      data: { creditBalanceCents: { increment: amountCents } },
    });
    if (r.count === 0) throw new NotFoundException('Cliente não encontrado');
    return this.prisma.customer.findUnique({ where: { id } });
  }
}

@Controller('customers')
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('q') q?: string) {
    return this.customers.list(u.tenantId, q);
  }

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(u.tenantId, dto);
  }

  /** Lança vale-troca/crédito para o cliente (ex.: troca de roupa sem reposição). */
  @Roles('OWNER', 'MANAGER') @Post(':id/credit')
  credit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreditDto) {
    return this.customers.addCredit(u.tenantId, id, dto.amountCents);
  }
}
