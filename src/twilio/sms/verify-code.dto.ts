import { IsPhoneNumber, IsString, Length } from 'class-validator';

export class VerifyCodeDto {
  @IsPhoneNumber()
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
