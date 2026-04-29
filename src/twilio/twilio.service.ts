import { Injectable } from '@nestjs/common';
import twilio, { Twilio } from 'twilio';

@Injectable()
export class TwilioService {
  private client: Twilio;
  private from: string;
  private verifySid: string;

  constructor() {
    const accountSid = this.requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = this.requireEnv('TWILIO_AUTH_TOKEN');
    this.from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    this.verifySid = process.env.TWILIO_VERIFY_SID || '';
    this.client = twilio(accountSid, authToken);
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  async sendWhatsAppMessage(to: string, body: string) {
    return await this.client.messages.create({
      from: this.from,
      to,
      body,
    });
  }

  async sendSmsVerificationCode(phone: string): Promise<void> {
    await this.client.verify.v2
      .services(this.verifySid)
      .verifications.create({ to: phone, channel: 'sms' });
  }

  async verifySmsCode(phone: string, code: string): Promise<boolean> {
    const check = await this.client.verify.v2
      .services(this.verifySid)
      .verificationChecks.create({ to: phone, code });

    return check.status === 'approved';
  }
}
