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

const AUDITA_API_URL: string = (
  process.env.AUDITA_API_URL?.replace(/\/$/, "") ??
  'http://localhost:5146'
);

// export const LOGIN_URL = 'https://api.tulicenciapr.com:2053/api/login.php';
// export const VERIFICAR_REGISTRAR_URL =
//   'https://api.tulicenciapr.com:2053/api/Ia/verificar-o-registrar-usuario';
// export const PERFIL_URL = 'https://api.tulicenciapr.com:2053/api/perfil.php';
// export const MIS_ORDENES_URL =
//   'https://api.tulicenciapr.com:2053/api/mis_ordenes.php';
// export const MIS_PAGOS_URL =
//   'https://api.tulicenciapr.com:2053/api/mis_pagos.php';
// export const TODOS_LOS_TRAMITES_URL =
//   'https://api.tulicenciapr.com:2053/api/Ia/listaTodosTramite';
// export const SELLOS_POR_TRAMITE_URL =
//   'https://api.tulicenciapr.com:2053/api/Sello/Tramite/{id}';
// export const PRODUCTOS_BASE_URL = 'https://drreceta.com/es';
// export const CREAR_COMPRA_URL =
//   'https://api.tulicenciapr.com:2053/api/Pago/inicioPagoIa';
// export const VERIFICAR_CODIGO_URL =
//   'https://api.tulicenciapr.com:2053/api/Ia/verificar-codigo';

/*ENDPOINTS PARA EJECUTAR TRAMITES EXPRESS*/
// export const INICIO_TRAMITE_EXPRESS =
//   'https://api.tulicenciapr.com:2053/api/Pagoadicional/InicioTramiteExpressIA';

/*ENDPOINTS AUXILIARES — necesarios como prerrequisito de IaPreguntas */
// Catálogo de planes médicos (dropdown). DEBE consultarse antes de cualquier
// tool de IaPreguntas para que el modelo pueda mapear los nombres de planes
// mencionados por el usuario a sus IDs (y para responder si el usuario
// pregunta qué planes hay).
export const PLANES_DISPONIBLES_URL = `${AUDITA_API_URL}/api/planes/dropdown`;

/*ENDPOINTS DE PREGUNTAS IA (catálogo IaPreguntas) — ACTIVOS */
// Resumen financiero de hospitales: responde "¿Cuántos días se han
// denegado / aprobado / recuperado en (fecha)?". Suma Finanzas.aprobado,
// Finanzas.denegado y Finanzas.recuperado por hospital y, opcionalmente,
// por plan. Body: { anio, meses?, idHospitales, idPlanes? }.
export const RESUMEN_FINANCIERO_HOSPITALES_URL =
  `${AUDITA_API_URL}/api/IaPreguntas/resumen-financiero-hospitales`;

// Determinación adversa más frecuente: ranking de conceptos de
// AuditoriaConceptos por hospital. Dos vistas: items[] (flat, top-N
// por hospital) e itemsPorPlan[] (nested top-N por (hospital, plan),
// sólo si idPlanes viene poblado). Query ?top=N (default 5).
export const DETERMINACION_ADVERSA_MAS_FRECUENTE_URL =
  `${AUDITA_API_URL}/api/IaPreguntas/determinacion-adversa-mas-frecuente`;

// Concepto que más días denegados genera. Igual estructura que el
// anterior pero el ranking es por totalDiasDenegados desc (no por
// cantidad). Expone masDiasDenegadosGlobal, porHospital[] e
// itemsPorPlan[]. Query ?top=N (default 10).
export const CONCEPTO_MAS_DIAS_DENEGADOS_URL =
  `${AUDITA_API_URL}/api/IaPreguntas/concepto-mas-dias-denegados`;