import { Controller, Post, Body, Header, Query, Logger } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { AgentService } from '../agent/agent.service';
import twilio from 'twilio';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

/** Tipos de los parámetros enviados por Twilio en webhooks (application/x-www-form-urlencoded) */
type TwilioParams = Record<string, string | undefined>;

type SayAttributes = VoiceResponse.SayAttributes;
type GatherAttributes = VoiceResponse.GatherAttributes;

const POLLY_LUCIA: SayAttributes = {
  voice: 'Polly.Lucia',
  language: 'es-ES',
};

const GATHER_BASE: GatherAttributes = {
  method: 'POST',
  timeout: 5,
  speechTimeout: 'auto',
  maxSpeechTime: 15,
};

const buildActionUrl = (path: string): string =>
  `${process.env.API_URL || 'http://localhost:3000'}/api/twilio/${path}`;

@Controller('twilio')
export class TwilioController {
  private readonly logger = new Logger(TwilioController.name);

  constructor(
    private readonly twilioService: TwilioService,
    private readonly agentService: AgentService,
  ) {}

  /**
   * Webhook para manejar llamadas entrantes
   * Twilio envía POST con parámetros de la llamada
   */
  @Post('voice-webhook')
  @Header('Content-Type', 'application/xml')
  handleIncomingCall(
    @Body() body: TwilioParams,
    @Query() query: TwilioParams,
  ): string {
    try {
      const { From, To, CallSid } = { ...body, ...query };

      this.logger.log(
        `Incoming call: From=${From}, To=${To}, CallSid=${CallSid}`,
      );

      const twiml = new twilio.twiml.VoiceResponse();

      // Mensaje de bienvenida adaptado para voz
      const welcomeMessage =
        'Bienvenido a IslandMed. ¿Cómo estás hoy? Cuéntame qué te trae a nuestra línea.';

      twiml.say(POLLY_LUCIA, welcomeMessage);

      // Recopilar entrada de voz del usuario
      const gather = twiml.gather({
        ...GATHER_BASE,
        action: buildActionUrl('process-speech'),
      });

      gather.say(POLLY_LUCIA, 'Por favor, habla tu mensaje después del tono.');

      // Si no hay respuesta, repetir
      twiml.say(POLLY_LUCIA, 'No escuché tu respuesta. Intentemos de nuevo.');
      twiml.redirect('/api/twilio/voice-webhook');

      return twiml.toString();
    } catch (error) {
      this.logger.error('Error handling incoming call:', error);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say(POLLY_LUCIA, 'Lo sentimos, ocurrió un error. Desconectando.');
      twiml.hangup();
      return twiml.toString();
    }
  }

  /**
   * Webhook para procesar el texto/voz del usuario
   * Twilio convierte voz a texto y lo envía aquí
   */
  @Post('process-speech')
  @Header('Content-Type', 'application/xml')
  async processSpeech(
    @Body() body: TwilioParams,
    @Query() query: TwilioParams,
  ): Promise<string> {
    try {
      const { SpeechResult, CallSid, From, Confidence } = {
        ...body,
        ...query,
      };

      this.logger.log(
        `Speech received: CallSid=${CallSid}, Text="${SpeechResult}", Confidence=${Confidence}`,
      );

      // Validar confianza del reconocimiento de voz
      const confidence = parseFloat(Confidence ?? '0');
      if (!SpeechResult || confidence < 0.5) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say(
          POLLY_LUCIA,
          'Disculpa, no estoy seguro de lo que dijiste. ¿Podrías repetirlo?',
        );
        const gather = twiml.gather({
          ...GATHER_BASE,
          action: buildActionUrl('process-speech'),
        });
        gather.say(POLLY_LUCIA, 'Habla por favor.');
        return twiml.toString();
      }

      // Usar el servicio de agente con indicador de canal de voz
      const chatId = this.hashPhoneToId(From ?? '');
      const agentResponse = await this.agentService.chat(
        chatId,
        SpeechResult,
        `Voice_${From}`, // Nombre que indica que es voz
      );

      // Responder con síntesis de voz
      const twiml = new twilio.twiml.VoiceResponse();

      // Si la respuesta es larga, dividirla en párrafos
      const responseText = this.stripHtml(agentResponse || '');
      const paragraphs = responseText.split('\n').filter((p) => p.trim());

      for (const paragraph of paragraphs.slice(0, 3)) {
        // Limitar a 3 párrafos en voz
        twiml.say(POLLY_LUCIA, paragraph);
        // Pausa entre párrafos
        twiml.pause({ length: 1 });
      }

      // Pedir siguiente acción
      twiml.say(POLLY_LUCIA, '¿Hay algo más en lo que pueda ayudarte?');

      const gather = twiml.gather({
        ...GATHER_BASE,
        action: buildActionUrl('process-speech'),
      });
      gather.say(POLLY_LUCIA, 'Habla por favor.');

      return twiml.toString();
    } catch (error) {
      this.logger.error('Error processing speech:', error);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say(
        POLLY_LUCIA,
        'Ocurrió un error procesando tu solicitud. Intentemos de nuevo.',
      );
      twiml.redirect('/api/twilio/voice-webhook');
      return twiml.toString();
    }
  }

  /**
   * Webhook de estado de llamadas (CallStatus)
   * Twilio notifica cambios en el estado de la llamada
   */
  @Post('call-status')
  handleCallStatus(@Body() body: TwilioParams): { status: string } {
    try {
      const { CallSid, CallStatus, RecordingSid } = body;

      this.logger.log(
        `Call status updated: CallSid=${CallSid}, Status=${CallStatus}, Recording=${RecordingSid}`,
      );

      // Registrar eventos si es necesario
      // Aquí podrías guardar logs o métricas

      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Error handling call status:', error);
      throw error;
    }
  }

  /**
   * Inicia una llamada saliente para confirmación o notificación
   */
  @Post('initiate-call')
  async initiateCall(
    @Body()
    payload: {
      to: string;
      message: string;
      webhookUrl?: string;
    },
  ): Promise<{ callSid: string; status: string }> {
    try {
      const webhookUrl = payload.webhookUrl || buildActionUrl('process-speech');

      const result = await this.twilioService.initiateOutboundCall(
        payload.to,
        payload.message,
        webhookUrl,
      );

      return result;
    } catch (error) {
      this.logger.error('Error initiating call:', error);
      throw error;
    }
  }

  /**
   * Convierte número de teléfono a ID de chat consistente
   */
  private hashPhoneToId(phone: string): number {
    // Normalizar el número y crear un hash determinístico
    const normalized = phone.replace(/\D/g, '');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convertir a número entero de 32 bits
    }
    return Math.abs(hash) % 1000000; // Limitar a 6 dígitos
  }

  /**
   * Elimina etiquetas HTML de un texto
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Elimina tags HTML
      .replace(/&nbsp;/g, ' ')
      .replace(/"/g, '"')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .trim();
  }
}
