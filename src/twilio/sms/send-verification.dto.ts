import { IsPhoneNumber } from 'class-validator';

export class SendVerificationDto {
  @IsPhoneNumber()
  phone!: string;
}
