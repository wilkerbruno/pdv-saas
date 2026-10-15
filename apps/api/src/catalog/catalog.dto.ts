import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class VariantDto {
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  /** Ex.: {"tamanho":"M","cor":"Azul"} */
  @IsOptional() @IsObject() attributes?: Record<string, string>;
  @IsInt() @Min(0) priceCents: number;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsInt() @Min(0) initialStock?: number;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
}

export class CreateProductDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() ncm?: string;
  @IsOptional() @IsString() cfop?: string;
  @IsOptional() @IsString() cest?: string;
  @IsOptional() @IsString() taxCode?: string;
  /** Token devolvido por GET /barcode-info para anexar a foto encontrada. */
  @IsOptional() @IsString() imageToken?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants: VariantDto[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() ncm?: string;
  @IsOptional() @IsString() cfop?: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @IsString() cest?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Token de GET /barcode-info: troca a foto pela encontrada na busca. */
  @IsOptional() @IsString() imageToken?: string;
  @IsOptional() @IsBoolean() removeImage?: boolean;
}

export class UploadImageDto {
  @IsString() mime: string;
  /** Imagem em base64 (sem o prefixo data:). */
  @IsString() data: string;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsObject() attributes?: Record<string, string>;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateCategoryDto {
  @IsString() @MinLength(2) name: string;
}
