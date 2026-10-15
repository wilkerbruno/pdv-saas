import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';

export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'] as const;

export class UpdateTenantDto {
  @IsOptional() @IsIn(TENANT_STATUSES as unknown as string[]) status?: (typeof TENANT_STATUSES)[number];
  @IsOptional() @IsString() planCode?: string;
  /** ISO-8601; envie null para limpar. */
  @IsOptional() @IsDateString() trialEndsAt?: string | null;
  @IsOptional() @IsDateString() currentPeriodEnd?: string | null;
  @IsOptional() @IsBoolean() fiscalEnabled?: boolean;
}

export class ExtendDto {
  @IsInt() @Min(1) @Max(366) days: number;
}

export class CreatePlanDto {
  @IsString() @Matches(/^[a-z0-9_-]{2,30}$/) code: string;
  @IsString() @MinLength(2) name: string;
  @IsInt() @Min(0) priceCents: number;
  @IsOptional() @IsInt() @Min(1) maxCashRegisters?: number;
  @IsOptional() @IsInt() @Min(1) maxStores?: number;
  @IsOptional() @IsBoolean() fiscalEnabled?: boolean;
  @IsOptional() @IsBoolean() integratedPos?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsInt() @Min(1) maxCashRegisters?: number;
  @IsOptional() @IsInt() @Min(1) maxStores?: number;
  @IsOptional() @IsBoolean() fiscalEnabled?: boolean;
  @IsOptional() @IsBoolean() integratedPos?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
