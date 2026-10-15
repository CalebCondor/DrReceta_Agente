// src/agent/executor.ts
// Ejecuta la herramienta solicitada por Claude y devuelve el resultado como JSON string

import { Logger } from '@nestjs/common';
import { sessions } from './state';
import { apiPost, apiGet } from '../api/http';
import { DbService } from './db.service';

const logger = new Logger('AgentExecutor');

/*──────────────────────────────────────────────────────────────────────────
  IMPORTS DE URLs

  Las URLs externas históricas (PERFIL, MIS_ORDENES, MIS_PAGOS, etc.) están
  comentadas en `src/api/urls.ts`. Sus imports y casos del executor también
  están deshabilitados para no romper la build. Sólo las tools locales (DB)
  y las 3 tools nuevas de IaPreguntas están activas.
  ─────────────────────────────────────────────────────────────────────────*/

// import {
//   PERFIL_URL,
//   MIS_ORDENES_URL,
//   MIS_PAGOS_URL,
//   VERIFICAR_REGISTRAR_URL,
//   CREAR_COMPRA_URL,
//   INICIO_TRAMITE_EXPRESS,
//   VERIFICAR_CODIGO_URL,
//   TODOS_LOS_TRAMITES_URL,
//   SELLOS_POR_TRAMITE_URL,
// } from '../api/urls';
import {
  RESUMEN_FINANCIERO_HOSPITALES_URL,
  DETERMINACION_ADVERSA_MAS_FRECUENTE_URL,
  CONCEPTO_MAS_DIAS_DENEGADOS_URL,
  PLANES_DISPONIBLES_URL,
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
 * Tools que requieren una sesión autenticada.
 *
 * Las tools externas (get_perfil, get_ordenes, get_pagos, crear_compra,
 * inicio_tramite_express) están deshabilitadas — sus entradas se mantienen
 * comentadas por si se re-habilitan en el futuro.
 *
 * Las 3 tools nuevas de IaPreguntas también requieren sesión (sólo usuarios
 * autenticados con permisos a hospitales pueden ver estos datos).
 */
const AUTH_REQUIRED = new Set<string>([
  'consultar_resumen_financiero_hospitales',
  'consultar_determinacion_adversa_mas_frecuente',
  'consultar_concepto_mas_dias_denegados',
  'obtener_planes_disponibles',
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
  const userId = s?.user_id;

  if (AUTH_REQUIRED.has(toolName) && !s) {
    return JSON.stringify({
      success: false,
      requires_auth: true,
      error:
        'No hay sesión activa en este chat para ejecutar esta acción. Debes pedirle al usuario su correo y código de verificación (flujo de autenticación) antes de poder usar esta herramienta.',
    });
  }

  // ─── TOOLS DESHABILITADAS (URLs comentadas en src/api/urls.ts) ──────────
  //
  // Las siguientes tools están deshabilitadas porque sus endpoints externos
  // fueron comentados. Cuando se re-habiliten, también hay que
  // (1) descomentar el import correspondiente arriba, (2) descomentar la
  // entrada en `AUTH_REQUIRED` si aplica, y (3) descomentar la tool en
  // `src/agent/tools.ts`.

  // if (toolName === 'get_perfil') {
  //   return JSON.stringify(await apiGet(PERFIL_URL, {}, token));
  // }

  // if (toolName === 'actualizar_perfil') {
  //   const rawCampos = Object.assign(
  //     {},
  //     toolInput['campos'] as Record<string, unknown>,
  //   );
  //
  //   const FIELD_MAP: Record<string, string> = {
  //     nombre: 'us_nombres',
  //     nombres: 'us_nombres',
  //     name: 'us_nombres',
  //     email: 'us_email',
  //     correo: 'us_email',
  //     telefono: 'us_telefono',
  //     phone: 'us_telefono',
  //     pais: 'us_pais',
  //     country: 'us_pais',
  //     direccion: 'us_direccion',
  //     address: 'us_direccion',
  //     ciudad: 'us_ciudad',
  //     city: 'us_ciudad',
  //     fecha_nacimiento: 'us_fech_nac',
  //     fech_nac: 'us_fech_nac',
  //     codigo_postal: 'us_code_postal',
  //     code_postal: 'us_code_postal',
  //   };
  //
  //   const camposNuevos: Record<string, unknown> = {};
  //   for (const [key, value] of Object.entries(rawCampos)) {
  //     const mappedKey = FIELD_MAP[key.toLowerCase()] ?? key;
  //     camposNuevos[mappedKey] = value;
  //   }
  //
  //   const camposReales = Object.keys(camposNuevos).filter((k) => k !== 'us_id');
  //   if (camposReales.length === 0) {
  //     return JSON.stringify({
  //       success: false,
  //       error: 'No se especificaron campos a actualizar.',
  //     });
  //   }
  //
  //   const perfilActual = await apiGet(PERFIL_URL, {}, token);
  //   const datosActuales =
  //     perfilActual['success'] &&
  //     perfilActual['data'] &&
  //     typeof perfilActual['data'] === 'object'
  //       ? (perfilActual['data'] as Record<string, unknown>)
  //       : {};
  //
  //   const PERFIL_FIELDS = [
  //     'us_nombres',
  //     'us_email',
  //     'us_telefono',
  //     'us_pais',
  //     'us_direccion',
  //     'us_ciudad',
  //     'us_fech_nac',
  //     'us_code_postal',
  //   ];
  //
  //   const payload: Record<string, unknown> = { us_id: userId };
  //   for (const field of PERFIL_FIELDS) {
  //     payload[field] = camposNuevos[field] ?? datosActuales[field] ?? '';
  //   }
  //
  //   return JSON.stringify(await apiPost(PERFIL_URL, payload, token));
  // }

  // if (toolName === 'get_ordenes') {
  //   return JSON.stringify(
  //     await apiGet(MIS_ORDENES_URL, { us_id: String(userId) }, token),
  //   );
  // }

  // if (toolName === 'get_pagos') {
  //   return JSON.stringify(await apiPost(MIS_PAGOS_URL, {}, token));
  // }

  // if (toolName === 'verificar_o_registrar_usuario') {
  //   const email = strVal(toolInput['us_email']).trim();
  //   if (!email) {
  //     return JSON.stringify({ success: false, error: 'Se requiere us_email.' });
  //   }
  //
  //   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  //   if (!emailRegex.test(email)) {
  //     return JSON.stringify({
  //       success: false,
  //       exists: false,
  //       error:
  //         'El correo electrónico no tiene un formato válido. Verifica e intenta de nuevo.',
  //     });
  //   }
  //
  //   const payload: Record<string, unknown> = { us_email: email };
  //   const nombres = strVal(toolInput['us_nombres']).trim();
  //   const telefono = strVal(toolInput['us_telefono']).trim();
  //   const generoRaw = strVal(toolInput['us_genero']).trim();
  //   const clave = strVal(toolInput['us_clave']).trim();
  //   if (nombres) payload['us_nombres'] = nombres;
  //   if (telefono) payload['us_telefono'] = telefono;
  //   if (generoRaw) {
  //     const g = generoRaw.toLowerCase();
  //     let normalized = generoRaw;
  //     if (
  //       g === 'm' ||
  //       g === 'masculino' ||
  //       g === 'hombre' ||
  //       g === 'macho' ||
  //       g === 'male'
  //     ) {
  //       normalized = 'M';
  //     } else if (
  //       g === 'f' ||
  //       g === 'femenino' ||
  //       g === 'mujer' ||
  //       g === 'hembra' ||
  //       g === 'female'
  //     ) {
  //       normalized = 'F';
  //     }
  //     payload['us_genero'] = normalized;
  //   }
  //   if (clave) payload['us_clave'] = clave;
  //
  //   const result = await apiPost(VERIFICAR_REGISTRAR_URL, payload);
  //
  //   logger.log(
  //     `[verificar_o_registrar_usuario] payload=${JSON.stringify(payload)} result=${JSON.stringify(result)}`,
  //   );
  //
  //   const data = result['data'] as Record<string, unknown> | undefined;
  //   const apiSuccess = result['success'] === true;
  //   const nombreBD = strVal(data?.['us_nombres'] ?? '').trim();
  //
  //   if (apiSuccess && data?.['token']) {
  //     sessions.set(chatId, {
  //       token: strVal(data['token']),
  //       user_id: strVal(data['us_id'] ?? ''),
  //       name: strVal(data['us_nombres'] ?? ''),
  //       es_vip: false,
  //     });
  //     logger.log(
  //       `[verificar_o_registrar_usuario] sesión creada (registro) chat=${chatId} us_id=${strVal(data['us_id'] ?? '')}`,
  //     );
  //   }
  //
  //   const enriched = {
  //     ...result,
  //     exists: apiSuccess && (!!data?.['codigo'] || !!data?.['token']),
  //     code_sent: apiSuccess && !!data?.['codigo'],
  //     us_nombres: nombreBD,
  //   };
  //
  //   if (apiSuccess && (data?.['codigo'] || data?.['token']) && nombreBD) {
  //     const actual = sessions.get(chatId);
  //     if (actual) {
  //       actual.name = nombreBD;
  //       if (data?.['us_id']) actual.user_id = strVal(data['us_id']);
  //       sessions.set(chatId, actual);
  //     }
  //   }
  //
  //   return JSON.stringify(enriched);
  // }

  // if (toolName === 'verificar_codigo') {
  //   const email = strVal(toolInput['us_email']).trim();
  //   const codigo = strVal(toolInput['codigo']).trim();
  //   if (!email || !codigo) {
  //     return JSON.stringify({
  //       success: false,
  //       error: 'Se requieren us_email y codigo.',
  //     });
  //   }
  //
  //   const result = await apiPost(VERIFICAR_CODIGO_URL, {
  //     us_email: email,
  //     codigo,
  //   });
  //
  //   const data = result['data'] as Record<string, unknown> | undefined;
  //   if (result['success'] && data?.['token']) {
  //     sessions.set(chatId, {
  //       token: strVal(data['token']),
  //       user_id: strVal(data['us_id'] ?? ''),
  //       name: strVal(data['us_nombres'] ?? ''),
  //       es_vip: false,
  //     });
  //   }
  //
  //   return JSON.stringify(result);
  // }

  // if (toolName === 'crear_compra') {
  //   const clId = toolInput['cl_id'] ?? s?.user_id;
  //   const trId = toolInput['tr_id'];
  //   const pgPrecio = toolInput['pg_precio'];
  //   const pgPackage = strVal(toolInput['pg_package']).trim();
  //
  //   if (
  //     !trId ||
  //     !clId ||
  //     pgPrecio === undefined ||
  //     pgPrecio === null ||
  //     !pgPackage
  //   ) {
  //     return JSON.stringify({
  //       success: false,
  //       error: 'Se requieren cl_id, tr_id, pg_precio y pg_package.',
  //     });
  //   }
  //
  //   const clIdNum = Number(clId);
  //   const trIdNum = Number(trId);
  //   const pgPrecioNum = Number(pgPrecio);
  //   if (
  //     !Number.isFinite(clIdNum) ||
  //     !Number.isFinite(trIdNum) ||
  //     !Number.isFinite(pgPrecioNum)
  //   ) {
  //     return JSON.stringify({
  //       success: false,
  //       error: 'cl_id, tr_id y pg_precio deben ser numéricos.',
  //     });
  //   }
  //
  //   const payload: Record<string, unknown> = {
  //     cl_id: clIdNum,
  //     tr_id: trIdNum,
  //     pg_precio: pgPrecioNum,
  //     pg_package: pgPackage,
  //   };
  //
  //   const result = await apiPost(CREAR_COMPRA_URL, payload, token);
  //
  //   let paymentUrl: string | undefined;
  //   let pagoId: number | undefined;
  //   try {
  //     const data = result['data'] as Record<string, unknown> | undefined;
  //     if (data) {
  //       paymentUrl =
  //         typeof data['payment_url'] === 'string'
  //           ? data['payment_url']
  //           : undefined;
  //       const pgId = data['pg_id'];
  //       pagoId = typeof pgId === 'number' ? pgId : Number(pgId) || undefined;
  //     }
  //   } catch {
  //     /* no es JSON o formato inesperado */
  //   }
  //
  //   return JSON.stringify({
  //     success: result['success'] ?? !!paymentUrl,
  //     payment_url: paymentUrl,
  //     pg_id: pagoId,
  //     url_generado_pago: paymentUrl,
  //     raw: result,
  //   });
  // }

  // if (toolName === 'inicio_tramite_express') {
  //   const clId = toolInput['cl_id'] ?? s?.user_id;
  //   const productoId = toolInput['producto_id'];
  //   const observacion = strVal(toolInput['observacion']).trim();
  //   const meta = strVal(toolInput['meta']).trim();
  //
  //   if (!productoId || !clId) {
  //     return JSON.stringify({
  //       success: false,
  //       error:
  //         'Se requieren cl_id y producto_id para iniciar el trámite express.',
  //     });
  //   }
  //
  //   const clIdNum = Number(clId);
  //   const productoIdNum = Number(productoId);
  //   if (!Number.isFinite(clIdNum) || !Number.isFinite(productoIdNum)) {
  //     return JSON.stringify({
  //       success: false,
  //       error: 'cl_id y producto_id deben ser valores numéricos.',
  //     });
  //   }
  //
  //   const payload: Record<string, unknown> = {
  //     cl_id: clIdNum,
  //     producto_id: productoIdNum,
  //   };
  //   if (observacion) payload['observacion'] = observacion;
  //   if (meta) payload['meta'] = meta;
  //
  //   const result = await apiPost(INICIO_TRAMITE_EXPRESS, payload, token);
  //
  //   let paymentUrl: string | undefined;
  //   try {
  //     const data = result['data'] as Record<string, unknown> | undefined;
  //     if (data) {
  //       paymentUrl =
  //         typeof data['payment_url'] === 'string'
  //           ? (data['payment_url'] as string)
  //           : undefined;
  //     }
  //   } catch {
  //     /* formato inesperado */
  //   }
  //
  //   return JSON.stringify({
  //     success: result['success'] ?? !!paymentUrl,
  //     payment_url: paymentUrl,
  //     url_generado_pago: paymentUrl,
  //     raw: result,
  //   });
  // }

  // if (toolName === 'get_todos_los_tramites') {
  //   return JSON.stringify(await apiGet(TODOS_LOS_TRAMITES_URL));
  // }

  // if (toolName === 'get_sellos_por_tramite') {
  //   const rawTrId = toolInput['tr_id'];
  //   const trId = Number(rawTrId);
  //   if (!Number.isFinite(trId) || trId <= 0) {
  //     return JSON.stringify({
  //       success: false,
  //       error: 'Se requiere tr_id valido (numero mayor a 0).',
  //     });
  //   }
  //   const url = SELLOS_POR_TRAMITE_URL.replace('{id}', String(trId));
  //   return JSON.stringify(await apiGet(url));
  // }

  // ─── TOOLS LOCALES (DB) — ACTIVAS ──────────────────────────────────────

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

  // ─── TOOLS DE IaPreguntas — STUBS (pendiente de implementación) ────────
  //
  // Estas 3 tools están definidas en `src/agent/tools.ts` y tienen su URL
  // activa en `src/api/urls.ts`. Falta implementar la lógica HTTP contra
  // el backend de Audita. Mientras tanto, devuelven un error claro.

  if (toolName === 'obtener_planes_disponibles') {
    return JSON.stringify(await apiGet(PLANES_DISPONIBLES_URL, {}, token));
  }

  if (toolName === 'consultar_resumen_financiero_hospitales') {
    void RESUMEN_FINANCIERO_HOSPITALES_URL;
    void token;
    return JSON.stringify({
      success: false,
      error:
        'Tool pendiente de implementación. La lógica HTTP contra el backend aún no está cableada.',
      url: RESUMEN_FINANCIERO_HOSPITALES_URL,
    });
  }

  if (toolName === 'consultar_determinacion_adversa_mas_frecuente') {
    void DETERMINACION_ADVERSA_MAS_FRECUENTE_URL;
    void token;
    return JSON.stringify({
      success: false,
      error:
        'Tool pendiente de implementación. La lógica HTTP contra el backend aún no está cableada.',
      url: DETERMINACION_ADVERSA_MAS_FRECUENTE_URL,
    });
  }

  if (toolName === 'consultar_concepto_mas_dias_denegados') {
    void CONCEPTO_MAS_DIAS_DENEGADOS_URL;
    void token;
    return JSON.stringify({
      success: false,
      error:
        'Tool pendiente de implementación. La lógica HTTP contra el backend aún no está cableada.',
      url: CONCEPTO_MAS_DIAS_DENEGADOS_URL,
    });
  }

  return JSON.stringify({
    success: false,
    error: `Herramienta desconocida: ${toolName}`,
  });
}