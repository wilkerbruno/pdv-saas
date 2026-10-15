import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(2) companyName: string;
  @IsOptional() @IsString() document?: string;
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() planCode?: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

export class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsIn(['MANAGER', 'CASHIER']) role: 'MANAGER' | 'CASHIER';
}
