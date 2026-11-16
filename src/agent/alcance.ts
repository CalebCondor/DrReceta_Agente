/*──────────────────────────────────────────────────────────────────────────
  ALCANCE HOSPITALARIO DEL USUARIO (multi-tenant)

  En Audita un usuario sólo puede consultar los hospitales a los que tiene
  acceso (tabla `Usuario_Hospital`). El backend .NET resuelve ese alcance
  en `GET /api/hospitales/acceso`: cuando la request lleva JWT, devuelve
  SOLO los hospitales asignados al usuario autenticado (no el catálogo
  global del tenant).

  Este módulo es el puente entre ese endpoint y el resto del agente:

    1. `extraerToken`      — saca el JWT del header `Authorization: Bearer`
                             o del campo `token` del body de `POST /api/chat`.
    2. `resolverAlcance`   — consulta `/api/hospitales/acceso` con el token
                             y guarda el alcance (ids + nombres) en la
                             sesión en memoria (`sessions`), con caché por
                             chat para no pegarle al backend en cada turno.
    3. `aplicarAlcanceHospitales` — recorta el body de las tools de datos:
                             filtra `idHospitales` contra el alcance real y
                             convierte `global: true` en la lista permitida.

  IMPORTANTE: el token NUNCA se loguea ni se devuelve en una respuesta al
  usuario. Solo vive en memoria, en la sesión del chat.
  ─────────────────────────────────────────────────────────────────────────*/

import { Logger } from '@nestjs/common';
import { apiGet, apiPost } from '../api/http';
import { HOSPITALES_ACCESO_URL } from '../api/urls';
import { sessions, type SessionScope } from './state';

const logger = new Logger('Alcance');

/**
 * Vigencia de la caché del alcance por chat. Es lo bastante corta para
 * que un cambio de permisos (alta/baja de hospital) se vea pronto, y lo
 * bastante larga para no repetir el GET en cada mensaje del chat.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Extrae el token JWT de la request.
 *
 * Se aceptan las dos vías por las que puede llegar:
 *   · header `Authorization: Bearer <jwt>` (forma estándar);
 *   · campo `token` del body (vía que usa el frontend, porque el rewrite
 *     de Next.js no garantiza reenviar el header).
 *
 * Devuelve `null` si no hay ninguno.
 */
export function extraerToken(
  authorization: string | undefined,
  bodyToken?: string,
): string | null {
  const header = (authorization ?? '').trim();
  if (header.length > 0) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = (match ? match[1] : header).trim();
    if (token.length > 0) return token;
  }

  const body = (bodyToken ?? '').trim();
  if (body.length > 0) return body;

  return null;
}

/**
 * Saca la lista de elementos de la respuesta de `/api/hospitales/activos`.
 *
 * El endpoint devuelve un array plano (`[{hosId, hosNombre}, ...]`), pero
 * se tolerate un envoltorio `{ data: [...] }` / `{ items: [...] }` por si
 * el backend cambia la forma.
 */
function extraerLista(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const clave of ['data', 'items', 'resultados']) {
      const valor = obj[clave];
      if (Array.isArray(valor)) return valor;
    }
  }

  return [];
}

/**
 * Normaliza un elemento del catálogo a `{ id, nombre }`.
 *
 * Acepta las variantes de nombre que puede usar el backend
 * (`hosId`/`id`, `hosNombre`/`nombre`), y descarta los elementos que no
 * traen un id numérico válido.
 */
function aHospital(item: unknown): { id: number; nombre: string } | null {
  if (!item || typeof item !== 'object') return null;

  const obj = item as Record<string, unknown>;
  const idRaw = obj['hosId'] ?? obj['id'] ?? obj['idHospital'];
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return null;

  const nombreRaw =
    obj['hosNombre'] ?? obj['nombre'] ?? obj['name'] ?? obj['label'];
  const nombre = typeof nombreRaw === 'string' ? nombreRaw.trim() : '';

  return { id, nombre };
}

/**
 * Lee el claim `rol` (y `nombre`) del JWT, sin verificar la firma.
 *
 * NO es una validación de seguridad: el token ya lo validó el backend
 * .NET. Sólo sirve para decorar el prompt con datos que el usuario ya
 * conoce. Si el token no es un JWT legible, devuelve `null` y listo.
 */
