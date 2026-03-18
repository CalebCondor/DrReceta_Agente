"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTool = executeTool;
const state_1 = require("./state");
const http_1 = require("../api/http");
const urls_1 = require("../api/urls");
const AUTH_REQUIRED = new Set([
    'get_perfil',
    'actualizar_perfil',
    'get_ordenes',
    'get_pagos',
]);
async function executeTool(toolName, toolInput, chatId, db) {
    const s = state_1.sessions.get(chatId);
    const token = s?.token;
    const userId = s?.user_id;
    if (AUTH_REQUIRED.has(toolName) && !s) {
        return JSON.stringify({
            success: false,
            error: 'Usuario no autenticado. Debe iniciar sesión en DoctorRecetas.com para acceder a sus datos personales.',
        });
    }
    if (toolName === 'get_perfil') {
        return JSON.stringify(await (0, http_1.apiGet)(urls_1.PERFIL_URL, {}, token));
    }
    if (toolName === 'actualizar_perfil') {
        const rawCampos = Object.assign({}, toolInput['campos']);
        const FIELD_MAP = {
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
        const camposNuevos = {};
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
        const perfilActual = await (0, http_1.apiGet)(urls_1.PERFIL_URL, {}, token);
        const datosActuales = perfilActual['success'] && perfilActual['data'] && typeof perfilActual['data'] === 'object'
            ? perfilActual['data']
            : {};
        const PERFIL_FIELDS = [
            'us_nombres', 'us_email', 'us_telefono', 'us_pais',
            'us_direccion', 'us_ciudad', 'us_fech_nac', 'us_code_postal',
        ];
        const payload = { us_id: userId };
        for (const field of PERFIL_FIELDS) {
            payload[field] = camposNuevos[field] ?? datosActuales[field] ?? '';
        }
        return JSON.stringify(await (0, http_1.apiPost)(urls_1.PERFIL_URL, payload, token));
    }
    if (toolName === 'get_ordenes') {
        return JSON.stringify(await (0, http_1.apiGet)(urls_1.MIS_ORDENES_URL, { us_id: String(userId) }, token));
    }
    if (toolName === 'get_pagos') {
        return JSON.stringify(await (0, http_1.apiPost)(urls_1.MIS_PAGOS_URL, {}, token));
    }
    if (toolName === 'get_productos') {
        const raw = await (0, http_1.apiGet)(urls_1.TODAS_LAS_ORDENES_URL);
        const busqueda = String(toolInput['busqueda'] ?? '').toLowerCase().trim();
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const allItems = [];
            for (const [, products] of Object.entries(raw)) {
                if (Array.isArray(products)) {
                    for (const p of products) {
                        if (p && typeof p === 'object') {
                            const product = p;
                            const rel = String(product['url'] ?? '');
                            allItems.push({
                                titulo: String(product['titulo'] ?? product['nombre'] ?? product['producto'] ?? ''),
                                resumen: String(product['resumen'] ?? ''),
                                precio: String(product['precio'] ?? ''),
                                precio_vip: String(product['precio_vip'] ?? ''),
                                web_url: rel ? urls_1.PRODUCTOS_BASE_URL + rel : '',
                            });
                        }
                    }
                }
            }
            const filtered = busqueda
                ? allItems.filter((p) => p.titulo.toLowerCase().includes(busqueda))
                : allItems;
            return JSON.stringify({ success: true, total: filtered.length, data: filtered });
        }
        return JSON.stringify({ success: false, error: 'Formato inesperado de la API' });
    }
    if (toolName === 'recordar_conocimiento') {
        const q = String(toolInput['pregunta'] ?? '');
        const a = String(toolInput['respuesta'] ?? '');
        try {
            await db.query('INSERT INTO conocimiento_especifico (pregunta, respuesta) VALUES ($1, $2)', [q, a]);
            return JSON.stringify({ success: true, message: 'Aprendizaje guardado correctamente.' });
        }
        catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    }
    if (toolName === 'buscar_conocimiento') {
        const b = String(toolInput['busqueda'] ?? '').toLowerCase();
        try {
            const { rows } = await db.query('SELECT pregunta, respuesta FROM conocimiento_especifico ' +
                'WHERE LOWER(pregunta) LIKE $1 OR LOWER(respuesta) LIKE $1 ' +
                'ORDER BY created_at DESC LIMIT 5', [`%${b}%`]);
            return JSON.stringify({ success: true, resultados: rows });
        }
        catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    }
    if (toolName === 'guardar_memoria_usuario') {
        const k = String(toolInput['clave'] ?? '').toLowerCase().trim();
        const v = String(toolInput['valor'] ?? '').trim();
        try {
            await db.query('INSERT INTO memoria_largo_plazo (chat_id, clave, valor) VALUES ($1, $2, $3) ' +
                'ON CONFLICT (chat_id, clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = CURRENT_TIMESTAMP', [chatId, k, v]);
            return JSON.stringify({ success: true, message: `Memorizado: ${k}` });
        }
        catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    }
    if (toolName === 'consultar_memoria_usuario') {
        const k = toolInput['clave'] ? String(toolInput['clave']).toLowerCase().trim() : null;
        try {
            let query = 'SELECT clave, valor FROM memoria_largo_plazo WHERE chat_id = $1';
            const params = [chatId];
            if (k) {
                query += ' AND clave = $2';
                params.push(k);
            }
            const { rows } = await db.query(query, params);
            return JSON.stringify({ success: true, memoria: rows });
        }
        catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    }
    return JSON.stringify({ success: false, error: `Herramienta desconocida: ${toolName}` });
}
//# sourceMappingURL=executor.js.map