// src/ultramsg/chat-id.ts
// Deriva el `chat_id` (BIGINT) que usa el agente a partir del id de WhatsApp
// que manda Ultramsg en el webhook.
//
// Ultramsg manda el remitente como chatID: "51993314858@c.us" para un
// contacto y "120363228356317247-441234567890@g.us" para un grupo.
//
// Para un contacto se usa el número tal cual (51993314858): es legible en el
// panel y no colisiona con los `us_id` secuenciales de DrReceta (1, 2, 3...).
// Para grupos (o ids raros) se usa un hash determinista con offset, para no
// salirse del rango seguro de enteros de JS.

/** Rango reservado para los chat_id derivados de un id no numérico. */
const HASH_OFFSET = 10_000_000_000_000; // 1e13

/** Máximo 12 dígitos: cubre los números con código de país reales. */
const MAX_PHONE_DIGITS = 12;

/**
 * Hash FNV-1a de 32 bits, recortado a 1e9 para que quepa holgadamente en el
 * offset sin pasar de MAX_SAFE_INTEGER.
 */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 1_000_000_000;
}

/**
 * @param whatsappId chatID de Ultramsg, p.ej. "51993314858@c.us"
 * @returns chat_id determinista para ese remitente
 */
export function chatIdFromWhatsappId(whatsappId: string): number {
  const id = (whatsappId ?? '').trim();
  // "120363228356317247-441234567890@g.us" → "120363228356317247"
  const local = id.split('@')[0].split('-')[0] ?? '';
  const digits = local.replace(/\D/g, '');

  if (digits.length >= 8 && digits.length <= MAX_PHONE_DIGITS) {
    return Number(digits);
  }
  return HASH_OFFSET + hash32(id);
}
