import { containsUnverifiedClaims, esToolDeDatos } from './system';

// ─────────────────────────────────────────────────────────────────────
// Fixture: payload REAL de POST /api/IaPreguntas/planes-por-hospital-con-loc
// para el Hospital Bayamón (idHospital 5), tal como lo devuelve la API.
//
// `conTotales` simula el payload DESPUÉS del fix del backend (que publica
// `cantidadPlanes` / `cantidadNiveles` por hospital); `sinTotales` el de
// antes (sólo los totales por categoría).
// ─────────────────────────────────────────────────────────────────────
function payloadBayamon(conTotales: boolean): string {
  const hospital: Record<string, unknown> = {
    idHospital: 5,
    hospital: 'Hospital Bayamon',
    cantidadCategorias: 3,
    categorias: [
      {
        idCategoria: 15,
        nombre: 'ASES (VITAL)',
        cantidadPlanes: 1,
        planes: [
          {
            idPlan: 1128,
            plan: 'Triple S Vital',
            cantidadNiveles: 3,
            cantidadLocs: 1,
            locs: [
              {
                idLoc: 5,
                codigo: 'ACUTE',
                cantidadNiveles: 3,
                niveles: [
                  { idNivel: 20, nombre: 'PERDIEM ICU', tarifa: 842 },
                  { idNivel: 18, nombre: 'PERDIEM REGULAR', tarifa: 730 },
                  {
                    idNivel: 19,
                    nombre: 'PERDIEM SALA DE EMERGENCIA',
                    tarifa: 165,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        idCategoria: 14,
        nombre: 'COMERCIAL',
        cantidadPlanes: 3,
        planes: [
          {
            idPlan: 1119,
            plan: 'IMC',
            cantidadNiveles: 3,
            cantidadLocs: 1,
            locs: [
              {
                idLoc: 5,
                codigo: 'ACUTE',
                cantidadNiveles: 3,
                niveles: [
                  { idNivel: 20, nombre: 'PERDIEM ICU', tarifa: 967 },
                  { idNivel: 18, nombre: 'PERDIEM REGULAR', tarifa: 813 },
                  {
                    idNivel: 19,
                    nombre: 'PERDIEM SALA DE EMERGENCIA',
                    tarifa: 198,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        idCategoria: 13,
        nombre: 'ASES (VITAL) COMERCIAL',
        cantidadPlanes: 2,
        planes: [
          {
            idPlan: 1130,
            plan: 'MAPFRE',
            cantidadNiveles: 3,
            cantidadLocs: 1,
            locs: [
              {
                idLoc: 5,
                codigo: 'ACUTE',
                cantidadNiveles: 3,
                niveles: [
                  { idNivel: 20, nombre: 'PERDIEM ICU', tarifa: 740 },
                  { idNivel: 18, nombre: 'PERDIEM REGULAR', tarifa: 690 },
                  {
                    idNivel: 19,
                    nombre: 'PERDIEM SALA DE EMERGENCIA',
                    tarifa: 150,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  if (conTotales) {
    hospital['cantidadPlanes'] = 6;
    hospital['cantidadNiveles'] = 18;
  }

  return JSON.stringify({
    filtrosAplicados: {
      hospitales: ['Bayamon'],
      planes: 'Todos',
      loc: 'Todos',
    },
    hospitales: [hospital],
  });
}

// Borrador REAL que el modelo escribió en el chat (chat_id=372962298) y que
// el validador rechazó con "Cifras que no aparecen en los resultados de las
// herramientas: 6".
const DRAFT_MODELO =
  'Hospital Bayamon maneja 6 planes, todos en nivel ACUTE, con 3 niveles ' +
  'cada uno: <b>COMERCIAL</b> - IMC — PERDIEM ICU $967';

describe('esToolDeDatos', () => {
  it('cuenta las tools de catálogo y de datos como "consulta"', () => {
    expect(esToolDeDatos('obtener_planes_por_hospital_con_loc')).toBe(true);
    expect(esToolDeDatos('obtener_planes_disponibles')).toBe(true);
    expect(esToolDeDatos('obtener_hospitales_disponibles')).toBe(true);
    expect(esToolDeDatos('consultar_desempeno_medico')).toBe(true);
  });

  it('NO cuenta las tools de memoria', () => {
    expect(esToolDeDatos('guardar_memoria_usuario')).toBe(false);
    expect(esToolDeDatos('consultar_memoria_usuario')).toBe(false);
  });
});

describe('containsUnverifiedClaims · "¿cuántos planes maneja X?"', () => {
  const toolCalls = ['obtener_planes_por_hospital_con_loc'];

  it('ACEPTA el borrador cuando la API publica el total (cantidadPlanes)', () => {
    const r = containsUnverifiedClaims(
      DRAFT_MODELO,
      toolCalls,
      [payloadBayamon(true)],
      ['ok'],
    );
    expect(r.suspicious).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('RECHAZA el mismo borrador si el total NO viene publicado (bug original)', () => {
    const r = containsUnverifiedClaims(
      DRAFT_MODELO,
      toolCalls,
      [payloadBayamon(false)],
      ['ok'],
    );
    expect(r.suspicious).toBe(true);
    expect(r.reasons.join(' ')).toContain('6');
  });

  it('sigue rechazando una cifra INVENTADA (no publicada en el payload)', () => {
    const r = containsUnverifiedClaims(
      'Hospital Bayamon maneja 37 planes, todos en nivel ACUTE.',
      toolCalls,
      [payloadBayamon(true)],
      ['ok'],
    );
    expect(r.suspicious).toBe(true);
    expect(r.reasons.join(' ')).toContain('37');
  });
});
