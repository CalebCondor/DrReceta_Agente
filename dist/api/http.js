"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiPost = apiPost;
exports.apiGet = apiGet;
async function parseResponse(r) {
    const text = await r.text();
    if (!r.ok) {
        return { success: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return {
            success: false,
            error: `Respuesta no-JSON: ${text.slice(0, 200)}`,
        };
    }
}
async function apiPost(url, data = {}, token) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(15_000),
        });
        return parseResponse(r);
    }
    catch (e) {
        return { success: false, error: String(e) };
    }
}
async function apiGet(url, params = {}, token) {
    const headers = {};
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;
    try {
        const r = await fetch(fullUrl, {
            headers,
            signal: AbortSignal.timeout(15_000),
        });
        return parseResponse(r);
    }
    catch (e) {
        return { success: false, error: String(e) };
    }
}
//# sourceMappingURL=http.js.map