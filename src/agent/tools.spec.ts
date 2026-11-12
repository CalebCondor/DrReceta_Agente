import { TOOLS } from './tools';

// Forma local del schema: no depende de los tipos del SDK de Anthropic.
type ToolShape = {
  name: string;
  input_schema: {
    required?: string[];
    properties?: Record<string, unknown>;
  };
};

describe('tools · consultacion de determinación adversa por auditor', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_determinacion_adversa_auditor',
  );

  it('declara idHospitales como requerido (el backend responde 400 sin él)', () => {
    expect(tool).toBeDefined();
    expect(tool?.input_schema.required).toContain('idHospitales');
    expect(tool?.input_schema.properties).toHaveProperty('idHospitales');
  });
});

describe.each([
  'consultar_resumen_financiero_hospitales',
  'consultar_montos_por_estado',
  'consultar_determinacion_adversa_mas_frecuente',
  'consultar_determinacion_adversa_monto',
  'consultar_desempeno_medico',
  'consultar_desempeno_auditor',
  'consultar_determinacion_adversa_auditor',
  'consultar_facturacion_auditor_hospitales',
  'consultar_desempeno_manejador_caso',
  'consultar_facturacion_manejador_hospitales',
])('tools · %s', (toolName) => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === toolName,
  );

  it('filtra por RANGO de fechas, no por anio/meses/dia', () => {
    expect(tool).toBeDefined();
    expect(tool?.input_schema.properties).toHaveProperty('fechaInicio');
    expect(tool?.input_schema.properties).toHaveProperty('fechaFin');
    expect(tool?.input_schema.properties).not.toHaveProperty('anio');
    expect(tool?.input_schema.properties).not.toHaveProperty('meses');
    expect(tool?.input_schema.properties).not.toHaveProperty('dia');
  });

  it('NO exige `anio` (el backend filtra por rango)', () => {
    expect(tool?.input_schema.required).not.toContain('anio');
    expect(tool?.input_schema.required).toContain('idHospitales');
  });
});

describe('tools · consultar_determinacion_adversa_manejador_caso', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_determinacion_adversa_manejador_caso',
  );

  it('filtra por RANGO de fechas, no por anio/meses/dia', () => {
    expect(tool).toBeDefined();
    expect(tool?.input_schema.properties).toHaveProperty('fechaInicio');
    expect(tool?.input_schema.properties).toHaveProperty('fechaFin');
    expect(tool?.input_schema.properties).not.toHaveProperty('anio');
    expect(tool?.input_schema.properties).not.toHaveProperty('meses');
    expect(tool?.input_schema.properties).not.toHaveProperty('dia');
  });

  it('exige `idManejadorCaso` y NO `anio`', () => {
    expect(tool?.input_schema.required).toContain('idManejadorCaso');
    expect(tool?.input_schema.required).not.toContain('anio');
  });
});

describe('tools · consultar_determinacion_adversa_medico_alta', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_determinacion_adversa_medico_alta',
  );

  it('filtra por RANGO de fechas, no por anio/meses/dia', () => {
    expect(tool).toBeDefined();
    expect(tool?.input_schema.properties).toHaveProperty('fechaInicio');
    expect(tool?.input_schema.properties).toHaveProperty('fechaFin');
    expect(tool?.input_schema.properties).not.toHaveProperty('anio');
    expect(tool?.input_schema.properties).not.toHaveProperty('meses');
    expect(tool?.input_schema.properties).not.toHaveProperty('dia');
  });

  it('exige `idMedicoAlta` y NO `anio`', () => {
    expect(tool?.input_schema.required).toContain('idMedicoAlta');
    expect(tool?.input_schema.required).not.toContain('anio');
  });
});

