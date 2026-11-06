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
