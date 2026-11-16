import {
  alcanceDeSesion,
  apiPostConAlcance,
  aplicarAlcanceHospitales,
  extraerToken,
  leerClaimsDelToken,
  resolverAlcance,
} from './alcance';
import { sessions, type SessionScope } from './state';

// `state.ts` instancia el SDK de Anthropic al importarse; el mock virtual
// permite correr el test sin depender del paquete instalado.
jest.mock(
  '@anthropic-ai/sdk',
  () => ({ __esModule: true, default: class {} }),
  { virtual: true },
);

const ALCANCE: SessionScope = {
  hospitalesIds: [5, 6],
  hospitales: ['Hospital Bayamon', 'Hospital San Lucas'],
  restringido: true,
};

describe('extraerToken', () => {
  it('extrae el token del header Authorization con esquema Bearer', () => {
    expect(extraerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('acepta el header sin esquema Bearer', () => {
    expect(extraerToken('abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('usa el campo `token` del body cuando no hay header', () => {
    expect(extraerToken(undefined, 'abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('prioriza el header sobre el body', () => {
    expect(extraerToken('Bearer del-header', 'del-body')).toBe('del-header');
  });

  it('devuelve null cuando no hay token', () => {
    expect(extraerToken(undefined, undefined)).toBeNull();
    expect(extraerToken('', '   ')).toBeNull();
  });
});

describe('leerClaimsDelToken', () => {
  const tokenConClaims = (claims: Record<string, unknown>): string => {
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256' })}.${b64(claims)}.firma`;
  };

  it('lee el claim `rol` y `nombre` del payload', () => {
    const claims = leerClaimsDelToken(
      tokenConClaims({ rol: 'MEDICO', nombre: 'Caleb' }),
    );
    expect(claims.rol).toBe('MEDICO');
    expect(claims.nombre).toBe('Caleb');
  });

  it('devuelve vacío si el token no es un JWT legible', () => {
    expect(leerClaimsDelToken(undefined)).toEqual({});
    expect(leerClaimsDelToken('no-es-un-jwt')).toEqual({});
  });
});

describe('aplicarAlcanceHospitales', () => {
  it('sin alcance resuelto deja el body intacto', () => {
    const body = { idHospitales: [99], global: true };
    const r = aplicarAlcanceHospitales(body, null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toEqual(body);
  });

  it('convierte `global: true` en la lista exacta de hospitales permitidos', () => {
    const r = aplicarAlcanceHospitales({ global: true }, ALCANCE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).not.toHaveProperty('global');
      expect(r.body['idHospitales']).toEqual([5, 6]);
    }
  });

  it('filtra `idHospitales` contra el alcance del usuario', () => {
    const r = aplicarAlcanceHospitales({ idHospitales: [5, 99] }, ALCANCE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body['idHospitales']).toEqual([5]);
  });

  it('rechaza la consulta cuando NINGÚN hospital está permitido', () => {
    const r = aplicarAlcanceHospitales({ idHospitales: [98, 99] }, ALCANCE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no está entre los que');
  });

  it('rechaza la consulta cuando el usuario no tiene ningún hospital', () => {
    const r = aplicarAlcanceHospitales(
      { idHospitales: [5] },
      { ...ALCANCE, hospitalesIds: [], hospitales: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no tiene acceso a ningún hospital');
  });

  it('no toca el body cuando no se mandan hospitales', () => {
    const r = aplicarAlcanceHospitales({ anio: 2026 }, ALCANCE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toEqual({ anio: 2026 });
  });
});

describe('resolverAlcance', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            { hosId: 5, hosNombre: 'Hospital Bayamon' },
            { hosId: 6, hosNombre: 'Hospital San Lucas' },
          ]),
        ),
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    sessions.clear();
  });

  it('devuelve null sin token (no hay sesión autenticada)', async () => {
    expect(await resolverAlcance(1, undefined)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta /api/hospitales/acceso con el header Bearer', async () => {
    const scope = await resolverAlcance(1, 'jwt-123');

    expect(scope).not.toBeNull();
    expect(scope?.hospitalesIds).toEqual([5, 6]);
    expect(scope?.hospitales).toEqual(['Hospital Bayamon', 'Hospital San Lucas']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/hospitales/acceso');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer jwt-123',
    );
  });

  it('NO consulta /api/hospitales/activos (devuelve el catálogo global)', async () => {
    await resolverAlcance(1, 'jwt-123');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('/api/hospitales/activos');
  });

  it('el alcance contiene SOLO los hospitales del usuario', async () => {
    // El usuario tiene acceso a 3 de los 5 hospitales del tenant.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            { hosId: 4, hosNombre: 'Centro Medico del Caribe' },
            { hosId: 5, hosNombre: 'Hospital Bayamon' },
            { hosId: 1, hosNombre: 'Hospital Central' },
          ]),
        ),
    });

    const scope = await resolverAlcance(7, 'jwt-123');

    expect(scope?.hospitalesIds).toEqual([4, 5, 1]);
    expect(scope?.hospitales).toHaveLength(3);

    // Los 2 hospitales fuera del alcance quedan recortados en las tools.
    const r = aplicarAlcanceHospitales(
      { idHospitales: [4, 3, 6] },
      scope,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body['idHospitales']).toEqual([4]);
  });

  it('guarda el alcance en la sesión y lo reutiliza (caché)', async () => {
    await resolverAlcance(1, 'jwt-123');
    expect(alcanceDeSesion(1)?.hospitalesIds).toEqual([5, 6]);

    await resolverAlcance(1, 'jwt-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve null si el backend rechaza la petición', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    expect(await resolverAlcance(1, 'jwt-123')).toBeNull();
  });
});

describe('apiPostConAlcance', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  it('no pega al backend cuando el hospital está fuera del alcance', async () => {
    const out = await apiPostConAlcance(
      'http://localhost/api/IaPreguntas/montos-por-estado',
      { idHospitales: [99] },
      'jwt-123',
      ALCANCE,
    );

    expect(out['success']).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda el body recortado cuando el hospital está permitido', async () => {
    await apiPostConAlcance(
      'http://localhost/api/IaPreguntas/montos-por-estado',
      { idHospitales: [5, 99] },
      'jwt-123',
      ALCANCE,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['idHospitales']).toEqual([5]);
  });
});