describe('tools · consultar_determinacion_adversa_monto_consolidado', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_determinacion_adversa_monto_consolidado',
  );

  it('filtra por RANGO de fechas, no por anio/meses/dia', () => {
    expect(tool).toBeDefined();
    expect(tool?.input_schema.properties).toHaveProperty('fechaInicio');
    expect(tool?.input_schema.properties).toHaveProperty('fechaFin');
    expect(tool?.input_schema.properties).not.toHaveProperty('anio');
    expect(tool?.input_schema.properties).not.toHaveProperty('meses');
    expect(tool?.input_schema.properties).not.toHaveProperty('dia');
  });

  it('NO exige `anio` ni `idHospitales` (admite `global: true`)', () => {
    expect(tool?.input_schema.required).not.toContain('anio');
    expect(tool?.input_schema.required).not.toContain('idHospitales');
    expect(tool?.input_schema.properties).toHaveProperty('global');
  });
});

describe('tools · consultar_desempeno_medico · agruparPor', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_desempeno_medico',
  );

  type AgruparPorProp = { type: string; enum: number[]; description: string };

  const agruparPor = () =>
    (tool?.input_schema.properties?.['agruparPor'] ?? undefined) as
      | AgruparPorProp
      | undefined;

  it('declara `agruparPor` con los valores 1 y 2', () => {
    expect(agruparPor()).toBeDefined();
    expect(agruparPor()?.type).toBe('integer');
    expect(agruparPor()?.enum).toEqual([1, 2]);
  });

  it('NO lo exige (es opcional: si se omite, el backend usa el modo 1)', () => {
    expect(tool?.input_schema.required).not.toContain('agruparPor');
  });

  it('la descripción dice QUÉ modo es cuál y cuándo usar cada uno', () => {
    const d = agruparPor()?.description ?? '';
    // 1 = por hospital (y es el default si se omite)
    expect(d).toContain('POR HOSPITAL');
    expect(d).toContain('OMITES');
    // 2 = por médico
    expect(d).toContain('POR MÉDICO');
    // las dos jerarquías, para que la IA sepa dónde leer los datos
    expect(d).toContain('hospitales[]');
    expect(d).toContain('medicos[]');
    expect(d).toContain('planes[]');
  });
});

describe('tools · consultar_desempeno_manejador_caso · agruparPor', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_desempeno_manejador_caso',
  );

  type AgruparPorProp = { type: string; enum: number[]; description: string };

  const agruparPor = () =>
    (tool?.input_schema.properties?.['agruparPor'] ?? undefined) as
      | AgruparPorProp
      | undefined;

  it('declara `agruparPor` con los valores 1, 2 y 3', () => {
    expect(agruparPor()).toBeDefined();
    expect(agruparPor()?.type).toBe('integer');
    expect(agruparPor()?.enum).toEqual([1, 2, 3]);
  });

  it('NO lo exige (es opcional: si se omite, el backend usa el modo 1)', () => {
    expect(tool?.input_schema.required).not.toContain('agruparPor');
  });

  it('la descripción dice QUÉ modo es cuál y cuándo usar cada uno', () => {
    const d = agruparPor()?.description ?? '';
    // 1 = por hospital (y es el default si se omite)
    expect(d).toContain('POR HOSPITAL');
    expect(d).toContain('OMITES');
    // 2 = por manejador de caso
    expect(d).toContain('POR MANEJADOR DE CASO');
    // 3 = por plan médico
    expect(d).toContain('POR PLAN MÉDICO');
    // las tres jerarquías, para que la IA sepa dónde leer los datos
    expect(d).toContain('manejadores[]');
    expect(d).toContain('hospitales[]');
    expect(d).toContain('planes[]');
  });

  it('la descripción de la tool explica los TRES modos', () => {
    const d = (tool as unknown as { description: string } | undefined)
      ?.description;
    expect(d).toContain('agruparPor');
    expect(d).toContain('POR HOSPITAL');
    expect(d).toContain('POR MANEJADOR DE CASO');
    expect(d).toContain('POR PLAN MÉDICO');
  });
});

