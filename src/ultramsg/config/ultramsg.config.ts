// src/ultramsg/ultramsg.config.ts
// Configuración del cliente de WhatsApp (Ultramsg) leída del entorno.
//
// Variables requeridas en el .env:
//   ULTRAMSG_BASE_URL     base de la API   (default: https://api.ultramsg.com)
//   ULTRAMSG_INSTANCE_ID  id de la instancia de Ultramsg
//   ULTRAMSG_TOKEN        token de la instancia
//   ULTRAMSG_TEST_TO      destinatario por defecto cuando el request no trae
//                         "to". UltraMsg NO tiene sandbox: todo mensaje sale
//                         real por WhatsApp. Lo normal es apuntar al número de
//                         la propia instancia (el del QR) — se obtiene en
//                         GET /{instance_id}/instance/me → { id: "<num>@c.us" }.
//
// Las URLs de la API son `/{instance_id}/messages/chat`, así que el id de la
// instancia va en la ruta y el token en el body.

export const DEFAULT_BASE_URL = 'https://api.ultramsg.com';

/**
 * Valores que UltraMsg usa en sus ejemplos de documentación. Si el .env los
 * tiene tal cual, la instancia NO está configurada de verdad: es mejor fallar
 * con un mensaje claro que mandar una request que va a ser rechazada.
 */
const PLACEHOLDERS = new Set(['tu_id_de_instancia', 'tu_token']);

export interface UltramsgConfig {
  baseUrl: string;
  instanceId: string;
  token: string;
  /** URL final de envío (ya con el instance id si corresponde). */
  apiUrl: string;
  /** Destinatario por defecto cuando el request no trae "to". */
  testTo: string;
  /** ¿Hay credenciales utilizables (no placeholders, no vacías)? */
  configured: boolean;
}

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function isUsable(value: string): boolean {
  return value.length > 0 && !PLACEHOLDERS.has(value.toLowerCase());
}

/**
 * La API de envío es `{base}/{instance_id}/messages/chat`.
 *
 * El .env puede traer la base CON el id ya incluido (p.ej.
 * `https://api.ultramsg.com/instance170610/`, que es como lo muestra el panel
 * de UltraMsg) o solo el dominio. En ambos casos el id no se duplica.
 */
function buildSendUrl(baseUrl: string, instanceId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (!instanceId) return `${base}/messages/chat`;
  return base.endsWith(`/${instanceId}`)
    ? `${base}/messages/chat`
    : `${base}/${instanceId}/messages/chat`;
}

/** Lee la configuración desde el entorno. */
export function loadUltramsgConfig(
  env: NodeJS.ProcessEnv = process.env,
): UltramsgConfig {
  const baseUrl =
    clean(env.ULTRAMSG_BASE_URL).replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const instanceId = clean(env.ULTRAMSG_INSTANCE_ID);
  const token = clean(env.ULTRAMSG_TOKEN);

  return {
    baseUrl,
    instanceId,
    token,
    apiUrl: buildSendUrl(baseUrl, instanceId),
    testTo: clean(env.ULTRAMSG_TEST_TO),
    configured: isUsable(instanceId) && isUsable(token),
  };
}
