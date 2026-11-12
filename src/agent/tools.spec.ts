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
