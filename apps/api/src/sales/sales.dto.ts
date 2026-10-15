import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

export class SaleItemDto {
  @IsString() variantId: string;
  @IsInt() @Min(1) @Max(10000) qty: number;
  /** Desconto no item, em centavos. */
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
}

export class PaymentDto {
  @IsIn(['CASH', 'PIX', 'DEBIT', 'CREDIT', 'STORE_CREDIT']) method: 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT' | 'STORE_CREDIT';
  @IsOptional() @IsIn(['MANUAL', 'MERCADOPAGO_POINT', 'MERCADOPAGO_PIX', 'PAGARME_STONE'])
  provider?: 'MANUAL' | 'MERCADOPAGO_POINT' | 'MERCADOPAGO_PIX' | 'PAGARME_STONE';
  @IsOptional() @IsInt() @Min(1) installments?: number;
  /** Valor que abate a venda, sem juros. O PDV calcula os juros pela política da loja. */
  @IsInt() @Min(1) amountCents: number;
  @IsOptional() @IsString() brand?: string;
  /** Maquininha escolhida para esta cobrança. */
  @IsOptional() @IsString() deviceId?: string;
}

export class CreateSaleDto {
  @IsOptional() @IsString() storeId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SaleItemDto) items: SaleItemDto[];
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  /** CPF ou CNPJ para constar na nota fiscal (só dígitos; máscara é removida). */
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^(\d{11}|\d{14})$/, { message: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)' })
  consumerDocument?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PaymentDto) payments: PaymentDto[];
}

export class AddPaymentDto extends PaymentDto {}

export class CancelSaleDto {
  @IsOptional() @IsString() reason?: string;
}
