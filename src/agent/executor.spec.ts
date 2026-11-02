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