export function leerClaimsDelToken(
  token: string | undefined,
): { rol?: string; nombre?: string } {
  if (!token) return {};

  const partes = token.split('.');
  if (partes.length !== 3) return {};

  try {
    const payload = JSON.parse(
      Buffer.from(partes[1], 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;

    const claims: { rol?: string; nombre?: string } = {};
    if (typeof payload['rol'] === 'string') claims.rol = payload['rol'];
    if (typeof payload['nombre'] === 'string') claims.nombre = payload['nombre'];
    return claims;
  } catch {
    return {};
  }
}

/**
 * Devuelve el alcance ya resuelto de la sesión (sin pegarle al backend),
 * o `null` si todavía no se resolvió.
 */
export function alcanceDeSesion(chatId: number): SessionScope | null {
  return sessions.get(chatId)?.scope ?? null;
}

/**
 * Resuelve (y cachea) el alcance hospitalario del usuario.
 *
 * · Sin token → `null` (no hay sesión autenticada: no se recorta nada,
 *   porque no se sabe qué es lo permitido).
 * · Con token → GET `/api/hospitales/acceso` con `Authorization: Bearer`.
 *   El resultado se guarda en `sessions` y se reutiliza durante
 *   `CACHE_TTL_MS`.
 * · Si el backend falla → `null` (se deja pasar sin recortar; el propio
 *   backend sigue siendo la última línea de defensa con 403).
 */
export async function resolverAlcance(
  chatId: number,
  token: string | undefined,
): Promise<SessionScope | null> {
  if (!token) return null;

  const session = sessions.get(chatId);
  const ahora = Date.now();

  // El alcance cacheado sólo sirve si se resolvió con el MISMO token que
  // trae esta request. Si el token cambió (el usuario reinició sesión, el
  // backend rotó el JWT, otro usuario entró en el mismo chat), el alcance
  // cacheado es de otro usuario: hay que resolverlo otra vez. Sin esto el
  // prompt le anuncia al usuario los hospitales de otra persona y las
  // tools (que sí van con el token nuevo) devuelven otra lista.
  const tokenCambio = session?.scopeToken !== undefined && session.scopeToken !== token;

  if (
    !tokenCambio &&
    session?.scope?.restringido &&
    session.scopeResolvedAt &&
    ahora - session.scopeResolvedAt < CACHE_TTL_MS
  ) {
    return session.scope;
  }

  const payload = await apiGet(HOSPITALES_ACCESO_URL, {}, token);

  if (!payload || payload['success'] === false) {
    logger.warn(
      `No se pudo resolver el alcance hospitalario del chat ${chatId}: ` +
        `${String(payload?.['error'] ?? 'respuesta vacía')}`,
    );
    return null;
  }

  const catalogo = extraerLista(payload as unknown)
    .map(aHospital)
    .filter((h): h is { id: number; nombre: string } => h !== null);

  const claims = leerClaimsDelToken(token);

  const scope: SessionScope = {
    hospitalesIds: catalogo.map((h) => h.id),
    hospitales: catalogo.map((h) => h.nombre).filter((n) => n.length > 0),
    ...(claims.rol ? { rol: claims.rol } : {}),
    restringido: true,
  };

  // Se guarda en la sesión en memoria (sin perder el resto de datos).
  const s = sessions.get(chatId) ?? {};
  s.token = token;
  s.scope = scope;
  s.scopeResolvedAt = ahora;
  s.scopeToken = token;
  if (!s.name && claims.nombre) s.name = claims.nombre;
  sessions.set(chatId, s);

  logger.log(
    `Alcance hospitalario del chat ${chatId}: ` +
      `${scope.hospitalesIds.length} hospital(es) ` +
      `(${scope.hospitales.join(', ') || 'sin nombre'})`,
  );

  return scope;
}

export type ResultadoAlcance =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Recorta el body de una tool de datos según el alcance del usuario.
 *
 * Reglas:
 *   · Sin alcance resuelto (`null` o `restringido === false`) → el body
 *     pasa intacto. No se sabe qué es lo permitido, así que no se inventa
 *     un recorte (el backend responde 403 si el hospital no le pertenece).
 *   · El usuario no tiene NINGÚN hospital → error: no hay datos que
 *     consultar.
 *   · `global: true` significa "TODOS los hospitales" y el backend lo
 *     expande al catálogo completo del tenant. Se traduce a la lista
 *     EXACTA de hospitales permitidos para que la consulta no escape del
 *     alcance del usuario.
 *   · `idHospitales` se intersecta con los permitidos. Si la intersección
 *     queda vacía, se devuelve un error con una instrucción accionable
 *     para el modelo.
 */
export function aplicarAlcanceHospitales(
  body: Record<string, unknown>,
  scope: SessionScope | null,
): ResultadoAlcance {
  if (!scope || !scope.restringido) return { ok: true, body };

  const permitidos = new Set(scope.hospitalesIds);

  // El usuario no tiene ningún hospital asignado: no puede consultar nada.
  if (permitidos.size === 0) {
    return {
      ok: false,
      error:
        'El usuario no tiene acceso a ningún hospital, así que no hay datos que consultar. ' +
        'Informa al usuario de que no tiene hospitales asignados.',
    };
  }

  const recortado: Record<string, unknown> = { ...body };

  // `global: true` → lista exacta de hospitales permitidos.
  if (recortado['global'] === true) {
    delete recortado['global'];
    recortado['idHospitales'] = [...permitidos];
    return { ok: true, body: recortado };
  }

  const idHospitales = recortado['idHospitales'];
  if (!Array.isArray(idHospitales) || idHospitales.length === 0) {
    // Cada endpoint tiene sus propias reglas de obligatoriedad: si no se
    // mandan hospitales, no se toca el body.
    return { ok: true, body: recortado };
  }

  const filtrados = idHospitales
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v) => Number.isFinite(v) && permitidos.has(v));

  if (filtrados.length === 0) {
    return {
      ok: false,
      error:
        'El hospital solicitado no está entre los que este usuario puede consultar. ' +
        'Llama a `obtener_hospitales_disponibles` para ver el catálogo permitido ' +
        'y usa solo esos ids.',
    };
  }

  recortado['idHospitales'] = filtrados;
  return { ok: true, body: recortado };
}

/**
 * `apiPost` con el recorte de alcance aplicado.
 *
 * Si el recorte rechaza la consulta (usuario sin Hospitales o hospital no
 * permitido), devuelve el error como payload de tool — sin pegarle al
 * backend, para no filtrar datos de un hospital fuera del alcance.
 */
export async function apiPostConAlcance(
  url: string,
  body: Record<string, unknown>,
  token: string | undefined,
  scope: SessionScope | null,
): Promise<Record<string, unknown>> {
  const resultado = aplicarAlcanceHospitales(body, scope);

  if (!resultado.ok) {
    logger.warn(`Consulta recortada por alcance del usuario: ${resultado.error}`);
    return { success: false, error: resultado.error };
  }

  return apiPost(url, resultado.body, token);
}
