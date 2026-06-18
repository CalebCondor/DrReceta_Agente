import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { sessions, type SessionData } from '../../../agent/state';
import { executeTool } from '../../../agent/executor';
import { DbService } from '../../../agent/db.service';

const logger = new Logger('VoiceToolExecutor');

/**
 * Hash determinístico de un número de teléfono a un chatId numérico.
 * Mismo approach que usa el twilio.controller.ts para mapear phone → chatId.
 */
export function hashPhoneToChatId(phoneNumber: string): number {
  const clean = phoneNumber.replace(/\D/g, '');
  // Tomamos los primeros 13 dígitos del SHA-256 como BigInt para soportar >2^31
  const hex = createHash('sha256').update(clean).digest('hex').slice(0, 13);
  return Number(BigInt('0x' + hex) % BigInt(2_000_000_000));
}

/**
 * Inicializa o recupera la sesión del caller (residente/turista autenticado).
 * Devuelve el chatId que identifica al caller en el sistema de tools.
 */
export function getOrCreateSession(phoneNumber: string): number {
  const chatId = hashPhoneToChatId(phoneNumber);
  if (!sessions.has(chatId)) {
    // Sesión vacía — el caller no está autenticado todavía.
    // Las tools que requieren auth (ver AUTH_REQUIRED en executor.ts)
    // van a devolver error hasta que verifique código o lo que sea.
    logger.log(`[voice] nueva sesión chatId=${chatId} phone=${phoneNumber}`);
  }
  return chatId;
}

/**
 * Persiste la sesión cuando el caller se autentica durante la llamada
 * (ej: completa verificar_codigo).
 */
export function setSession(phoneNumber: string, data: SessionData): number {
  const chatId = hashPhoneToChatId(phoneNumber);
  sessions.set(chatId, data);
  logger.log(
    `[voice] sesión actualizada chatId=${chatId} us_id=${data.user_id} tipo=${data.user_type ?? 'n/a'}`,
  );
  return chatId;
}

/**
 * Ejecuta una tool de Claude reutilizando 100% el `executeTool()` del
 * agente de chat existente. No replica lógica — solo delega.
 *
 * @param toolName nombre de la tool (de las 16 definidas en src/agent/tools.ts)
 * @param toolInput argumentos que pasó Claude
 * @param phoneNumber teléfono del caller (para mapear a chatId)
 * @param db DbService (inyectado por el caller)
 * @returns string JSON con el resultado para devolver a Claude
 */
export async function executeVoiceTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  phoneNumber: string,
  db: DbService,
): Promise<string> {
  const chatId = getOrCreateSession(phoneNumber);
  try {
    return await executeTool(toolName, toolInput, chatId, db);
  } catch (e) {
    logger.error(`tool ${toolName} failed for chatId=${chatId}: ${String(e)}`);
    return JSON.stringify({
      success: false,
      error: `Error ejecutando ${toolName}: ${String(e)}`,
    });
  }
}
