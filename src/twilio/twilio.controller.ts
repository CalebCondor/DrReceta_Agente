import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { OllamaService } from '../ollama/ollama.service';
import type { Request, Response } from 'express';
import { SendVerificationDto } from './sms/send-verification.dto';
import { VerifyCodeDto } from './sms/verify-code.dto';

@Controller('twilio')
export class TwilioController {
  constructor(
    private readonly twilioService: TwilioService,
    private readonly ollamaService: OllamaService,
  ) {}

  @Post('webhook')
  async handleTwilioWebhook(@Req() req: Request, @Res() res: Response) {
    const body = req.body as { Body?: string; From?: string };
    const incomingMsg = body.Body ?? '';
    const from = body.From ?? '';
    console.log('--- Twilio Webhook Received ---');
    console.log('From:', from);
    console.log('Incoming Message:', incomingMsg);
    // Procesar el mensaje con Ollama
    let response = '';
    try {
      response = await this.ollamaService.runGemma3(incomingMsg);
      console.log('Ollama Response:', response);
    } catch (err) {
      console.error('Error llamando a Ollama:', err);
    }
    if (!response || !response.trim()) {
      console.warn('Respuesta vacía de Ollama');
      response = 'No entendí tu mensaje, ¿puedes intentarlo de nuevo?';
    }
    // Responder usando TwilioService
    try {
      await this.twilioService.sendWhatsAppMessage(from, response);
      console.log('Mensaje enviado a Twilio');
    } catch (err) {
      console.error('Error enviando mensaje a Twilio:', err);
    }
    res.status(200).send('OK');
  }

  /**
   * POST /twilio/sms/send-verification
   * Body: { "phone": "+521234567890" }
   * Genera un código de 6 dígitos y lo envía al número indicado por SMS.
   */
  @Post('sms/send-verification')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async sendVerification(@Body() dto: SendVerificationDto) {
    await this.twilioService.sendSmsVerificationCode(dto.phone);
    return { message: 'Código de verificación enviado por SMS.' };
  }

  /**
   * POST /twilio/sms/verify-code
   * Body: { "phone": "+521234567890", "code": "123456" }
   * Retorna { verified: true } si el código es correcto y no expiró.
   */
  @Post('sms/verify-code')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async verifyCode(@Body() dto: VerifyCodeDto) {
    const verified = await this.twilioService.verifySmsCode(
      dto.phone,
      dto.code,
    );
    return { verified };
  }
}
