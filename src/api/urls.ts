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

// --- Desempeño de médicos ---
// Devuelve KPIs por médico (días denegados/aprobados/recuperados, montos, etc.)
// en un período + planes + loc + médico específicos.
// `idMedicoAlta` se pasa como filtro por ID. Si no se da, el backend devuelve el
// catálogo de médicos (útil para mapear nombre → ID).
export const DESEMPENO_MEDICO_URL = `${AUDITA_API_URL}/api/IaPreguntas/desempeno-medico`;

// --- Determinación adversa más frecuente para un médico de alta ---
// Devuelve el/los concepto(s) de determinación adversa que más se repiten en
// las auditorías asociadas al médico de alta del paciente (idMedicoAlta).
export const DETERMINACION_ADVERSA_MEDICO_ALTA_URL = `${AUDITA_API_URL}/api/IaPreguntas/determinacion-adversa-medico-alta`;

// --- Desempeño de manejadores de caso ---
// Mismo contrato que `desempeno-medico`, pero la métrica viene agrupada por
// `idManejadorCaso` (la persona que gestiona el caso del paciente, no quien
// firma el alta). Si no se pasa `idManejadorCaso`, devuelve el catálogo
// de manejadores disponibles bajo los filtros.
export const DESEMPENO_MANEJADOR_CASO_URL = `${AUDITA_API_URL}/api/IaPreguntas/desempeno-manejador-caso`;

// --- Determinación adversa más frecuente para un manejador de caso ---
// Equivalente a `determinacion-adversa-medico-alta` pero filtrando por el
// `idManejadorCaso`. Este endpoint SÍ requiere el ID explícito (no es
// catálogo).
export const DETERMINACION_ADVERSA_MANEJADOR_CASO_URL = `${AUDITA_API_URL}/api/IaPreguntas/determinacion-adversa-manejador-caso`;

// --- Facturación agregada por manejador de caso a través de hospitales ---
// Devuelve cuánto dinero se facturó / perdió / recuperó POR MANEJADOR en el
// período y filtros seleccionados. NO depende de un ID pivote: siempre
// devuelve el desglose completo (un manejador por fila). Útil para responder
// "¿quién es el manejador que más dinero perdió?" ordenando el resultado
// localmente.
export const FACTURACION_MANEJADOR_HOSPITALES_URL = `${AUDITA_API_URL}/api/IaPreguntas/facturacion-manejador-hospitales-montos`;

// --- Facturación agregada por auditor a través de hospitales ---
// Equivalente a `FACTURACION_MANEJADOR_HOSPITALES_URL`, pero el desglose
// viene agrupado por AUDITOR (la persona que firma/revisa la auditoría) en
// lugar de por manejador de caso. Mismos filtros (anio, meses, idHospitales,
// idPlanes, loc). NO depende de un ID pivote: devuelve el agregado completo
// (un auditor por fila).
export const FACTURACION_AUDITOR_HOSPITALES_URL = `${AUDITA_API_URL}/api/IaPreguntas/facturacion-auditor-hospitales-montos`;

// --- Desempeño de auditores ---
// Análogo a `desempeno-medico` / `desempeno-manejador-caso`, pero agrupado
// por AUDITOR (la persona que firma/revisa la auditoría). Si no se pasa
// `idAuditor`, el endpoint devuelve el catálogo de auditores bajo los filtros.
export const DESEMPENO_AUDITOR_URL = `${AUDITA_API_URL}/api/IaPreguntas/desempeno-auditor`;

// --- Determinación adversa más frecuente para un auditor ---
// Equivalente a `determinacion-adversa-medico-alta`, pero filtrando por
// `idAuditor`. El endpoint NO devuelve catálogo: requiere el ID explícito.
export const DETERMINACION_ADVERSA_AUDITOR_URL = `${AUDITA_API_URL}/api/IaPreguntas/determinacion-adversa-auditor`;
