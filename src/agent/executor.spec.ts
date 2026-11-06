import { executeTool } from './executor';
import { DbService } from './db.service';

// `state.ts` instancia el SDK de Anthropic al importarse; el mock virtual
// permite correr el test sin depender del paquete instalado.
jest.mock(
  '@anthropic-ai/sdk',
  () => ({ __esModule: true, default: class {} }),
  { virtual: true },
);

describe('executeTool · consultacion de determinación adversa por auditor', () => {
  it('rechaza la llamada sin idHospitales sin pegarle al backend', async () => {
    const out = JSON.parse(
      await executeTool(
        'consultar_determinacion_adversa_auditor',
        { anio: 2024, idAuditor: 1 },
        1,
        {} as DbService,
      ),
    ) as { success?: boolean; error?: string };
    expect(out.success).toBe(false);
    expect(out.error).toContain('idHospitales');
  });
});

describe.each([
  'consultar_resumen_financiero_hospitales',
  'consultar_montos_por_estado',
  'consultar_determinacion_adversa_mas_frecuente',
  'consultar_determinacion_adversa_monto',
  'consultar_determinacion_adversa_monto_consolidado',
  'consultar_desempeno_auditor',
  'consultar_determinacion_adversa_auditor',
  'consultar_facturacion_auditor_hospitales',
  'consultar_desempeno_manejador_caso',
])('executeTool · %s', (toolName) => {
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

  const body = async (input: Record<string, unknown>) => {
    await executeTool(toolName, input, 1, {} as DbService);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  };

  it('manda el rango `fechaInicio`/`fechaFin` y NO `anio`/`meses`/`dia`', async () => {
    const b = await body({
      fechaInicio: '2026-03-01',
      fechaFin: '2026-04-30',
      idHospitales: [6],
    });
    expect(b['fechaInicio']).toBe('2026-03-01');
    expect(b['fechaFin']).toBe('2026-04-30');
    expect(b).not.toHaveProperty('anio');
    expect(b).not.toHaveProperty('meses');
    expect(b).not.toHaveProperty('dia');
  });

  it('usa el año en curso COMPLETO cuando no viene período', async () => {
    const b = await body({ idHospitales: [6] });
    const anio = new Date().getFullYear();
    expect(b['fechaInicio']).toBe(`${anio}-01-01`);
    expect(b['fechaFin']).toBe(`${anio}-12-31`);
  });

  it('traduce `anio`/`meses` (costumbre del modelo) al rango equivalente', async () => {
    const b = await body({ anio: 2025, meses: [10], idHospitales: [6] });
    expect(b['fechaInicio']).toBe('2025-10-01');
    expect(b['fechaFin']).toBe('2025-10-31');
  });
});

describe('executeTool · consultar_desempeno_medico', () => {
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

  const called = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
      url,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
  };

  it('manda `agruparPor` en el body (el backend lo lee del body)', async () => {
    await executeTool(
      'consultar_desempeno_medico',
      { anio: 2026, idHospitales: [6], agruparPor: 2 },
      1,
      {} as DbService,
    );
    const { url, body } = called();
    expect(body['agruparPor']).toBe(2);
    expect(url).not.toContain('agruparPor');
  });

  it('omite `agruparPor` cuando no viene (modo por hospital)', async () => {
    await executeTool(
      'consultar_desempeno_medico',
      { anio: 2026, idHospitales: [6] },
      1,
      {} as DbService,
    );
    const { body } = called();
    expect(body).not.toHaveProperty('agruparPor');
  });

  it('manda el ID del médico como query param `idMedicosAlta` (no en el body)', async () => {
    await executeTool(
      'consultar_desempeno_medico',
      { anio: 2026, idHospitales: [6], idMedicoAlta: 16 },
      1,
      {} as DbService,
    );
    const { url, body } = called();
    expect(url).toContain('idMedicosAlta=16');
    expect(body).not.toHaveProperty('idMedicoAlta');
  });
});
