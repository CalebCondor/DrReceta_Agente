/*──────────────────────────────────────────────────────────────────────────
  LOGGER DE CONSOLA PARA LAS APIs EXTERNAS

  Estos endpoints (`src/api/urls.ts`) devuelven mucha data — catálogos de
  planes, KPIs por médico, facturación por manejado/auditor — y cuando algo
  falla hay que ver EXACTAMENTE qué se mandó y qué volvió, sin inundar la
  consola con 200 KB de JSON.

  Este módulo centraliza ese trabajo. Se invoca desde `src/api/http.ts`
  (`apiPost` / `apiGet`), que es el ÚNICO punto por donde pasa todo el
  tráfico hacia las APIs externas. Por eso no hay que tocar cada tool ni
  cada executor: instrumentar `http.ts` cubre automáticamente todos los
  endpoints de `urls.ts`, presentes y futuros.

  Variables de entorno:
    - `API_LOG`            `false` apaga el log por completo (útil en Docker).
    - `API_LOG_COLOR`      `true|false` fuerza color on/off (auto: solo con TTY).
    - `API_LOG_PREVIEW`    caracteres del preview de response (default 1200).
    - `API_LOG_PREVIEW_REQUEST` tope de seguridad del request (default 4000).

  Request vs response — NO son simétricos a propósito:
    • El REQUEST se imprime COMPLETO, una clave por línea. Son los valores
      que el agente pidió, y hacen falta todos para auditar la consulta.
    • La RESPONSE se recorta a una línea. Son decenas de KB y con ver el
      tamaño + la forma + los primeros elementos alcanza para diagnosticar.

  Paleta: azul = endpoint, cian = timings y claves, verde = OK,
  rojo = error, amarillo = valores enviados, gris = etiquetas.

  Salida típica:

    [AuditaAPI] ▶  POST http://localhost:5146/api/IaPreguntas/desempeno-medico
    [AuditaAPI]    request : { anio: 2024, idHospitales: [ 12, 14 ] }
    [AuditaAPI] ◀  200 · 312 ms · 48.2 KB · array(37 elementos)
    [AuditaAPI]    response: [ { idMedicoAlta: 101, ... } ]   … +42.130 chars
  ─────────────────────────────────────────────────────────────────────────*/

import { Logger } from '@nestjs/common';
import { inspect } from 'node:util';

/** `false` apaga todo el log (se evalúa al cargar el módulo). */
const ENABLED = process.env.API_LOG?.toLowerCase() !== 'false';

/** Máx. caracteres del preview de la response (que es la que pesa). */
const MAX_RESPONSE_PREVIEW = Number(process.env.API_LOG_PREVIEW ?? 1200);

/**
 * Tope de seguridad del request. El request se imprime COMPLETO — son los
 * valores que el agente decidió pedir y hay que verlos todos — pero si algún
 * día llega un body absurdo (500 ids de hospital) se corta aquí para no
 * saturar la consola. En uso real nunca se llega a este tope.
 */
const MAX_REQUEST_CHARS = Number(process.env.API_LOG_PREVIEW_REQUEST ?? 4000);

const logger = new Logger('AuditaAPI');

/*──────────────────────────────────────────────────────────────────────────
  COLOR EN CONSOLA

  El `Logger` de Nest solo colorea el prefijo (`LOG` / `WARN` / `ERROR`); el
  mensaje en sí sale plano. Estos códigos ANSI colorean el contenido para que
  el endpoint y su respuesta se distinguan de un vistazo.

  Se apaga SOLO si la salida no es una terminal (Docker, CI, `| grep`, PM2
  collecting logs) porque ahí los códigos se verían como texto basura. Se
  puede forzar con `API_LOG_COLOR=true|false`.
  ─────────────────────────────────────────────────────────────────────────*/

const ANSI = {
  bold: 1,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  gray: 90,
} as const;

type ColorName = keyof typeof ANSI;

const COLOR_ENABLED =
  process.env.API_LOG_COLOR?.toLowerCase() !== 'false' && Boolean(process.stdout.isTTY);

/** Colorea un fragmento. Sin TTY devuelve el texto tal cual, sin escapes. */
function c(name: ColorName, text: string): string {
  if (!COLOR_ENABLED) return text;
  return `\x1b[${ANSI[name]}m${text}\x1b[0m`;
}

/*──────────────────────────────────────────────────────────────────────────
  HELPERS DE FORMATO
  ─────────────────────────────────────────────────────────────────────────*/

/**
 * Deja el objeto como texto de UNA SOLA LÍNEA y recortado.
 *
 * Todo se fuerza a una línea a propósito: en consola Nest cada línea lleva
 * prefijo de timestamp, así que una respuesta partida en 40 renglones es
 * ilegible. `util.inspect` con `breakLength: Infinity` resuelve eso y además
 * recorta strings largos y arrays anidados sin perder la forma del objeto.
 */
