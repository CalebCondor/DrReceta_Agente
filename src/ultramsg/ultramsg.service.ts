// src/ultramsg/ultramsg.service.ts
// Cliente de WhatsApp vía UltraMsg. Envía mensajes de texto a un teléfono
// (formato internacional, p.ej. +17876807222) o a un chatID (1787...@c.us).
//
// Contrato (docs.ultramsg.com/api/post/messages/chat):
//   POST {baseUrl}/{instanceId}/messages/chat
//   body: { token, to, body }
//   ok:   {"sent":"true","message":"ok","id":44897}
//   err:  {"Error":"..."} | {"error":{...}} | HTTP != 2xx

import { Injectable, Logger } from '@nestjs/common';
import { loadUltramsgConfig, type UltramsgConfig } from './ultramsg.config';

/** Máximo que acepta la API de UltraMsg. */
const MAX_BODY_LENGTH = 4096;

/** Timeout de la llamada a la API. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface UltramsgSendResult {
  success: boolean;
  message: string;
  /** Respuesta cruda de UltraMsg (JSON parseado o texto plano). */
  raw?: unknown;
}

@Injectable()
export class UltramsgService {
  private readonly logger = new Logger(UltramsgService.name);
  private readonly config: UltramsgConfig;

  constructor() {
    this.config = loadUltramsgConfig();
    if (!this.config.configured) {
      this.logger.warn(
        'Ultramsg sin credenciales: revisa ULTRAMSG_INSTANCE_ID y ULTRAMSG_TOKEN en el .env.',
      );
    }
  }

  /** ¿Hay credenciales de Ultramsg cargadas? */
  isConfigured(): boolean {
    return this.config.configured;
  }

  /**
   * Envía un mensaje de WhatsApp.
   *
   * @param to    teléfono internacional (+1787...) o chatID (1787...@c.us).
   *              Si va vacío se usa ULTRAMSG_TEST_TO.
   * @param body  texto del mensaje (máx. 4096 caracteres)
   */
  async sendMessage(
    to: string | undefined,
    body: string,
  ): Promise<UltramsgSendResult> {
    const destinatario = (to ?? '').trim() || this.config.testTo;
    const texto = (body ?? '').trim();

    if (!this.config.configured) {
      return this.fail(
        'Ultramsg no está configurado (ULTRAMSG_INSTANCE_ID / ULTRAMSG_TOKEN).',
      );
    }
    if (!destinatario) {
      return this.fail(
        'Falta el destinatario "to" y no hay ULTRAMSG_TEST_TO configurado.',
      );
    }
    if (!texto) {
      return this.fail('El mensaje "body" está vacío.');
    }
    if (texto.length > MAX_BODY_LENGTH) {
      return this.fail(
        `El mensaje excede los ${MAX_BODY_LENGTH} caracteres (${texto.length}).`,
      );
    }

    const url = this.config.apiUrl;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.config.token,
          to: destinatario,
          body: texto,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Error de red enviando WhatsApp a ${destinatario}: ${msg}`,
      );
      return this.fail(`No se pudo conectar con UltraMsg: ${msg}`);
    }

    const text = await response.text();
    const payload = parsePayload(text);

    if (!response.ok) {
      this.logger.error(
        `UltraMsg respondió HTTP ${response.status} para ${destinatario}: ${text.slice(0, 300)}`,
      );
      return this.fail(`UltraMsg respondió HTTP ${response.status}.`, payload);
    }

    const error = extractError(payload);
    if (error) {
      this.logger.error(
        `UltraMsg rechazó el mensaje a ${destinatario}: ${error}`,
      );
      return this.fail(error, payload);
    }

    this.logger.log(
      `WhatsApp enviado a ${destinatario} (HTTP ${response.status}).`,
    );
    return { success: true, message: extractMessage(payload), raw: payload };
  }

  private fail(message: string, raw?: unknown): UltramsgSendResult {
    return { success: false, message, raw };
  }
}

/** UltraMsg siempre responde JSON, pero si el body viene corrupto no se rompe. */
function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** La API reporta los fallos con `Error`, `error` o `sent:false`. */
function extractError(payload: unknown): string | null {
  const obj = asRecord(payload);
  if (!obj) return null;

  for (const key of ['Error', 'error']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    const nested = asRecord(value);
    if (nested) {
      const msg = nested['message'] ?? nested['code'];
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
  }

  if (obj['sent'] === 'false' || obj['sent'] === false) {
    const msg = obj['message'];
    return typeof msg === 'string' && msg.trim()
      ? msg.trim()
      : 'UltraMsg no envió el mensaje.';
  }

  return null;
}

function extractMessage(payload: unknown): string {
  const obj = asRecord(payload);
  if (!obj) return 'Mensaje enviado.';
  const msg = obj['message'] ?? obj['send_message'];
  return typeof msg === 'string' && msg.trim()
    ? msg.trim()
    : 'Mensaje enviado.';
}
