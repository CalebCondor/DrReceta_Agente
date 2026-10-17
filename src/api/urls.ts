/*──────────────────────────────────────────────────────────────────────────
  ENDPOINTS DE LA API DE AUDITA (configurables vía env)

  La base de los endpoints se resuelve en tiempo de carga del módulo:
    - process.env.AUDITA_API_URL si está definida (recomendado)
    - default dev:  http://localhost:5146          (backend .NET local)

  Las URLs marcadas con `// export const` están DESHABILITADAS — la lógica
  del executor y las tools correspondientes también están comentadas. Sólo
  las 3 URLs de IaPreguntas (al final) están activas y listas para usar.

  Para re-habilitar una URL: descomenta la línea `export const`, ve al
  `executor.ts` y descomenta su `if (toolName === '...')`, y en `tools.ts`
  descomenta la definición de la tool correspondiente.
  ─────────────────────────────────────────────────────────────────────────*/

const AUDITA_API_URL: string =
  process.env.AUDITA_API_URL?.replace(/\/$/, '') ?? 'http://localhost:5146';

export const CONCEPTO_MAS_DIAS_DENEGADOS_URL = `${AUDITA_API_URL}/api/IaPreguntas/concepto-mas-dias-denegados`;
export const RESUMEN_FINANCIERO_HOSPITALES_URL = `${AUDITA_API_URL}/api/IaPreguntas/resumen-financiero-hospitales`;
export const DETERMINACION_ADVERSA_MAS_FRECUENTE_URL = `${AUDITA_API_URL}/api/IaPreguntas/determinacion-adversa-mas-frecuente`;
export const PLANES_DISPONIBLES_URL = `${AUDITA_API_URL}/api/planes/dropdown`;
export const HOSPITALES_DISPONIBLES_URL = `${AUDITA_API_URL}/api/hospitales/activos`;
export const MONTOS_ESTADO = `${AUDITA_API_URL}/api/IaPreguntas/montos-por-estado`;
export const DETERMINACION_ADVERSA_MONTO_URL = `${AUDITA_API_URL}/api/IaPreguntas/determinacion-adversa-monto`;
export const PLANES_POR_HOSPITAL_CON_LOC_URL = `${AUDITA_API_URL}/api/IaPreguntas/planes-por-hospital-con-loc`;
