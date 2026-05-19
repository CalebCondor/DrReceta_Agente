// src/agent/executor.ts
// Ejecuta la herramienta solicitada por Claude y devuelve el resultado como JSON string

import { sessions } from './state';
import { apiPost, apiGet } from '../api/http';
import { DbService } from './db.service';
import {
  VERIFICAR_REGISTRAR_RESIDENTES_URL,
  VERIFICAR_REGISTRAR_TURISTAS_URL,
  CREAR_COMPRA_RESIDENTES_URL,
  CREAR_COMPRA_TURISTAS_URL,
  VERIFICAR_CODIGO_RESIDENTES_URL,
  VERIFICAR_CODIGO_TURISTAS_URL,
  RESIDENTES_PACKAGES_URL,
  TURISTAS_PACKAGES_URL,
  DISPENSARIOS_RESIDENTES_URL,
  DETALLE_PAGO_RESIDENTES_URL,
  DETALLE_PAGO_TURISTAS_URL,
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
      error:
        'Usuario no autenticado. Debe iniciar sesión en IslandMedPR.com para acceder a sus datos personales.',
    });
  }

  if (toolName === 'get_dispensarios') {
    return JSON.stringify(await apiGet(DISPENSARIOS_RESIDENTES_URL, {}));
  }

  if (toolName === 'get_detalle_pago') {
    const token = strVal(toolInput['token']) || s?.token || '';
    const userType: 'residente' | 'turista' =
      strVal(toolInput['user_type']) === 'turista' ? 'turista' : 'residente';
    const detalleUrl =
      userType === 'turista'
        ? DETALLE_PAGO_TURISTAS_URL
        : DETALLE_PAGO_RESIDENTES_URL;
    return JSON.stringify(await apiGet(detalleUrl, { token }));
  }

  if (toolName === 'get_productos') {
    const userType: 'residente' | 'turista' =
      strVal(toolInput['user_type']).trim() === 'turista'
        ? 'turista'
        : 'residente';
    const packagesUrl =
      userType === 'turista' ? TURISTAS_PACKAGES_URL : RESIDENTES_PACKAGES_URL;

    const queryParams: Record<string, string> = {};
    if (toolInput['pq_id']) queryParams['pq_id'] = strVal(toolInput['pq_id']);
    if (toolInput['limit']) queryParams['limit'] = strVal(toolInput['limit']);
    if (toolInput['offset'])
      queryParams['offset'] = strVal(toolInput['offset']);

    const raw = await apiGet(packagesUrl, queryParams);

    const packages: unknown[] = Array.isArray(raw['data'])
      ? (raw['data'] as unknown[])
      : [];

    // Filtrado opcional por busqueda sobre pq_tit_esp / pq_tit_eng / pq_det_esp
    const busqueda = strVal(toolInput['busqueda']).toLowerCase().trim();
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const filtered = busqueda
      ? (() => {
          const terms = normalize(busqueda)
            .split(/\s+/)
            .filter((t) => t.length > 2);
          if (terms.length === 0) return packages;
          return packages.filter((p) => {
            if (!p || typeof p !== 'object') return false;
            const product = p as Record<string, unknown>;
            const haystack =
              normalize(strVal(product['pq_tit_esp'])) +
              ' ' +
              normalize(strVal(product['pq_tit_eng'])) +
              ' ' +
              normalize(strVal(product['pq_det_esp']));
            return terms.some((t) => haystack.includes(t));
          });
        })()
      : packages;

    return JSON.stringify({
      success: true,
      total: filtered.length,
      data: filtered,
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
    const b = strVal(toolInput['busqueda']).toLowerCase();
    try {
      const { rows } = await db.query(
        'SELECT pregunta, respuesta FROM conocimiento_especifico ' +
          'WHERE LOWER(pregunta) LIKE $1 OR LOWER(respuesta) LIKE $1 ' +
          'ORDER BY created_at DESC LIMIT 5',
        [`%${b}%`],
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
    const userType: 'residente' | 'turista' =
      strVal(toolInput['user_type']).trim() === 'turista'
        ? 'turista'
        : 'residente';
    const registrarUrl =
      userType === 'turista'
        ? VERIFICAR_REGISTRAR_TURISTAS_URL
        : VERIFICAR_REGISTRAR_RESIDENTES_URL;

    const payload: Record<string, unknown> = { us_email: email };
    const firstName = strVal(toolInput['us_first_name']).trim();
    const lastName = strVal(toolInput['us_last_name']).trim();
    const phone = strVal(toolInput['us_phone']).trim();
    const password = strVal(toolInput['us_pasww']).trim();
    if (firstName) payload['us_first_name'] = firstName;
    if (lastName) payload['us_last_name'] = lastName;
    if (phone) payload['us_phone'] = phone;
    if (password) payload['us_pasww'] = password;

    const result = await apiPost(registrarUrl, payload);

    // Si la API devolvió un token, almacenarlo en sesión para peticiones autenticadas
    const data = result['data'] as Record<string, unknown> | undefined;
    if (data?.['token']) {
      sessions.set(chatId, {
        token: strVal(data['token']),
        user_id: strVal(data['us_id'] ?? ''),
        name: strVal(data['us_first_name'] ?? data['us_nombres'] ?? ''),
        es_vip: false,
        user_type: userType,
      });
    }

    return JSON.stringify(result);
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
    const userType: 'residente' | 'turista' =
      strVal(toolInput['user_type']).trim() === 'turista'
        ? 'turista'
        : 'residente';
    const verificarUrl =
      userType === 'turista'
        ? VERIFICAR_CODIGO_TURISTAS_URL
        : VERIFICAR_CODIGO_RESIDENTES_URL;

    const result = await apiPost(verificarUrl, {
      us_email: email,
      codigo,
    });

    // Si el código es correcto, guardar la sesión autenticada
    const data = result['data'] as Record<string, unknown> | undefined;
    if (result['success'] && data?.['token']) {
      sessions.set(chatId, {
        token: strVal(data['token']),
        user_id: strVal(data['us_id'] ?? ''),
        name: strVal(data['us_first_name'] ?? data['us_nombres'] ?? ''),
        es_vip: false,
        user_type: userType,
      });
    }

    return JSON.stringify(result);
  }

  if (toolName === 'crear_compra') {
    const token = strVal(toolInput['token']) || s?.token || '';
    const pqId = toolInput['pq_id'];
    const usId = toolInput['us_id'] ?? s?.user_id;
    const amount = toolInput['amount'];
    if (!pqId || !usId || !amount) {
      return JSON.stringify({
        success: false,
        error: 'Se requieren pq_id, us_id y amount.',
      });
    }
    const userType: 'residente' | 'turista' =
      s?.user_type === 'turista' ? 'turista' : 'residente';
    const pagoUrl =
      userType === 'turista'
        ? CREAR_COMPRA_TURISTAS_URL
        : CREAR_COMPRA_RESIDENTES_URL;
    const body: Record<string, unknown> = {
      us_id: usId,
      pq_id: pqId,
      amount,
    };
    if (toolInput['pg_metodo']) body['pg_metodo'] = toolInput['pg_metodo'];
    if (toolInput['ra_tipo_pac'])
      body['ra_tipo_pac'] = strVal(toolInput['ra_tipo_pac']);
    if (toolInput['tarjeta_pvc'])
      body['tarjeta_pvc'] = strVal(toolInput['tarjeta_pvc']);
    if (toolInput['anombre_de'])
      body['cod_vend'] = strVal(toolInput['anombre_de']);
    return JSON.stringify(await apiPost(pagoUrl, body, token));
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

  return JSON.stringify({
    success: false,
    error: `Herramienta desconocida: ${toolName}`,
  });
}
