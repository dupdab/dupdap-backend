import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

export class ForgotPasswordDto { @IsEmail() email: string; }

export class ResetPasswordDto {
  @IsString() token: string;
  @IsString() @MinLength(8) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/) password: string;
}
