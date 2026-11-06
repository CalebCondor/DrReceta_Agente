import { detectFilterMismatch } from './agent.service';

// `state.ts` instancia el SDK de Anthropic al importarse; el mock virtual
// permite correr el test sin depender del paquete instalado.
jest.mock(
  '@anthropic-ai/sdk',
  () => ({ __esModule: true, default: class {} }),
  { virtual: true },
);

describe('detectFilterMismatch · tools con contrato de RANGO', () => {
  const rango = {
    fechaInicio: '2026-01-01',
    fechaFin: '2026-02-28',
    idHospitales: [5],
  };

  it('rechaza pedir `meses` cuando la tool usa fechaInicio/fechaFin', () => {
    const mismatch = detectFilterMismatch('ahora entre marzo y octubre', rango);
    expect(mismatch).toBeTruthy();
    expect(mismatch).toContain('fechaInicio');
    expect(mismatch).not.toContain('meses:');
  });

  it('no dispara si el mes pedido ya está en el rango aplicado', () => {
    const mismatch = detectFilterMismatch('ahora en febrero', rango);
    expect(mismatch).toBeNull();
  });

  it('detecta el cambio de año contra el rango', () => {
    const mismatch = detectFilterMismatch('ahora en 2025', rango);
    expect(mismatch).toBeTruthy();
    expect(mismatch).toContain('2025-01-01');
  });
});

describe('detectFilterMismatch · tools con anio/meses (sin cambios)', () => {
  it('sigue pidiendo `meses` cuando la tool usa el contrato legado', () => {
    const mismatch = detectFilterMismatch('ahora en octubre', {
      anio: 2026,
      meses: [3],
      idHospitales: [5],
    });
    expect(mismatch).toBeTruthy();
    expect(mismatch).toContain('meses:');
  });
});
