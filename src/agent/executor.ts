// src/agent/executor.ts
// Ejecuta la herramienta solicitada por Claude y devuelve el resultado como JSON string

import { sessions } from './state';
import { apiPost, apiGet } from '../api/http';
import { DbService } from './db.service';

/*──────────────────────────────────────────────────────────────────────────
  IMPORTS DE URLs

  Las URLs externas históricas (PERFIL, MIS_ORDENES, MIS_PAGOS, etc.) están
  comentadas en `src/api/urls.ts`. Sus imports y casos del executor también
  están deshabilitados para no romper la build. Sólo las tools locales (DB)
  y las 3 tools nuevas de IaPreguntas están activas.
  ─────────────────────────────────────────────────────────────────────────*/

import {
  RESUMEN_FINANCIERO_HOSPITALES_URL,
  DETERMINACION_ADVERSA_MAS_FRECUENTE_URL,
  PLANES_DISPONIBLES_URL,
  HOSPITALES_DISPONIBLES_URL,
  MONTOS_ESTADO,
  DETERMINACION_ADVERSA_MONTO_URL,
  DETERMINACION_ADVERSA_MONTO_CONSOLIDADO_URL,
  PLANES_POR_HOSPITAL_CON_LOC_URL,
  DESEMPENO_MEDICO_URL,
  DETERMINACION_ADVERSA_MEDICO_ALTA_URL,
  DESEMPENO_MANEJADOR_CASO_URL,
  DETERMINACION_ADVERSA_MANEJADOR_CASO_URL,
  FACTURACION_MANEJADOR_HOSPITALES_URL,
  FACTURACION_AUDITOR_HOSPITALES_URL,
  DESEMPENO_AUDITOR_URL,
  DETERMINACION_ADVERSA_AUDITOR_URL,
} from '../api/urls';

function strVal(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Normaliza un valor del tool input a entero. El modelo a veces manda
 * "2" (string) en vez de 2 (number). Devuelve NaN si no es numérico.
 */
function toInt(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim().length > 0)
    return Number(raw.trim());
  return NaN;
}

/**
 * Mueve el ID del pivote (médico / manejador / auditor) del body a la
 * query string.
 *
 * Los endpoints de desempeño (`desempeno-medico`, `desempeno-manejador-caso`,
 * `desempeno-auditor`) toman ese ID como QUERY param (`idMedicosAlta`,
 * `idManejadores`, `idAuditores`). Si se manda en el body, el backend lo
 * descarta en silencio y devuelve el catálogo completo de médicos /
 * manejadores / auditores — la IA creería estar filtrando y no está.
 *
 * Devuelve el query string (sin `?`) o null si no hay ID.
 */
