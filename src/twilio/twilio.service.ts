import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

type SayAttributes = VoiceResponse.SayAttributes;
type GatherAttributes = VoiceResponse.GatherAttributes;

interface VoiceResponseOptions {
  recordAudio?: boolean;
  gatherNumDigits?: number;
  gatherMaxSpeechTime?: number;
  noSpeechTimeout?: number;
  redirectUrl?: string;
}

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private twilioClient: twilio.Twilio | null = null;
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly twilioPhone: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    this.twilioPhone = process.env.TWILIO_PHONE_NUMBER ?? '';

    if (this.accountSid && this.authToken) {
      this.twilioClient = twilio(this.accountSid, this.authToken);
    }
  }

  /**
   * Genera TwiML para una llamada de voz con síntesis de texto
   * @param message - Mensaje a convertir a voz
   * @param recordAudio - Si debe grabar la respuesta del usuario
   * @param gatherNumDigits - Número de dígitos a esperar (para códigos, menús)
   * @returns TwiML XML
   */
  generateVoiceResponse(
    message: string,
    options: VoiceResponseOptions = {},
  ): string {
    const twiml = new twilio.twiml.VoiceResponse();

    // Detecta idioma y ajusta configuración de voz
    const sayOptions: SayAttributes = this.isSpanish(message)
      ? { voice: 'Polly.Lucia', language: 'es-ES' }
      : { voice: 'alice' };

    twiml.say(sayOptions, message);

    // Si debe recopilar entrada de voz (Gather with speech recognition)
    if (options.recordAudio) {
      const gatherOptions: GatherAttributes = {
        timeout: options.noSpeechTimeout ?? 5,
        maxSpeechTime: options.gatherMaxSpeechTime ?? 10,
        speechTimeout: 'auto',
        actionOnEmptyResult: false,
      };

      if (options.gatherNumDigits !== undefined) {
        gatherOptions.numDigits = options.gatherNumDigits;
      }

      if (options.redirectUrl) {
        gatherOptions.action = options.redirectUrl;
        gatherOptions.method = 'POST';
      }

      const gather = twiml.gather(gatherOptions);
      const prompt: SayAttributes = { voice: 'Polly.Lucia', language: 'es-ES' };
      const promptMessage = options.gatherNumDigits
        ? 'Por favor, ingresa tu respuesta.'
        : 'Por favor, habla tu respuesta después del tono.';
      gather.say(prompt, promptMessage);
    }

    return twiml.toString();
  }

  /**
   * Detecta si un texto está en español
   */
  private isSpanish(text: string): boolean {
    const spanishWords = [
      'es',
      'la',
      'de',
      'el',
      'que',
      'por',
      'los',
      'del',
      'y',
      'a',
    ];
    const words = text.toLowerCase().split(/\s+/);
    const spanishMatches = words.filter((w) => spanishWords.includes(w)).length;
    return spanishMatches > text.length * 0.15;
  }

  /**
   * Inicia una llamada saliente
   * @param to - Número de teléfono a llamar
   * @param message - Mensaje inicial
   * @param webhookUrl - URL del webhook para procesar respuestas
   */
  async initiateOutboundCall(
    to: string,
    message: string,
    webhookUrl: string,
  ): Promise<{ callSid: string; status: string }> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }

    try {
      const twiml = this.generateVoiceResponse(message, {
        recordAudio: true,
        redirectUrl: webhookUrl,
      });

      const call = await this.twilioClient.calls.create({
        to,
        from: this.twilioPhone,
        twiml,
        record: true,
        recordingChannels: 'mono',
      });

      this.logger.log(`Outbound call initiated: ${call.sid}`);
      return {
        callSid: call.sid,
        status: call.status,
      };
    } catch (error) {
      this.logger.error('Error initiating outbound call:', error);
      throw error;
    }
  }

  /**
   * Obtiene información de una llamada
   */
  async getCallInfo(callSid: string): Promise<unknown> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }

    try {
      const call = await this.twilioClient.calls(callSid).fetch();
      return call;
    } catch (error) {
      this.logger.error('Error fetching call info:', error);
      throw error;
    }
  }

  /**
   * Obtiene la grabación de una llamada
   */
  async getRecording(recordingSid: string): Promise<unknown> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }

    try {
      const recording = await this.twilioClient
        .recordings(recordingSid)
        .fetch();
      return recording;
    } catch (error) {
      this.logger.error('Error fetching recording:', error);
      throw error;
    }
  }

  /**
   * Termina una llamada activa
   */
  async endCall(callSid: string): Promise<void> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }

    try {
      await this.twilioClient.calls(callSid).update({ status: 'completed' });
      this.logger.log(`Call ended: ${callSid}`);
    } catch (error) {
      this.logger.error('Error ending call:', error);
      throw error;
    }
  }

  /**
   * Envía un SMS
   */
  async sendSMS(to: string, message: string): Promise<string> {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }

    try {
      const msg = await this.twilioClient.messages.create({
        body: message,
        from: this.twilioPhone,
        to,
      });

      this.logger.log(`SMS sent: ${msg.sid}`);
      return msg.sid;
    } catch (error) {
      this.logger.error('Error sending SMS:', error);
      throw error;
    }
  }
}
