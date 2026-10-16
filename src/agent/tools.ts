// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'obtener_planes_disponibles',
    description:
      'OBLIGATORIO usar esta herramienta cuando el usuario pregunta por el catálogo / listado / ' +
      'los planes médicos disponibles (ej.: "¿qué planes hay?", "¿cuáles son los planes?", ' +
      '"dame el listado de planes", "qué planes médicos existen"). NO digas que no existe esa ' +
      'herramienta — sí existe y debes llamarla.\n\n' +
      'Devuelve el catálogo COMPLETO de planes médicos (id + nombre), incluyendo planes con y ' +
      'sin actividad registrada. Es un endpoint público — NO requiere autenticación y NO ' +
      'debes pedir correo ni código antes de llamarla.\n\n' +
      'ADEMÁS es prerrequisito de las tools de datos:\n' +
      '  • Si después vas a llamar `consultar_resumen_financiero_hospitales`, ' +
      '`consultar_determinacion_adversa_mas_frecuente`, `consultar_concepto_mas_dias_denegados` ' +
      'o `consultar_montos_por_estado` con filtro por plan, llama primero a esta tool ' +
      'para mapear el nombre del plan al `idPlan`.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores — el ' +
      'catálogo puede cambiar entre sesiones.\n\n' +
      'FORMATO DE RESPUESTA: el endpoint devuelve un array JSON. Cada elemento trae `id` (number) y ' +
      '`label` (string). Ejemplo real: `[{id: 1117, label: "ACAA"}, {id: 1123, label: "MCS Comercial"}]`. ' +
      'Al listar los planes al usuario, muestra SOLO el `label` (el nombre) un plan por línea, ' +
      'SIN mencionar ni mostrar el `id`. Ejemplo de respuesta correcta: ' +
      '"Los planes disponibles son:\n- ACAA\n- AUXILIO MUTUO\n- Blue Triple S Comercial". ' +
      'El `id` es interno — no lo expongas en la respuesta al usuario a menos que él ' +
      'explícitamente lo pida. Si el usuario pregunta por un plan específico por nombre, ' +
      'búscalo en esta lista por el campo `label`. NO uses campos como `idPlan` o `plan` — ' +
      'el backend usa `id` y `label`.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  {
    name: 'obtener_hospitales_disponibles',
    description:
      'OBLIGATORIO usar esta herramienta cuando el usuario pregunta por el catálogo / listado / ' +
      'los hospitales activos disponibles (ej.: "¿qué hospitales hay?", "¿cuáles son los ' +
      'hospitales?", "dame el listado de hospitales", "qué hospitales activos existen"). ' +
      'NO digas que no existe esa herramienta — sí existe y debes llamarla.\n\n' +
      'Devuelve el catálogo COMPLETO de hospitales ACTIVOS (con actividad registrada). Es un ' +
      'endpoint público — NO requiere autenticación y NO debes pedir correo ni código antes de ' +
      'llamarla.\n\n' +
      'ADEMÁS es prerrequisito de las tools de datos:\n' +
      '  • Si después vas a llamar `consultar_resumen_financiero_hospitales`, ' +
      '`consultar_determinacion_adversa_mas_frecuente`, `consultar_concepto_mas_dias_denegados` ' +
      'o `consultar_montos_por_estado`, necesitas el `idHospital` de cada hospital. ' +
      'Llama primero a esta tool para mapear el nombre al `idHospital`.\n' +
      '  • NUNCA inventes `idHospitales` ni uses IDs memorizados de conversaciones anteriores — ' +
      'el catálogo puede cambiar entre sesiones. El mapeo nombre → `idHospital` lo haces con ' +
      'el campo `hosId` que devuelve esta tool.\n\n' +
      'FORMATO DE RESPUESTA: el endpoint devuelve un array JSON. Cada elemento trae `hosId` (number) y ' +
      '`hosNombre` (string). Ejemplo real: `[{hosId: 1, hosNombre: "Hospital Central"}, {hosId: 6, hosNombre: "Hospital San Lucas"}]`. ' +
      'Al listar los hospitales al usuario, muestra SOLO el `hosNombre` (el nombre) un hospital por línea, ' +
      'SIN mencionar ni mostrar el `hosId`. Ejemplo de respuesta correcta: ' +
      '"Los hospitales activos son:\n- Centro Medico del Caribe\n- Centro Medico del Noreste\n- Hospital Central". ' +
      'El `hosId` es interno — no lo expongas en la respuesta al usuario a menos que él ' +
      'explícitamente lo pida. Si el usuario pregunta por un hospital específico por nombre, ' +
      'búscalo en esta lista por el campo `hosNombre`. NOTA: este endpoint usa `hosId`/`hosNombre` ' +
      '(NO `id`/`label` como el de planes).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  /*──────────────────────────────────────────────────────────────────────────
    ANALÍTICAS / REPORTES — Catálogo IaPreguntas (ACTIVAS)

    REGLA COMÚN: Antes de invocar cualquiera de estas 4 tools, el modelo
    DEBE haber llamado antes a `obtener_planes_disponibles` para tener el
    catálogo actualizado de planes (ids + nombres) y poder mapear
    correctamente los nombres que mencione el usuario a sus IDs.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_resumen_financiero_hospitales',
    description:
      'Responde la pregunta de prioridad alta del catálogo: ' +
      '"¿Cuántos días se han denegado / aprobado / recuperado en (fecha)?".\n\n' +
      'Suma los campos Finanzas.aprobado, Finanzas.denegado y Finanzas.recuperado ' +
      'de las auditorías del período y devuelve:\n' +
      '  • Totales globales (rolled-up a través de los hospitales consultados).\n' +
      '  • Desglose por hospital en `porHospital[]` (siempre poblado).\n' +
      '  • Si se envía `idPlanes`, cada hospital incluye además `planes[]` con los totales ' +
      'por plan (sólo planes con datos — los planes pedidos sin actividad NO aparecen).\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_planes_disponibles` ' +
      'para tener el catálogo actualizado de planes (ids + nombres). Sin ese catálogo en ' +
      'contexto, NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), usa esa ' +
      'tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por totales de días aprobados, denegados o ' +
      'recuperados en un período específico ("días denegados", "días aprobados", ' +
      '"auditorías aprobadas/denegadas", "resumen financiero", etc.).\n' +
      '  • Todos los `totalX` son enteros (días, NO dinero).\n' +
      '  • Sin `idPlanes`: `porHospital[].planes = null`. Con `idPlanes`: `planes[]` se ordena ' +
      'por `totalDenegado desc, idPlan asc`.\n' +
      '  • El filtro de plan va por la cadena `Auditorias.IdPlanNivel → PlanNivel.PnlPlanId → ' +
      'Planes.IdPlanes`. Auditorías sin plan quedan EXCLUIDAS cuando se envía `idPlanes`.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). Si el usuario solo dice "mis hospitales", ' +
      'usa el listado derivado de las herramientas de perfil/permisos.\n' +
      '  • `idPlanes`: int[] opcional. ANTES de usarlo, llama a `obtener_planes_disponibles` ' +
      'para obtener los IDs válidos. Si el usuario menciona un plan por nombre, esa tool te ' +
      'devuelve el `idPlan` correspondiente. Si NO envías `idPlanes`, OMITE el campo ' +
      '(no envíes array vacío).\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por hospital/plan, con valores separados por comas o espacios). ' +
      'NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas para presentar ' +
      'datos. Aunque tengas varias entidades que comparar (`porHospital[]`, `planes[]`), NO ' +
      'las pongas en un bloque con columnas; usa SIEMPRE una lista con guion, una línea por ' +
      'entidad.\n\n' +
      'PRINCIPIO DE MINIMIZACIÓN (CRÍTICO): muestra SOLO las métricas que el usuario pidió en su mensaje. ' +
      'Si pidió "días denegados y %", devuelve "- Días denegados: 133\\n- % denegado: 41.6%" — NUNCA ' +
      'incluyas "Días aprobados: 187", "Días recuperados: 3", ni el desglose "(133 ÷ 320)" a menos que ' +
      'el usuario los pida explícitamente. Ignora los campos extra que devuelva la tool. Si la tool ' +
      'trae aprobados/denegados/recuperados y el usuario solo pidió denegados, devuelve SOLO denegados.',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año. ' +
            'Ej: [1, 2, 4] = enero, febrero y abril.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description:
            'IDs de hospitales a incluir (al menos uno). Ej: [1, 2, 5].',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Ej: [1127, 1123]. ' +
            'Si se omite, no se aplica filtro por plan. Cuando se envía, las auditorías ' +
            'sin plan asociado quedan excluidas.',
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_mas_frecuente',
    description:
      'Responde: "¿Cuál es la determinación adversa más frecuente?".\n\n' +
      'Devuelve un ranking de las determinaciones adversas (tabla AuditoriaConceptos) más ' +
      'aplicadas en el período, agrupadas por hospital.\n\n' +
      'VISTAS DEVUELTAS:\n' +
      '  • `items[]` (FLAT, siempre poblado) — top-N por (hospital, concepto). ' +
      '`cantidad` y `totalDiasDenegados` rolled-up a través de los planes cuando hay filtro.\n' +
      '  • `itemsPorPlan[]` (NESTED, sólo si `idPlanes` viene poblado) — top-N conceptos ' +
      'dentro de cada (hospital, plan).\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_planes_disponibles` ' +
      'para tener el catálogo actualizado de planes (ids + nombres). Sin ese catálogo en ' +
      'contexto, NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), usa esa ' +
      'tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por la "determinación adversa más frecuente", ' +
      '"concepto más común", "lo que más se deniega por concepto", "ranking por cantidad", ' +
      'o similares donde la métrica principal es la FRECUENCIA.\n' +
      '  • Si el usuario pregunta por DÍAS DENEGADOS (no cantidad), usa ' +
      '`consultar_concepto_mas_dias_denegados` en su lugar — son métricas distintas.\n\n' +
      'MÉTRICAS:\n' +
      '  • `cantidad` = filas en AuditoriaConceptos (registros administrativos).\n' +
      '  • `totalDiasDenegados` = suma de `dias_denegados` de esas filas.\n\n' +
      'RANKINGS:\n' +
      '  • `items[]`: top-N por hospital (default API = 5).\n' +
      '  • `itemsPorPlan[plan].conceptos`: `cantidad desc, totalDiasDenegados desc` (desempate).\n' +
      '  • Planes pedidos sin actividad NO aparecen en `itemsPorPlan`.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). Si el usuario solo dice "mis hospitales", ' +
      'usa el listado derivado de las herramientas de perfil/permisos.\n' +
      '  • `idPlanes`: int[] opcional. ANTES de usarlo, llama a `obtener_planes_disponibles` ' +
      'para obtener los IDs válidos. Si el usuario menciona un plan por nombre, esa tool te ' +
      'devuelve el `idPlan` correspondiente. Si NO envías `idPlanes`, OMITE el campo ' +
      '(no envíes array vacío) y `itemsPorPlan` vendrá `null`.\n' +
      '  • `top`: int opcional. Top-N por hospital en `items[]` y por (hospital, plan) en ' +
      '`itemsPorPlan[].conceptos[]`. Si se omite, la API usa 5. Rango recomendado: 1–20.\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion para presentar el ranking (una línea por concepto, con sus valores separados por ' +
      'comas o espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas. ' +
      'Aunque tengas varias entradas (`items[]` o `itemsPorPlan[]`), NO las pongas en un bloque ' +
      'con columnas; usa SIEMPRE una lista con guion. Ejemplo correcto: "- Hospital San Lucas — ' +
      'concepto "Criterio de Alta", cantidad 25, días denegados 87."; si hay varias, una línea por ' +
      'concepto. Si agrupas por plan, una sección por plan (encabezado en <b>) y dentro la lista con guion.',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año. ' +
            'Ej: [1, 2, 4] = enero, febrero y abril.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description:
            'IDs de hospitales a incluir (al menos uno). Ej: [1, 2, 5].',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Ej: [1127, 1123]. ' +
            'Si se omite, no se aplica filtro por plan y `itemsPorPlan = null`. ' +
            'Cuando se envía, se incluyen ambas vistas (items[] flat + itemsPorPlan[] nested) ' +
            'y se devuelven sólo los planes con actividad. ' +
            'ANTES de usar este parámetro, llama a `obtener_planes_disponibles` para ' +
            'obtener los IDs válidos (y mapear nombres a IDs si el usuario mencionó un plan).',
        },
        top: {
          type: 'integer',
          description:
            'Top-N por hospital (en `items[]`) o por (hospital, plan) (en `itemsPorPlan[].conceptos[]`). ' +
            'Si se omite, la API usa 5. Rango recomendado: 1–20.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_concepto_mas_dias_denegados',
    description:
      'Responde: "¿Qué concepto / determinación genera más días denegados?".\n\n' +
      'DIFERENCIA CLAVE con `consultar_determinacion_adversa_mas_frecuente`: acá el ranking es ' +
      'por `totalDiasDenegados desc` (NO por cantidad).\n\n' +
      'BLOQUES DEL RESPONSE:\n' +
      '  • `masDiasDenegadosGlobal` — concepto ganador absoluto (sumando todos los hospitales ' +
      'y planes). Solo expone `idConcepto`, `concepto` y `totalDiasDenegados` — ' +
      'INTENCIONALMENTE NO incluye `cantidad` (es la métrica principal, sin ruido).\n' +
      '  • `porHospital[]` — top-N conceptos por hospital (rolled-up si hay filtro de plan).\n' +
      '  • `itemsPorPlan[]` — sólo cuando hay `idPlanes`, agrupa por (hospital, plan) con top-N ' +
      'conceptos dentro.\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_planes_disponibles` ' +
      'para tener el catálogo actualizado de planes (ids + nombres). Sin ese catálogo en ' +
      'contexto, NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), usa esa ' +
      'tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por "qué concepto genera más días denegados", ' +
      '"lo que más días denegados produce", "ranking por días denegados", o similares donde ' +
      'la métrica principal son los DÍAS.\n' +
      '  • Si el usuario pregunta por FRECUENCIA/CANTIDAD (no días), usa ' +
      '`consultar_determinacion_adversa_mas_frecuente` en su lugar.\n\n' +
      'RANKINGS:\n' +
      '  • `porHospital[]`: top-N conceptos por hospital (default API = 10).\n' +
      '  • `itemsPorPlan[plan].conceptos`: `totalDiasDenegados desc, cantidad desc` (desempate).\n' +
      '  • `cantidad` se calcula internamente y se usa como tie-breaker — sólo NO se serializa ' +
      'en `masDiasDenegadosGlobal`.\n' +
      '  • Planes pedidos sin actividad NO aparecen en `itemsPorPlan`.\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion para presentar el ranking (una línea por concepto, con sus valores separados por ' +
      'comas o espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas. ' +
      'Aunque tengas varias entradas (`porHospital[]` o `itemsPorPlan[]`), NO las pongas en un ' +
      'bloque con columnas; usa SIEMPRE una lista con guion. Ejemplo correcto: "- Hospital San ' +
      'Lucas — concepto "Criterio de Alta", total días denegados 87."; si hay varias, una línea ' +
      'por concepto. El ganador absoluto (`masDiasDenegadosGlobal`) va primero con su cifra en ' +
      '<b>. Si agrupas por plan, una sección por plan (encabezado en <b>) y dentro la lista con guion.',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite, se asumen los 12 meses del año.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description: 'IDs de hospitales a incluir (al menos uno).',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Si se omite, `itemsPorPlan = null`. ' +
            'ANTES de usar este parámetro, llama a `obtener_planes_disponibles` para ' +
            'obtener los IDs válidos (y mapear nombres a IDs si el usuario mencionó un plan).',
        },
        top: {
          type: 'integer',
          description:
            'Top-N por hospital (en `porHospital[]`) o por (hospital, plan) (en `itemsPorPlan[].conceptos[]`). ' +
            'Si se omite, la API usa 10. Rango recomendado: 1–20.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_montos_por_estado',
    description:
      'Responde: "¿Cuánto se aprobó / denegó / recuperó en dinero por estado?"\n\n' +
      'Devuelve montos agregados por estado (Approved / Denied / Recovered / etc.) en el ' +
      'período, agrupados por hospital. A diferencia de `consultar_resumen_financiero_hospitales` ' +
      '(que devuelve DÍAS), esta herramienta devuelve MONTOS ($) en moneda local.\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_hospitales_disponibles` ' +
      'para tener el catálogo actualizado de hospitales (hosId + hosNombre) y poder mapear ' +
      'correctamente los nombres que mencione el usuario a sus IDs.\n' +
      '  • Si el usuario menciona un hospital por nombre ("Hospital San Lucas"), usa esa ' +
      'tool para mapear el nombre al `hosId` correspondiente.\n' +
      '  • NUNCA inventes `idHospitales` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      '  • Si vas a usar `idPlanes`, también llama antes a `obtener_planes_disponibles` para ' +
      'mapear nombres de planes a `idPlan`.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por "montos por estado", "cuánto se aprobó en dinero", ' +
      '"cuánto se denegó ($)", "montos aprobados / denegados / recuperados", "facturación por ' +
      'estado", o similares donde se habla de PLATA/MONTOS (no días).\n' +
      '  • Si el usuario pregunta por DÍAS, usa `consultar_resumen_financiero_hospitales`.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite, se asumen los 12 meses del año. ' +
      'El usuario puede pedir explícitamente "todos los meses" → omite el campo.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). ANTES de usarlo, llama a ' +
      '`obtener_hospitales_disponibles` para obtener los IDs válidos. Si el usuario menciona ' +
      'un hospital por nombre, esa tool te devuelve el `hosId` correspondiente.\n' +
      '  • `idPlanes`: int[] opcional. Si el usuario filtra por plan, llama antes a ' +
      '`obtener_planes_disponibles` para mapear. Si NO filtra por plan, OMITE el campo.\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion (una línea por hospital, con sus montos separados por comas). NUNCA uses <pre>, ' +
      '<table>, <ul>, <li>, <br>, ni columnas alineadas. Aunque tengas varios hospitales, ' +
      'NO los pongas en un bloque con columnas; usa SIEMPRE una lista con guion. Ejemplo: ' +
      '"- Hospital San Lucas — aprobado $12,500, denegado $3,200, recuperado $0". Si los ' +
      'montos vienen agregados, una sola línea con el total.',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite, se asumen los 12 meses del año. ' +
            'Ej: [1, 2, 4] = enero, febrero y abril.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description:
            'IDs de hospitales a incluir (al menos uno). Ej: [5]. ' +
            'ANTES de usar este parámetro, llama a `obtener_hospitales_disponibles` ' +
            'para mapear el nombre del hospital al `hosId` correspondiente.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Ej: [1127, 1123]. ' +
            'Si se omite, no se aplica filtro por plan. Cuando se envía, sólo se ' +
            'incluyen planes con actividad. ANTES de usar este parámetro, llama a ' +
            '`obtener_planes_disponibles` para mapear el nombre del plan al `idPlan`.',
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },
];
