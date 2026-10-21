/*──────────────────────────────────────────────────────────────────────────
  CLIENTE HTTP DE LAS APIs EXTERNAS

  Este archivo es el ÚNICO punto por donde sale todo el tráfico hacia las
  APIs externas (`src/api/urls.ts`). Por eso el log de consola se
  instrumenta acá: todo endpoint —de los 18 actuales y de los que se
  agreguen después— queda cubierto sin tocar `tools.ts` ni `executor.ts`.

  El contrato de retorno NO cambia: siempre un objeto plano, y ante
  cualquier fallo `{ success: false, error }` para que el agente lo manejo
  sin romper el flujo.
  ─────────────────────────────────────────────────────────────────────────*/

import { logRequest, logResponse, logError, type ApiCallContext } from './api-logger';

/**
 * Convierte el cuerpo de la respuesta en el objeto que espera el agente.
 * Reproduce exactamente el parseo original: error por status, JSON.parse
 * si se puede, y `Respuesta no-JSON` si no.
 */
function parseText(r: Response, text: string): Record<string, unknown> {
  if (!r.ok) {
    return { success: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      error: `Respuesta no-JSON: ${text.slice(0, 200)}`,
    };
  }
}

/**
 * Ejecuta la llamada, mide cuánto tardó y registra request + response en la
 * consola. Los errores de red NUNCA se propagan: se devuelven como
 * `{ success: false, error }` igual que antes.
 */
async function runRequest(
  ctx: ApiCallContext,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  logRequest(ctx);

  try {
    const r = await fetch(ctx.url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    const payload = parseText(r, text);

    logResponse(ctx, {
      status: r.status,
      ok: r.ok,
      durationMs: Date.now() - startedAt,
      bytes: Buffer.byteLength(text, 'utf8'),
      payload,
    });

    return payload;
  } catch (e: unknown) {
    logError(ctx, { durationMs: Date.now() - startedAt, error: e });
    return { success: false, error: String(e) };
  }
}

export async function apiPost(
  url: string,
  data: Record<string, unknown> = {},
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return runRequest(
    { method: 'POST', url, request: data },
    { method: 'POST', headers, body: JSON.stringify(data) },
  );
}

export async function apiGet(
  url: string,
  params: Record<string, string> = {},
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const qs = new URLSearchParams(params).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;

  return runRequest(
    { method: 'GET', url: fullUrl, request: params },
    { method: 'GET', headers },
  );
}