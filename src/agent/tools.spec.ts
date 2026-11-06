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

describe('tools · resumen financiero por hospitales', () => {
  const tool = (TOOLS as unknown as ToolShape[]).find(
    (t) => t.name === 'consultar_resumen_financiero_hospitales',
  );

  it('filtra por RANGO de fechas, no por anio/meses/dia', () => {
    expect(tool).toBeDefined();
    expect(tool?.input_schema.properties).toHaveProperty('fechaInicio');
    expect(tool?.input_schema.properties).toHaveProperty('fechaFin');
    expect(tool?.input_schema.properties).not.toHaveProperty('anio');
    expect(tool?.input_schema.properties).not.toHaveProperty('meses');
    expect(tool?.input_schema.properties).not.toHaveProperty('dia');
  });
});
