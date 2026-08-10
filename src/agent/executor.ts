// src/agent/executor.ts
// Ejecuta la herramienta solicitada por Claude y devuelve el resultado como JSON string

import { Logger } from '@nestjs/common';
import { sessions } from './state';
import { apiPost, apiGet } from '../api/http';
import { DbService } from './db.service';

const logger = new Logger('AgentExecutor');
import {
  PERFIL_URL,
  MIS_ORDENES_URL,
  MIS_PAGOS_URL,
  VERIFICAR_REGISTRAR_URL,
  CREAR_COMPRA_URL,
  VERIFICAR_CODIGO_URL,
  INICIO_PAGO_IA_URL,
  TODOS_LOS_TRAMITES_URL,
  SELLOS_POR_TRAMITE_URL,
} from '../api/urls';

function strVal(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const AUTH_REQUIRED = new Set([
  'get_perfil',
  'actualizar_perfil',
  'get_ordenes',
  'get_pagos',
  'crear_compra',
  'inicio_pago_ia',
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
      error:
        'Usuario no autenticado. Debe iniciar sesión en Tu Licencia (tulicenciapr.com) para acceder a sus datos personales.',
    });
  }

  if (toolName === 'get_perfil') {
    return JSON.stringify(await apiGet(PERFIL_URL, {}, token));
  }

  if (toolName === 'actualizar_perfil') {
    const rawCampos = Object.assign(
      {},
      toolInput['campos'] as Record<string, unknown>,
    );

    const FIELD_MAP: Record<string, string> = {
      nombre: 'us_nombres',
      nombres: 'us_nombres',
      name: 'us_nombres',
      email: 'us_email',
      correo: 'us_email',
      telefono: 'us_telefono',
      phone: 'us_telefono',
      pais: 'us_pais',
      country: 'us_pais',
      direccion: 'us_direccion',
      address: 'us_direccion',
      ciudad: 'us_ciudad',
      city: 'us_ciudad',
      fecha_nacimiento: 'us_fech_nac',
      fech_nac: 'us_fech_nac',
      codigo_postal: 'us_code_postal',
      code_postal: 'us_code_postal',
    };

    const camposNuevos: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawCampos)) {
      const mappedKey = FIELD_MAP[key.toLowerCase()] ?? key;
      camposNuevos[mappedKey] = value;
    }

    const camposReales = Object.keys(camposNuevos).filter((k) => k !== 'us_id');
    if (camposReales.length === 0) {
      return JSON.stringify({
        success: false,
        error: 'No se especificaron campos a actualizar.',
      });
    }

    const perfilActual = await apiGet(PERFIL_URL, {}, token);
    const datosActuales =
      perfilActual['success'] &&
      perfilActual['data'] &&
      typeof perfilActual['data'] === 'object'
        ? (perfilActual['data'] as Record<string, unknown>)
        : {};

    const PERFIL_FIELDS = [
      'us_nombres',
      'us_email',
      'us_telefono',
      'us_pais',
      'us_direccion',
      'us_ciudad',
      'us_fech_nac',
      'us_code_postal',
    ];

    const payload: Record<string, unknown> = { us_id: userId };
    for (const field of PERFIL_FIELDS) {
      payload[field] = camposNuevos[field] ?? datosActuales[field] ?? '';
    }

    return JSON.stringify(await apiPost(PERFIL_URL, payload, token));
  }

  if (toolName === 'get_ordenes') {
    return JSON.stringify(
      await apiGet(MIS_ORDENES_URL, { us_id: String(userId) }, token),
    );
  }

  if (toolName === 'get_pagos') {
    return JSON.stringify(await apiPost(MIS_PAGOS_URL, {}, token));
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
        `SELECT pregunta, respuesta, (${scoreParts}) AS score
         FROM conocimiento_especifico
         WHERE ${conds}
         ORDER BY score DESC, id DESC
         LIMIT 5`,
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
        'INSERT INTO memoria_largo_plazo (chat_id, clave, valor) VALUES ($1, $2, $3) ' +
          'ON CONFLICT (chat_id, clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = CURRENT_TIMESTAMP',
        [chatId, k, v],
      );
      return JSON.stringify({ success: true, message: `Memorizado: ${k}` });
    } catch (e: unknown) {
      return JSON.stringify({ success: false, error: errMsg(e) });
    }
  }

  if (toolName === 'verificar_o_registrar_usuario') {
    const email = strVal(toolInput['us_email']).trim();
    if (!email) {
      return JSON.stringify({ success: false, error: 'Se requiere us_email.' });
    }

    // Validación de formato de email antes de llamar a la API.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return JSON.stringify({
        success: false,
        exists: false,
        error:
          'El correo electrónico no tiene un formato válido. Verifica e intenta de nuevo.',
      });
    }

    const payload: Record<string, unknown> = { us_email: email };
    const nombres = strVal(toolInput['us_nombres']).trim();
    const telefono = strVal(toolInput['us_telefono']).trim();
    const clave = strVal(toolInput['us_clave']).trim();
    if (nombres) payload['us_nombres'] = nombres;
    if (telefono) payload['us_telefono'] = telefono;
    if (clave) payload['us_clave'] = clave;

    const result = await apiPost(VERIFICAR_REGISTRAR_URL, payload);

    logger.log(
      `[verificar_o_registrar_usuario] payload=${JSON.stringify(payload)} result=${JSON.stringify(result)}`,
    );

    const data = result['data'] as Record<string, unknown> | undefined;
    const apiSuccess = result['success'] === true;

    // Si la API devolvió token directo (registro nuevo exitoso), guardarlo
    if (apiSuccess && data?.['token']) {
      sessions.set(chatId, {
        token: strVal(data['token']),
        user_id: strVal(data['us_id'] ?? ''),
        name: strVal(data['us_nombres'] ?? ''),
        es_vip: false,
      });
      logger.log(
        `[verificar_o_registrar_usuario] sesión creada (registro) chat=${chatId} us_id=${strVal(data['us_id'] ?? '')}`,
      );
    }

    // Enriquecer la respuesta con campos claros para que el bot distinga:
    //   success+codigo=existe (código enviado al correo)
    //   success+token=registrado (cuenta nueva creada)
    //   !success=no existe → el bot debe proceder con el registro pidiendo los datos
    const enriched = {
      ...result,
      exists: apiSuccess && (!!data?.['codigo'] || !!data?.['token']),
      code_sent: apiSuccess && !!data?.['codigo'],
    };
    return JSON.stringify(enriched);
  }

  if (toolName === 'verificar_codigo') {
    const email = strVal(toolInput['us_email']).trim();
    const codigo = strVal(toolInput['codigo']).trim();
    if (!email || !codigo) {
      return JSON.stringify({
        success: false,
        error: 'Se requieren us_email y codigo.',
      });
    }

    const result = await apiPost(VERIFICAR_CODIGO_URL, {
      us_email: email,
      codigo,
    });

    // Si el código es correcto, guardar la sesión autenticada
    const data = result['data'] as Record<string, unknown> | undefined;
    if (result['success'] && data?.['token']) {
      sessions.set(chatId, {
        token: strVal(data['token']),
        user_id: strVal(data['us_id'] ?? ''),
        name: strVal(data['us_nombres'] ?? ''),
        es_vip: false,
      });
    }

    return JSON.stringify(result);
  }

  if (toolName === 'crear_compra') {
    const trId = toolInput['tr_id'];
    const clId = toolInput['cl_id'] ?? s?.user_id;
    const amount = toolInput['amount'];
    const name = strVal(toolInput['name']).trim();
    const description = strVal(toolInput['description']).trim();
    const returnUrl = strVal(toolInput['return_url']).trim();

    if (!trId || !clId || amount === undefined || amount === null || !name) {
      return JSON.stringify({
        success: false,
        error: 'Se requieren tr_id, cl_id, amount y name.',
      });
    }

    const payload: Record<string, unknown> = {
      tr_id: trId,
      cl_id: clId,
      amount: amount,
      name,
    };
    if (description) payload['description'] = description;
    if (returnUrl) payload['return_url'] = returnUrl;

    const result = await apiPost(CREAR_COMPRA_URL, payload, token);

    // Extraer process_url de la respuesta de PlaceToPay y devolverlo como
    // url_generado_pago para que el system prompt lo muestre al usuario.
    let processUrl: string | undefined;
    let reference: string | undefined;
    let pagoId: number | undefined;
    try {
      const data = result['data'] as Record<string, unknown> | undefined;
      if (data) {
        processUrl =
          typeof data['process_url'] === 'string'
            ? data['process_url']
            : undefined;
        reference =
          typeof data['reference'] === 'string' ? data['reference'] : undefined;
        const pgId = data['pago_id'];
        pagoId = typeof pgId === 'number' ? pgId : Number(pgId) || undefined;
      }
    } catch {
      /* no es JSON o formato inesperado */
    }

    // Devolver estructura enriquecida para que el system prompt pueda usar
    // el process_url como enlace de pago.
    return JSON.stringify({
      success: result['success'] ?? true,
      process_url: processUrl,
      reference,
      pago_id: pagoId,
      cp_code: reference, // alias para compatibilidad con el system prompt viejo
      url_generado_pago: processUrl, // alias para compatibilidad
      raw: result,
    });
  }

  if (toolName === 'inicio_pago_ia') {
    const clId = toolInput['cl_id'] ?? s?.user_id;
    const trId = toolInput['tr_id'];
    const pgPrecio = toolInput['pg_precio'];
    const pgPackage = strVal(toolInput['pg_package']).trim();
    const pgStatus = strVal(toolInput['pg_status']).trim() || 'PENDING';
    const tokenIa = strVal(toolInput['token_ia']).trim();
    const method = strVal(toolInput['method']).trim();

    if (
      !trId ||
      !clId ||
      pgPrecio === undefined ||
      pgPrecio === null ||
      !pgPackage
    ) {
      return JSON.stringify({
        success: false,
        error:
          'Se requieren cl_id, tr_id, pg_precio y pg_package para iniciar el pago IA.',
      });
    }

    const clIdNum = Number(clId);
    const trIdNum = Number(trId);
    const pgPrecioNum = Number(pgPrecio);
    if (
      !Number.isFinite(clIdNum) ||
      !Number.isFinite(trIdNum) ||
      !Number.isFinite(pgPrecioNum)
    ) {
      return JSON.stringify({
        success: false,
        error: 'cl_id, tr_id y pg_precio deben ser numéricos.',
      });
    }

    const payload: Record<string, unknown> = {
      cl_id: clIdNum,
      tr_id: trIdNum,
      pg_precio: pgPrecioNum,
      pg_package: pgPackage,
      pg_status: pgStatus,
    };
    if (tokenIa) payload['token_ia'] = tokenIa;
    if (method) payload['method'] = method;

    const result = await apiPost(INICIO_PAGO_IA_URL, payload, token);

    let paymentUrl: string | undefined;
    let pagoId: number | undefined;
    let tokenIaResp: string | undefined;
    let respMethod: string | undefined;
    let respPackage: string | undefined;
    let respStatus: string | undefined;
    try {
      const data = result['data'] as Record<string, unknown> | undefined;
      if (data) {
        paymentUrl =
          typeof data['payment_url'] === 'string'
            ? data['payment_url']
            : undefined;
        const pgId = data['pg_id'];
        pagoId = typeof pgId === 'number' ? pgId : Number(pgId) || undefined;
        tokenIaResp =
          typeof data['token_ia'] === 'string' ? data['token_ia'] : undefined;
        respMethod =
          typeof data['method'] === 'string' ? data['method'] : undefined;
        respPackage =
          typeof data['pg_package'] === 'string'
            ? data['pg_package']
            : undefined;
        respStatus =
          typeof data['pg_status'] === 'string' ? data['pg_status'] : undefined;
      }
    } catch {
      /* no es JSON o formato inesperado */
    }

    return JSON.stringify({
      success: result['success'] ?? !!paymentUrl,
      payment_url: paymentUrl,
      pg_id: pagoId,
      token_ia: tokenIaResp,
      method: respMethod,
      pg_package: respPackage,
      pg_status: respStatus,
      url_generado_pago: paymentUrl,
      raw: result,
    });
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

  if (toolName === 'get_todos_los_tramites') {
    return JSON.stringify(await apiGet(TODOS_LOS_TRAMITES_URL));
  }

  if (toolName === 'get_sellos_por_tramite') {
    const rawTrId = toolInput['tr_id'];
    const trId = Number(rawTrId);
    if (!Number.isFinite(trId) || trId <= 0) {
      return JSON.stringify({
        success: false,
        error: 'Se requiere tr_id valido (numero mayor a 0).',
      });
    }
    const url = SELLOS_POR_TRAMITE_URL.replace('{id}', String(trId));
    return JSON.stringify(await apiGet(url));
  }

  return JSON.stringify({
    success: false,
    error: `Herramienta desconocida: ${toolName}`,
  });
}
