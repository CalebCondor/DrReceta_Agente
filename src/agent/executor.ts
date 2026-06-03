// src/agent/executor.ts
// Ejecuta la herramienta solicitada por Claude y devuelve el resultado como JSON string

import { sessions } from './state';
import { apiPost, apiGet } from '../api/http';
import { DbService } from './db.service';
import {
  STATUS_GLOBAL_URL,
  USER_BY_EMAIL_URL,
  EDIT_CONTACT_URL,
  RESIDENTES_URL_FOTOS,
  TURISTAS_URL_FOTOS,
  LIC_BY_CODE_URL,
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
  'editar_pago',
  'editar_perfil',
]);

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  chatId: number,
  db: DbService,
): Promise<string> {
  const s = sessions.get(chatId);
  if (AUTH_REQUIRED.has(toolName) && !s) {
    return JSON.stringify({
      success: false,
      error:
        'Usuario no autenticado. Debe iniciar sesión en IslandMedPR.com para acceder a sus datos personales.',
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

  if (toolName === 'get_status_by_code') {
    const pgCode = strVal(toolInput['pg_code']).trim();
    if (!pgCode) {
      return JSON.stringify({ success: false, error: 'Se requiere pg_code.' });
    }
    return JSON.stringify(await apiGet(STATUS_GLOBAL_URL, { pg_code: pgCode }));
  }

  if (toolName === 'get_user_by_email') {
    const usEmail = strVal(toolInput['us_email']).trim();
    if (!usEmail) {
      return JSON.stringify({ success: false, error: 'Se requiere us_email.' });
    }
    return JSON.stringify(
      await apiGet(USER_BY_EMAIL_URL, { us_email: usEmail }),
    );
  }

  if (toolName === 'edit_contact') {
    const usId = strVal(toolInput['us_id']).trim();
    if (!usId) {
      return JSON.stringify({ success: false, error: 'Se requiere us_id.' });
    }
    const body: Record<string, unknown> = {};
    if (toolInput['us_email'] !== undefined)
      body['us_email'] = strVal(toolInput['us_email']);
    if (toolInput['us_phone'] !== undefined)
      body['us_phone'] = strVal(toolInput['us_phone']);
    if (Object.keys(body).length === 0) {
      return JSON.stringify({
        success: false,
        error: 'Se requiere al menos us_email o us_phone.',
      });
    }
    body['us_id'] = usId;
    return JSON.stringify(await apiPost(EDIT_CONTACT_URL, body));
  }
  if (toolName === 'get_foto_link') {
    const pgCode = strVal(toolInput['pg_code']).trim();
    if (!pgCode) {
      return JSON.stringify({ success: false, error: 'Se requiere pg_code.' });
    }
    const userType: 'residente' | 'turista' =
      strVal(toolInput['user_type']).trim() === 'turista'
        ? 'turista'
        : 'residente';
    const fotoUrl =
      userType === 'turista' ? TURISTAS_URL_FOTOS : RESIDENTES_URL_FOTOS;
    return JSON.stringify(
      await apiGet(fotoUrl, { pg_code: pgCode }, s?.token || ''),
    );
  }

  if (toolName === 'lic_by_code') {
    const pgCode = strVal(toolInput['pg_code']).trim();
    if (!pgCode) {
      return JSON.stringify({ success: false, error: 'Se requiere pg_code.' });
    }
    return JSON.stringify(await apiGet(LIC_BY_CODE_URL, { pg_code: pgCode }));
  }
  return JSON.stringify({
    success: false,
    error: `Herramienta desconocida: ${toolName}`,
  });
}
