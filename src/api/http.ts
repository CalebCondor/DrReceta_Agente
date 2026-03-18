async function parseResponse(r: Response, url: string): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!r.ok) {
    return { success: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { success: false, error: `Respuesta no-JSON: ${text.slice(0, 200)}` };
  }
}

export async function apiPost(
  url: string,
  data: Record<string, unknown> = {},
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15_000),
    });
    return parseResponse(r, url);
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function apiGet(
  url: string,
  params: Record<string, string> = {},
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;
  try {
    const r = await fetch(fullUrl, { headers, signal: AbortSignal.timeout(15_000) });
    return parseResponse(r, fullUrl);
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