function idPivoteEnQuery(
  body: Record<string, unknown>,
  bodyKey: string,
  queryKey: string,
): string | null {
  const raw = body[bodyKey];
  delete body[bodyKey];
  const id = toInt(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `${queryKey}=${encodeURIComponent(String(Math.trunc(id)))}`;
}

/**
 * Rango de fechas para `consultar_resumen_financiero_hospitales`,
 * `consultar_montos_por_estado`,
 * `consultar_determinacion_adversa_mas_frecuente`,
 * `consultar_determinacion_adversa_monto`,
 * `consultar_determinacion_adversa_monto_consolidado`,
 * `consultar_desempeno_auditor`,
 * `consultar_determinacion_adversa_auditor`,
 * `consultar_facturacion_auditor_hospitales`,
 * `consultar_desempeno_manejador_caso` y
 * `consultar_facturacion_manejador_hospitales`.
 *
 * Esos endpoints NO filtran por `anio`/`meses`/`dia` sino por RANGO:
 * `fechaInicio` / `fechaFin` (YYYY-MM-DD, extremos inclusivos).
 *
 * Reglas:
 *   - Si el modelo manda el rango → se usa tal cual.
 *   - Si manda sólo uno de los dos → el otro se completa con el año del que
 *     vino (1-ene o 31-dic).
 *   - Si manda `anio`/`meses`/`dia` (el contrato del resto de tools, por
 *     costumbre del modelo) → se traduce al rango equivalente.
 *   - Si no manda nada → AÑO EN CURSO COMPLETO (1-ene → 31-dic).
 */
function resolverRangoFechas(toolInput: Record<string, unknown>): {
  fechaInicio: string;
  fechaFin: string;
} {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const inicio = iso(toolInput['fechaInicio']);
  const fin = iso(toolInput['fechaFin']);
  if (inicio && fin) return { fechaInicio: inicio, fechaFin: fin };
  if (inicio)
    return { fechaInicio: inicio, fechaFin: `${inicio.slice(0, 4)}-12-31` };
  if (fin) return { fechaInicio: `${fin.slice(0, 4)}-01-01`, fechaFin: fin };

  const anio = toInt(toolInput['anio']);
  if (Number.isInteger(anio) && anio >= 1900 && anio <= 2999) {
    const meses = (
      Array.isArray(toolInput['meses']) ? (toolInput['meses'] as unknown[]) : []
    )
      .map(toInt)
      .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
      .sort((a, b) => a - b);
    if (meses.length === 0) {
      return { fechaInicio: `${anio}-01-01`, fechaFin: `${anio}-12-31` };
    }
    const dia = toInt(toolInput['dia']);
    if (meses.length === 1 && Number.isInteger(dia) && dia >= 1 && dia <= 31) {
      const unDia = `${anio}-${pad(meses[0])}-${pad(dia)}`;
      return { fechaInicio: unDia, fechaFin: unDia };
    }
    const primero = meses[0];
    const ultimo = meses[meses.length - 1];
    return {
      fechaInicio: `${anio}-${pad(primero)}-01`,
      // `new Date(anio, mes, 0)` = último día del mes `mes` (mes es 1-based).
      fechaFin: `${anio}-${pad(ultimo)}-${new Date(anio, ultimo, 0).getDate()}`,
    };
  }

  const anioActual = new Date().getFullYear();
  return {
    fechaInicio: `${anioActual}-01-01`,
    fechaFin: `${anioActual}-12-31`,
  };
}

/**
 * Tools que requieren una sesión autenticada.
 *
 * IMPORTANTE: los endpoints de Audita (`/api/IaPreguntas/*` y los catálogos
 * `/api/planes/dropdown`, `/api/hospitales/activos`) son PÚBLICOS en este
 * entorno — responden HTTP 200 sin token. Por lo tanto NINGUNA tool
 * actualmente activa requiere auth, y el agente NO debe pedir credenciales
 * al usuario para estas consultas.
 *
 * Si en el futuro se re-habilitan tools privadas (perfil, órdenes, pagos,
 * compras, etc.), se deben volver a listar aquí. Mientras tanto, este
 * conjunto queda VACÍO a propósito para no bloquear las herramientas de
 * datos cuando no hay sesión iniciada.
 */
const AUTH_REQUIRED = new Set<string>([
  // 'get_perfil',
  // 'actualizar_perfil',
  // 'get_ordenes',
  // 'get_pagos',
  // 'crear_compra',
  // 'inicio_tramite_express',
]);

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  chatId: number,
  db: DbService,
): Promise<string> {
  const s = sessions.get(chatId);
  const token = s?.token;

  if (AUTH_REQUIRED.has(toolName) && !s) {
    return JSON.stringify({
      success: false,
      requires_auth: true,
      error:
        'No hay sesión activa en este chat para ejecutar esta acción. Debes pedirle al usuario su correo y código de verificación (flujo de autenticación) antes de poder usar esta herramienta.',
    });
  }

  if (toolName === 'recordar_conocimiento') {
    const q = strVal(toolInput['pregunta']);
    const a = strVal(toolInput['respuesta']);
    try {
      await db.query(
        'INSERT INTO conocimiento_especifico (pregunta, respuesta) VALUES ($1, $2)',
        [q, a],
      );
      return JSON.stringify({
        success: true,
        message: 'Aprendizaje guardado correctamente.',
      });
    } catch (e: unknown) {
      return JSON.stringify({ success: false, error: errMsg(e) });
    }
  }

  if (toolName === 'buscar_conocimiento') {
    const raw = strVal(toolInput['busqueda']);
    const tokens = raw
      .toLowerCase()
      .split(/[^a-záéíóúüñ0-9]+/)
      .filter((t) => t.length >= 3);

    try {
      if (tokens.length === 0) {
        return JSON.stringify({ success: true, resultados: [] });
      }
      const conds = tokens
        .map(
          (_, i) =>
            `(LOWER(pregunta) LIKE $${i + 1} OR LOWER(respuesta) LIKE $${i + 1})`,
        )
        .join(' OR ');
      const scoreParts = tokens
        .map(
          (_, i) =>
            `(CASE WHEN LOWER(pregunta) LIKE $${i + 1} OR LOWER(respuesta) LIKE $${i + 1} THEN 1 ELSE 0 END)`,
        )
        .join(' + ');
      const params = tokens.map((t) => `%${t}%`);

      const { rows } = await db.query(
        `SELECT TOP 5 pregunta, respuesta, (${scoreParts}) AS score
         FROM conocimiento_especifico
         WHERE ${conds}
         ORDER BY score DESC, id DESC`,
        params,
      );
      return JSON.stringify({ success: true, resultados: rows });
    } catch (e: unknown) {
      return JSON.stringify({ success: false, error: errMsg(e) });
    }
  }

  if (toolName === 'guardar_memoria_usuario') {
    const k = strVal(toolInput['clave']).toLowerCase().trim();
    const v = strVal(toolInput['valor']).trim();
    try {
      await db.query(
        `MERGE INTO memoria_largo_plazo AS target
         USING (SELECT $1 AS chat_id, $2 AS clave, $3 AS valor) AS source
         ON target.chat_id = source.chat_id AND target.clave = source.clave
         WHEN MATCHED THEN
           UPDATE SET valor = source.valor, updated_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN
           INSERT (chat_id, clave, valor) VALUES (source.chat_id, source.clave, source.valor);`,
        [chatId, k, v],
      );
      return JSON.stringify({ success: true, message: `Memorizado: ${k}` });
    } catch (e: unknown) {
      return JSON.stringify({ success: false, error: errMsg(e) });
    }
  }

  if (toolName === 'consultar_memoria_usuario') {
    const rawClave = toolInput['clave'];
    const k =
      typeof rawClave === 'string' ? rawClave.toLowerCase().trim() : null;
    try {
      let query =
        'SELECT clave, valor FROM memoria_largo_plazo WHERE chat_id = $1';
      const params: any[] = [chatId];
      if (k) {
        query += ' AND clave = $2';
        params.push(k);
      }
      const { rows } = await db.query(query, params);
      return JSON.stringify({ success: true, memoria: rows });
    } catch (e: unknown) {
      return JSON.stringify({ success: false, error: errMsg(e) });
    }
  }

  if (toolName === 'registrar_derivacion') {
    const motivo = strVal(toolInput['motivo']).trim();
    const mensajeUsuario = strVal(toolInput['mensaje_usuario']).trim();
    const respuestaIa = strVal(toolInput['respuesta_ia']).trim();
    if (!motivo || !mensajeUsuario) {
      return JSON.stringify({
        success: false,
        error: 'Se requieren motivo y mensaje_usuario.',
      });
    }
    try {
      await db.query(
        'INSERT INTO derivaciones_humano (chat_id, motivo, mensaje_usuario, respuesta_ia) VALUES ($1, $2, $3, $4)',
        [chatId, motivo, mensajeUsuario, respuestaIa || null],
      );
      return JSON.stringify({
        success: true,
        message: 'Derivación registrada.',
      });
    } catch (e: unknown) {
      return JSON.stringify({ success: false, error: errMsg(e) });
    }
  }

  // ─── TOOLS DE IaPreguntas — activas (cableadas contra el backend) ──────
  //
  // Las 4 tools viven en `src/agent/tools.ts` y tienen su URL activa en
  // `src/api/urls.ts`. Aquí se arman los payloads y se delega en
  // `apiGet`/`apiPost` (definidos en `src/api/http.ts`).

  if (toolName === 'obtener_planes_disponibles') {
    return JSON.stringify(await apiGet(PLANES_DISPONIBLES_URL, {}, token));
  }

  if (toolName === 'obtener_hospitales_disponibles') {
    return JSON.stringify(await apiGet(HOSPITALES_DISPONIBLES_URL, {}, token));
  }

  if (toolName === 'obtener_planes_por_hospital_con_loc') {
    // Catálogo jerárquico hospital → categorías → planes → locs.
    // Acepta `idHospitales` (requerido), `loc` opcional (array de
    // "ACUTE" / "SNF") e `idPlanes` opcional (array de ints para
    // limitar el catálogo a un conjunto específico de planes).
    // Devuelve la estructura cruda sin transformarla.
    const body: Record<string, unknown> = {};
    const idHospitales = toolInput['idHospitales'];
    if (Array.isArray(idHospitales) && idHospitales.length > 0) {
      body['idHospitales'] = idHospitales;
    }
    const loc = toolInput['loc'];
    if (Array.isArray(loc) && loc.length > 0) {
      const cleaned = loc
        .filter((v) => typeof v === 'string' && v.trim().length > 0)
        .map((v) => (v as string).trim());
      if (cleaned.length > 0) {
        body['loc'] = cleaned;
      }
    } else if (typeof loc === 'string' && loc.trim().length > 0) {
      body['loc'] = [loc.trim()];
    }
    const idPlanes = toolInput['idPlanes'];
    if (Array.isArray(idPlanes) && idPlanes.length > 0) {
      body['idPlanes'] = idPlanes;
    }
    return JSON.stringify(
      await apiPost(PLANES_POR_HOSPITAL_CON_LOC_URL, body, token),
    );
  }

  // Helper local: arma el body estándar de las herramientas de IaPreguntas
  // (anio + meses? + dia? + idHospitales + idPlanes? + loc?), omitiendo los
  // campos vacíos para no enviar arrays vacíos que el backend descarta o
  // interpreta mal.
  const buildIaPreguntasBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (typeof toolInput['anio'] === 'number') {
      body['anio'] = toolInput['anio'];
    }
    const meses = toolInput['meses'];
    if (Array.isArray(meses) && meses.length > 0) {
      body['meses'] = meses;
    }
    // `dia` (opcional, 1–31): filtro de granularidad DÍA dentro de los meses
    // enviados en `meses`. El backend solo lo interpreta cuando viene `meses`,
    // así que el schema de las tools prohíbe mandarlo sin mes; acá solo se
    // normaliza el tipo y se descarta cualquier valor fuera de rango (0, 32,
    // "abc", null, arrays). Aceptamos string numérico porque el modelo a
    // veces manda "5" en vez de 5.
    const diaRaw = toolInput['dia'];
    let diaNum = NaN;
    if (typeof diaRaw === 'number') {
      diaNum = diaRaw;
    } else if (typeof diaRaw === 'string' && diaRaw.trim().length > 0) {
      diaNum = Number(diaRaw.trim());
    }
    if (Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31) {
      body['dia'] = diaNum;
    }
    const idHospitales = toolInput['idHospitales'];
    if (Array.isArray(idHospitales) && idHospitales.length > 0) {
      body['idHospitales'] = idHospitales;
    }
    // `global` (opcional): con `true` se consideran TODOS los hospitales del
    // catálogo e `idHospitales` se ignora. Sólo lo usa la tool consolidada
    // (`determinacion-adversa-monto-consolidado`); las demás no lo mandan.
    const globalRaw = toolInput['global'];
    const esGlobal =
      globalRaw === true ||
      (typeof globalRaw === 'string' &&
        globalRaw.trim().toLowerCase() === 'true');
    if (esGlobal) {
      body['global'] = true;
      delete body['idHospitales'];
    }
    const idPlanes = toolInput['idPlanes'];
    if (Array.isArray(idPlanes) && idPlanes.length > 0) {
      body['idPlanes'] = idPlanes;
    }
    const loc = toolInput['loc'];
    if (Array.isArray(loc) && loc.length > 0) {
      const cleaned = loc
        .filter((v) => typeof v === 'string' && v.trim().length > 0)
        .map((v) => (v as string).trim());
      if (cleaned.length > 0) {
        body['loc'] = cleaned;
      }
    } else if (typeof loc === 'string' && loc.trim().length > 0) {
      body['loc'] = [loc.trim()];
    }
    // `idMedicoAlta` (opcional). Si se omite, el backend devuelve el catálogo
    // completo de médicos (útil cuando la IA está resolviendo nombre → ID).
    const idMedicoAlta = toolInput['idMedicoAlta'];
    if (
      typeof idMedicoAlta === 'number' &&
      Number.isFinite(idMedicoAlta) &&
      idMedicoAlta > 0
    ) {
      body['idMedicoAlta'] = Math.trunc(idMedicoAlta);
    } else if (typeof idMedicoAlta === 'string' && idMedicoAlta.trim().length > 0) {
      const parsed = Number(idMedicoAlta.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        body['idMedicoAlta'] = Math.trunc(parsed);
      }
    }
    // `idManejadorCaso` (opcional). Misma idea que `idMedicoAlta`: si se omite,
    // el backend devuelve el catálogo de manejadores de caso bajo los filtros
    // aplicados. Se aplica solo a las tools que lo pidan.
    const idManejadorCaso = toolInput['idManejadorCaso'];
    if (
      typeof idManejadorCaso === 'number' &&
      Number.isFinite(idManejadorCaso) &&
      idManejadorCaso > 0
    ) {
      body['idManejadorCaso'] = Math.trunc(idManejadorCaso);
    } else if (
      typeof idManejadorCaso === 'string' &&
      idManejadorCaso.trim().length > 0
    ) {
      const parsed = Number(idManejadorCaso.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        body['idManejadorCaso'] = Math.trunc(parsed);
      }
    }
    // `idAuditor` (opcional). Misma idea que `idMedicoAlta` /
    // `idManejadorCaso`: si se omite, el backend devuelve el catálogo de
    // auditores bajo los filtros aplicados. Se aplica solo a las tools que lo
    // pidan (`desempeno-auditor` en modo catálogo y `determinacion-adversa-
    // auditor` ya con ID explícito).
    const idAuditor = toolInput['idAuditor'];
    if (
      typeof idAuditor === 'number' &&
      Number.isFinite(idAuditor) &&
      idAuditor > 0
    ) {
      body['idAuditor'] = Math.trunc(idAuditor);
    } else if (
      typeof idAuditor === 'string' &&
      idAuditor.trim().length > 0
    ) {
      const parsed = Number(idAuditor.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        body['idAuditor'] = Math.trunc(parsed);
      }
    }
    return body;
  };

  if (toolName === 'consultar_resumen_financiero_hospitales') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    return JSON.stringify(
      await apiPost(RESUMEN_FINANCIERO_HOSPITALES_URL, body, token),
    );
  }

  if (toolName === 'consultar_determinacion_adversa_mas_frecuente') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    const top = toolInput['top'];
    const url =
      typeof top === 'number'
        ? `${DETERMINACION_ADVERSA_MAS_FRECUENTE_URL}?top=${encodeURIComponent(String(top))}`
        : DETERMINACION_ADVERSA_MAS_FRECUENTE_URL;
    return JSON.stringify(await apiPost(url, body, token));
  }

  if (toolName === 'consultar_montos_por_estado') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    return JSON.stringify(await apiPost(MONTOS_ESTADO, body, token));
  }

  if (toolName === 'consultar_determinacion_adversa_monto') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    const top = toolInput['top'];
    const url =
      typeof top === 'number'
        ? `${DETERMINACION_ADVERSA_MONTO_URL}?top=${encodeURIComponent(String(top))}`
        : DETERMINACION_ADVERSA_MONTO_URL;
    return JSON.stringify(await apiPost(url, body, token));
  }

  if (toolName === 'consultar_determinacion_adversa_monto_consolidado') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    const esGlobal = body['global'] === true;

    // `idHospitales` es obligatorio salvo que venga `global: true`.
    if (
      !esGlobal &&
      (!Array.isArray(body['idHospitales']) ||
        body['idHospitales'].length === 0)
    ) {
      return JSON.stringify({
        success: false,
        error:
          'Falta el parámetro requerido `idHospitales` (int[], ≥1). Llama antes a `obtener_hospitales_disponibles` (campo `hosId`) y reintenta con esos IDs; si el usuario no dijo cuáles, manda `global: true` para considerar todos los hospitales.',
      });
    }

    return JSON.stringify(
      await apiPost(DETERMINACION_ADVERSA_MONTO_CONSOLIDADO_URL, body, token),
    );
  }

  // ─── Desempeño de médicos ───────────────────────────────────────────────
  //
  // Devuelve KPIs por médico (días aprobados / denegados / recuperados,
  // montos, etc.) en un período + planes + loc + médico específico.
  // Si NO se pasa `idMedicoAlta`, el backend devuelve el catálogo completo
  // de médicos disponible para los filtros aplicados — útil para que la IA
  // resuelva el nombre antes de hacer una consulta concreta.
  if (toolName === 'consultar_desempeno_medico') {
    const body = buildIaPreguntasBody();
    // `agruparPor` (opcional): 1 (o ausente) = por hospital (histórico),
    // 2 = por médico → plan → hospital (el desempeño del médico en todos
    // los hospitales que evaluó).
    const agruparPor = toInt(toolInput['agruparPor']);
    if (agruparPor === 1 || agruparPor === 2) {
      body['agruparPor'] = agruparPor;
    }
    // El ID del médico viaja como QUERY param, no en el body.
    const qs = idPivoteEnQuery(body, 'idMedicoAlta', 'idMedicosAlta');
    const url = qs ? `${DESEMPENO_MEDICO_URL}?${qs}` : DESEMPENO_MEDICO_URL;
    return JSON.stringify(await apiPost(url, body, token));
  }

  // ─── Determinación adversa más frecuente del médico de alta ─────────────
  //
  // Devuelve el/los concepto(s) de determinación adversa que más se repiten
  // en las auditorías asociadas al médico que firma el alta del paciente
  // (`idMedicoAlta`). Mismos filtros que el resto de IaPreguntas.
  if (toolName === 'consultar_determinacion_adversa_medico_alta') {
    const body = buildIaPreguntasBody();
    return JSON.stringify(
      await apiPost(DETERMINACION_ADVERSA_MEDICO_ALTA_URL, body, token),
    );
  }

  // ─── Desempeño de manejadores de caso ──────────────────────────────────
  //
  // Análogo a `consultar_desempeno_medico`, pero agrupado por manejador de
  // caso (`idManejadorCaso`) en vez de médico de alta. Si NO se pasa
  // `idManejadorCaso`, el backend devuelve el catálogo de manejadores.
  if (toolName === 'consultar_desempeno_manejador_caso') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    // El ID del manejador viaja como QUERY param, no en el body.
    const qs = idPivoteEnQuery(body, 'idManejadorCaso', 'idManejadores');
    const url = qs
      ? `${DESEMPENO_MANEJADOR_CASO_URL}?${qs}`
      : DESEMPENO_MANEJADOR_CASO_URL;
    return JSON.stringify(await apiPost(url, body, token));
  }

  // ─── Determinación adversa más frecuente del manejador de caso ─────────
  //
  // Análogo a `consultar_determinacion_adversa_medico_alta`, pero filtrando
  // por `idManejadorCaso`. El endpoint NO devuelve catálogo: requiere ID.
  if (toolName === 'consultar_determinacion_adversa_manejador_caso') {
    const body = buildIaPreguntasBody();
    return JSON.stringify(
      await apiPost(DETERMINACION_ADVERSA_MANEJADOR_CASO_URL, body, token),
    );
  }

  // ─── Facturación por manejador de caso (montos) ─────────────────────────
  //
  // Devuelve cuánto dinero se facturó / perdió / recuperó POR MANEJADOR en
  // los hospitales y filtros seleccionados. El endpoint NO toma un ID pivote
  // (no hay "idManejadorCaso" como filtro), siempre devuelve el desglose
  // completo de manejadores aplicables. La IA ordena / filtra localmente
  // según la pregunta (p. ej. "el que más perdió").
  if (toolName === 'consultar_facturacion_manejador_hospitales') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    return JSON.stringify(
      await apiPost(FACTURACION_MANEJADOR_HOSPITALES_URL, body, token),
    );
  }

  // ─── Facturación por auditor (montos) ───────────────────────────────────
  //
  // Equivalente a `consultar_facturacion_manejador_hospitales`, pero el
  // desglose viene agrupado por AUDITOR (la persona que firma / revisa la
  // auditoría) en lugar de por manejador de caso. El endpoint NO toma un
  // ID pivote: siempre devuelve el agregado completo (un auditor por fila).
  if (toolName === 'consultar_facturacion_auditor_hospitales') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    return JSON.stringify(
      await apiPost(FACTURACION_AUDITOR_HOSPITALES_URL, body, token),
    );
  }

  // ─── Desempeño de auditores ─────────────────────────────────────────────
  //
  // Análogo a `consultar_desempeno_medico` y `consultar_desempeno_manejador_caso`,
  // pero agrupado por AUDITOR. Si NO se pasa `idAuditor`, el backend devuelve
  // el catálogo de auditores disponibles bajo los otros filtros.
  if (toolName === 'consultar_desempeno_auditor') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    // El ID del auditor viaja como QUERY param, no en el body.
    const qs = idPivoteEnQuery(body, 'idAuditor', 'idAuditores');
    const url = qs ? `${DESEMPENO_AUDITOR_URL}?${qs}` : DESEMPENO_AUDITOR_URL;
    return JSON.stringify(await apiPost(url, body, token));
  }

  // ─── Determinación adversa más frecuente de un auditor ──────────────────
  //
  // Análogo a `consultar_determinacion_adversa_medico_alta`, pero filtrando
  // por `idAuditor`. El endpoint requiere el ID explícito (no es catálogo).
  if (toolName === 'consultar_determinacion_adversa_auditor') {
    // Este endpoint filtra por RANGO de fechas: `anio`/`meses`/`dia` no
    // aplican (el backend los ignora), así que se sustituyen por
    // `fechaInicio`/`fechaFin`.
    const body = buildIaPreguntasBody();
    delete body['anio'];
    delete body['meses'];
    delete body['dia'];
    const rango = resolverRangoFechas(toolInput);
    body['fechaInicio'] = rango.fechaInicio;
    body['fechaFin'] = rango.fechaFin;
    // Este endpoint exige `idHospitales` (≥1). Sin él el backend responde
    // HTTP 400 y el modelo solo ve un error opaco; se valida aquí para
    // devolverle una instrucción accionable y que pueda reintentar.
    if (
      !Array.isArray(body['idHospitales']) ||
      body['idHospitales'].length === 0
    ) {
      return JSON.stringify({
        success: false,
        error:
          'Falta el parámetro requerido `idHospitales` (int[], ≥1). Llama antes a `obtener_hospitales_disponibles` (campo `hosId`) y reintenta con esos IDs.',
      });
    }
    return JSON.stringify(
      await apiPost(DETERMINACION_ADVERSA_AUDITOR_URL, body, token),
    );
  }

  return JSON.stringify({
    success: false,
    error: `Herramienta desconocida: ${toolName}`,
  });
}