function preview(value: unknown, maxChars: number): string {
  const text = inspect(value, {
    depth: 2,
    maxArrayLength: 4,
    maxStringLength: 80,
    breakLength: Number.POSITIVE_INFINITY,
    compact: true,
  });

  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}… +${(text.length - maxChars).toLocaleString('es-PE')} chars`;
}

/**
 * Resumen de UNA LÍNEA del payload: cuántos elementos trae, cuántas claves,
 * el tamaño de los arrays anidados, y una muestra recortada. Con esto se
 * sabe de un vistazo si la respuesta trajo 3 registros o 37, sin volcar los
 * 48 KB completos al log.
 */
function summarize(value: unknown, maxChars: number): string {
  // Array → muestra los primeros 2 elementos.
  if (Array.isArray(value)) {
    const n = value.length;
    const sample = value
      .slice(0, 2)
      .map((v) => preview(v, 150))
      .join(', ');
    const rest = n > 2 ? c('gray', `, +${n - 2} más`) : '';
    return `${c('blue', `array(${n})`)} [ ${sample}${rest} ]`;
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return `${c('blue', 'object(0)')} {}`;

    // Los arrays anidados se anotan aparte porque es donde está el volumen.
    const arrays = keys
      .filter((k) => Array.isArray(obj[k]))
      .map((k) => `${c('cyan', k)}${c('gray', `[${(obj[k] as unknown[]).length}]`)}`);

    const head = `${c('blue', `object(${keys.length})`)} { ${preview(obj, maxChars)} }`;
    return arrays.length > 0 ? `${head} ${c('gray', '·')} ${c('gray', 'arrays:')} ${arrays.join(', ')}` : head;
  }

  return `${c('blue', typeof value)} ${String(value)}`;
}

/*──────────────────────────────────────────────────────────────────────────
  FORMATO DEL REQUEST — COMPLETO, una clave por línea

  A diferencia de la response, acá NO se recorta nada: son los valores que el
  agente decidió pedir (anio, meses, idHospitales, loc, …) y hacen falta
  todos para verificar que la consulta se armó bien. Ir multilínea es lo que
  lo hace legible — el body de `buildIaPreguntasBody` tiene hasta 8 claves.
  ─────────────────────────────────────────────────────────────────────────*/

/** Un valor del body, sin recortar. Los arrays se desplegan enteros. */
function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) {
    if (v.length === 0) return c('gray', '[] (sin elementos)');
    return `[ ${v.map((x) => formatValue(x)).join(', ')} ]`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

/** Sangría de cada clave del body, para que quede bajo el `request:`. */
const INDENT = '     ';

/** Imprime el body completo, una línea por clave, coloreado. */
function formatRequest(request: unknown): string {
  if (request === null || request === undefined) {
    return `${INDENT}${c('gray', '(sin body)')}`;
  }

  if (typeof request !== 'object' || Array.isArray(request)) {
    return `${INDENT}${c('yellow', formatValue(request))}`;
  }

  const entries = Object.entries(request as Record<string, unknown>);
  if (entries.length === 0) {
    return `${INDENT}${c('gray', '(sin body)')}`;
  }

  const body = entries
    .map(([k, v]) => `${INDENT}${c('cyan', k)}: ${c('yellow', formatValue(v))}`)
    .join('\n');

  // Tope de seguridad por si algún día llega un body enorme.
  if (body.length <= MAX_REQUEST_CHARS) return body;

  return (
    `${body.slice(0, MAX_REQUEST_CHARS)}\n${INDENT}` +
    c('gray', `… +${body.length - MAX_REQUEST_CHARS} chars (sube API_LOG_PREVIEW_REQUEST para ver todo)`)
  );
}

/** Humaniza los bytes: 3120 → "3.0 KB". */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Friendly name del endpoint a partir de la URL, para leerlo de un vistazo. */
function endpointLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '/');
  } catch {
    return url;
  }
}

/*──────────────────────────────────────────────────────────────────────────
  API PÚBLICA — la usan `apiPost` / `apiGet` de `./http`
  ─────────────────────────────────────────────────────────────────────────*/

export interface ApiCallContext {
  /** Método HTTP usado. */
  method: 'GET' | 'POST';
  /** URL completa a la que se llama (puede traer query string). */
  url: string;
  /** Parámetros del GET o body del POST. Puede venir vacío. */
  request?: unknown;
}

/** Log del request saliente, con TODOS los valores enviados. */
export function logRequest({ method, url, request }: ApiCallContext): void {
  if (!ENABLED) return;

  logger.log(`${c('cyan', '▶')}  ${c('blue', `${method} ${url}`)}`);
  logger.log(`   ${c('gray', 'request:')}\n${formatRequest(request)}`);
}

/** Log del response con status, duración, tamaño y preview recortado. */
export function logResponse(
  ctx: ApiCallContext,
  info: { status: number; ok: boolean; durationMs: number; bytes: number; payload: unknown },
): void {
  if (!ENABLED) return;

  const sep = c('gray', ' · ');
  const arrow = info.ok ? c('green', '◀') : c('red', '✖');
  const status = info.ok
    ? c('green', `${info.status} OK`)
    : c('red', `${info.status} ERROR`);

  logger.log(
    `${arrow}  ${status}${sep}${c('cyan', `${info.durationMs} ms`)}${sep}` +
      `${c('cyan', humanBytes(info.bytes))}${sep}${c('blue', endpointLabel(ctx.url))}`,
  );

  if (info.ok) {
    logger.log(`   ${c('gray', 'response:')} ${summarize(info.payload, MAX_RESPONSE_PREVIEW)}`);
  } else {
    // En error lo que importa es el mensaje completo, no el shape.
    logger.warn(`   ${c('gray', 'response:')} ${preview(info.payload, MAX_RESPONSE_PREVIEW)}`);
  }
}

/** Log de excepción de red (timeout, ECONNREFUSED, DNS, etc.). */
export function logError(
  ctx: ApiCallContext,
  info: { durationMs: number; error: unknown },
): void {
  if (!ENABLED) return;

  const msg = info.error instanceof Error ? info.error.message : String(info.error);
  logger.error(
    `${c('red', '✖')}  ${c('red', 'EXCEPCIÓN')} ${c('gray', '·')} ${c('cyan', `${info.durationMs} ms`)} ` +
      `${c('gray', '·')} ${c('blue', `${ctx.method} ${ctx.url}`)}\n` +
      `   ${c('gray', 'error   :')} ${c('yellow', msg)}\n` +
      `   ${c('gray', '(la tool devolverá { success: false } al agente)')}`,
  );
}