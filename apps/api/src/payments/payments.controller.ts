import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { PaymentsService } from './payments.service';

class PolicyDto {
  @IsOptional() @IsInt() @Min(1) @Max(24) maxInstallments?: number;
  @IsOptional() @IsInt() @Min(1) @Max(24) freeInstallments?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) monthlyRateBps?: number;
  @IsOptional() @IsInt() @Min(0) minInstallmentCents?: number;
  @IsOptional() @IsBoolean() customerPaysInterest?: boolean;
}

class QuoteQuery {
  @Type(() => Number) @IsInt() @Min(1) amountCents: number;
}

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  /** Opções de parcelas com juros para a tela de pagamento. */
  @Get('installments')
  installments(@CurrentUser() u: AuthUser, @Query() q: QuoteQuery) {
    return this.payments.quote(u.tenantId, q.amountCents);
  }

  @Get('policy') policy(@CurrentUser() u: AuthUser) {
    return this.payments.policy(u.tenantId);
  }

  @Roles('OWNER', 'MANAGER') @Put('policy')
  updatePolicy(@CurrentUser() u: AuthUser, @Body() dto: PolicyDto) {
    return this.payments.updatePolicy(u.tenantId, dto);
  }
}