describe('tools · consultar_desempeno_auditor · agruparPor', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_desempeno_auditor',
  );

  type AgruparPorProp = { type: string; enum: number[]; description: string };

  const agruparPor = () =>
    (tool?.input_schema.properties?.['agruparPor'] ?? undefined) as
      | AgruparPorProp
      | undefined;

  it('declara `agruparPor` con los valores 1 y 2', () => {
    expect(agruparPor()).toBeDefined();
    expect(agruparPor()?.type).toBe('integer');
    expect(agruparPor()?.enum).toEqual([1, 2]);
  });

  it('NO lo exige (es opcional: si se omite, el backend usa el modo 1)', () => {
    expect(tool?.input_schema.required).not.toContain('agruparPor');
  });

  it('la descripción dice QUÉ modo es cuál y cuándo usar cada uno', () => {
    const d = agruparPor()?.description ?? '';
    // 1 = por hospital (y es el default si se omite)
    expect(d).toContain('POR HOSPITAL');
    expect(d).toContain('OMITES');
    // 2 = por auditor
    expect(d).toContain('POR AUDITOR');
    // las dos jerarquías, para que la IA sepa dónde leer los datos
    expect(d).toContain('hospitales[]');
    expect(d).toContain('auditores[]');
    expect(d).toContain('planes[]');
  });

  it('la descripción de la tool explica los DOS modos', () => {
    const d = (tool as unknown as { description: string } | undefined)
      ?.description;
    expect(d).toContain('agruparPor');
    expect(d).toContain('POR HOSPITAL');
    expect(d).toContain('POR AUDITOR');
  });
});

describe('tools · consultar_determinacion_adversa_auditor · agruparPor', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_determinacion_adversa_auditor',
  );

  type AgruparPorProp = { type: string; enum: number[]; description: string };

  const agruparPor = () =>
    (tool?.input_schema.properties?.['agruparPor'] ?? undefined) as
      | AgruparPorProp
      | undefined;

  it('declara `agruparPor` con los valores 1, 2, 3 y 4', () => {
    expect(agruparPor()).toBeDefined();
    expect(agruparPor()?.type).toBe('integer');
    expect(agruparPor()?.enum).toEqual([1, 2, 3, 4]);
  });

  it('NO lo exige (es opcional: si se omite, el backend usa el modo 1)', () => {
    expect(tool?.input_schema.required).not.toContain('agruparPor');
  });

  it('la descripción dice QUÉ modo es cuál y cuándo usar cada uno', () => {
    const d = agruparPor()?.description ?? '';
    // 1 = general (y es el default si se omite)
    expect(d).toContain('GENERAL');
    expect(d).toContain('OMITES');
    // 2 = por plan médico
    expect(d).toContain('POR PLAN MÉDICO');
    // 3 = por hospital
    expect(d).toContain('POR HOSPITAL');
    // 4 = por plan y hospital
    expect(d).toContain('POR PLAN Y HOSPITAL');
  });

  it('la descripción de la tool explica los CUATRO modos', () => {
    const d = (tool as unknown as { description: string } | undefined)
      ?.description;
    expect(d).toContain('agruparPor');
    expect(d).toContain('GENERAL');
    expect(d).toContain('POR PLAN MÉDICO');
    expect(d).toContain('POR HOSPITAL');
    expect(d).toContain('POR PLAN Y HOSPITAL');
  });

  it('dice que las hojas (determinaciones) NO tienen `totales` ni casos/LOS', () => {
    const d =
      (tool as unknown as { description: string } | undefined)?.description ??
      '';
    expect(d).toContain('determinacion');
    expect(d).toContain('SOLO `diasDenegados`');
    expect(d).toContain('NO tienen `totales`');
    // La categoría viaja como atributo, no como un nivel.
    expect(d).toContain('tipoCategoria');
  });

  it('explica que los porcentajes de cada nodo se miden contra su PADRE', () => {
    const d =
      (tool as unknown as { description: string } | undefined)?.description ??
      '';
    expect(d).toContain('PADRE');
    expect(d).toContain('porcentajeMontoPerdidoVsTotalMontoPerdido');
    expect(d).toContain('porcentajeDiasDenegadosVsLos');
    // En el modo 2 el denominador es lo perdido EN ESE PLAN.
    expect(d).toContain('EN ESE PLAN');
  });
});
