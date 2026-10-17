// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'obtener_planes_disponibles',
    description:
      'OBLIGATORIO usar esta herramienta cuando el usuario pregunta por el catálogo / listado / ' +
      'los planes médicos disponibles (ej.: "¿qué planes hay?", "¿cuáles son los planes?", ' +
      '"dame el listado de planes", "qué planes médicos existen", "qué planes Medicare tenemos", ' +
      '"planes de la categoría Comercial", "qué planes Vital hay"). NO digas que no existe esa ' +
      'herramienta — sí existe y debes llamarla.\n\n' +
      'Devuelve el catálogo COMPLETO de planes médicos agrupados por CATEGORÍA (COMERCIAL, ' +
      'MEDICARE, ASES / VITAL, etc.), incluyendo planes con y sin actividad registrada. Es un ' +
      'endpoint público — NO requiere autenticación y NO debes pedir correo ni código antes de ' +
      'llamarla.\n\n' +
      'ADEMÁS es prerrequisito de las tools de datos:\n' +
      '  • Si después vas a llamar `consultar_resumen_financiero_hospitales`, ' +
      '`consultar_determinacion_adversa_mas_frecuente`, `consultar_concepto_mas_dias_denegados`, ' +
      '`consultar_determinacion_adversa_monto` o `consultar_montos_por_estado` con filtro por plan, llama primero a esta tool ' +
      'para mapear el nombre del plan al `idPlan`.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores — el ' +
      'catálogo puede cambiar entre sesiones.\n\n' +
      'FORMATO DE RESPUESTA: el endpoint devuelve un array JSON AGRUPADO POR CATEGORÍA. ' +
      'Cada elemento de primer nivel es una categoría con:\n' +
      '  • `idCategoria` (number), `nombre` (string con el NOMBRE DE LA CATEGORÍA, p.ej. "MEDICARE", ' +
      '"COMERCIAL", "ASES / VITAL"), `cantidadPlanes` (number con el total de planes en esa categoría).\n' +
      '  • `planes` (array) con los planes de esa categoría. Cada plan trae `idPlan` (number), ' +
      '`plan` (string con el NOMBRE DEL PLAN, p.ej. "Medicare", "Humana Advantage"), ' +
      '`cantidadNiveles`, `cantidadLocs` y `locs` (array con `{idLoc, codigo: "ACUTE"|"SNF"}`).\n' +
      'Ejemplo real de un elemento:\n' +
      '  {\n' +
      '    "idCategoria": 3,\n' +
      '    "nombre": "MEDICARE",\n' +
      '    "cantidadPlanes": 5,\n' +
      '    "planes": [\n' +
      '      { "idPlan": 1131, "plan": "Medicare", "cantidadNiveles": 12, "cantidadLocs": 2, "locs": [...] },\n' +
      '      { "idPlan": 1132, "plan": "MCS Classicare", ... },\n' +
      '      ...\n' +
      '    ]\n' +
      '  }\n' +
      'CUIDADO: existe un plan llamado EXACTAMENTE "Medicare" (idPlan 1131) DENTRO de la categoría ' +
      'MEDICARE. Si el usuario dice "planes Medicare", eso casi siempre se refiere a TODA LA ' +
      'CATEGORÍA MEDICARE (sus 5 planes), no al plan individual "Medicare". Cuando el usuario ' +
      'pregunta por una categoría, lista TODOS los `planes[].plan` de esa categoría.\n' +
      '\n' +
      'Al listar los planes al usuario, muestra SOLO el `plan` (el nombre) un plan por línea, con guion. ' +
      'NO uses comillas invertidas para nombres de herramientas, ni menciones campos como `idCategoria`, ' +
      '`idPlan`, `locs[]`, etc. SON INTERNOS. El usuario solo quiere ver los nombres de los planes.\n' +
      'Ejemplo de respuesta correcta: ' +
      '"Los planes disponibles en la categoría Medicare son:\n- Humana Advantage\n- MCS Advantage\n- MCS Classicare\n- Medicare\n- MMM Advantage\n- Triple S Advantage". ' +
      'Si el usuario pregunta "qué planes Medicare hay", devuelve TODOS los nombres dentro de la categoría MEDICARE. ' +
      'El `idCategoria` y `idPlan` son internos — no los expongas en la respuesta al usuario a menos que él ' +
      'explícitamente los pida.',
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
      '`consultar_determinacion_adversa_mas_frecuente`, `consultar_concepto_mas_dias_denegados`, ' +
      '`consultar_determinacion_adversa_monto` o `consultar_montos_por_estado`, necesitas el `idHospital` de cada hospital. ' +
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
        loc: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACUTE', 'SNF'],
          },
          description:
            'Filtro por Location / Nivel de cuidado del hospital (opcional, ' +
            'array de enum). Valores válidos: "ACUTE" (hospitales de cuidado ' +
            'agudo) o "SNF" (Skilled Nursing Facility — centro de enfermería ' +
            'especializada). Se envía SIEMPRE como ARRAY: ej ["ACUTE"] o ' +
            '["SNF"] o ["ACUTE", "SNF"]. Si el usuario menciona "ACUTE", "SNF", ' +
            '"agudos", "cuidado agudo", "nivel de cuidado", "enfermería ' +
            'especializada" o un valor específico, pásalo en este campo como ' +
            'array. Si el usuario no menciona nivel de cuidado / location, ' +
            'OMITE el campo (no envíes array vacío ni [""]).',
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
        loc: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACUTE', 'SNF'],
          },
          description:
            'Filtro por Location / Nivel de cuidado del hospital (opcional, ' +
            'array de enum). Valores válidos: "ACUTE" (hospitales de cuidado ' +
            'agudo) o "SNF" (Skilled Nursing Facility — centro de enfermería ' +
            'especializada). Se envía SIEMPRE como ARRAY: ej ["ACUTE"] o ' +
            '["SNF"] o ["ACUTE", "SNF"]. Si el usuario menciona "ACUTE", "SNF", ' +
            '"agudos", "cuidado agudo", "nivel de cuidado", "enfermería ' +
            'especializada" o un valor específico, pásalo en este campo como ' +
            'array. Si el usuario no menciona nivel de cuidado / location, ' +
            'OMITE el campo (no envíes array vacío ni [""]).',
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
        loc: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACUTE', 'SNF'],
          },
          description:
            'Filtro por Location / Nivel de cuidado del hospital (opcional, ' +
            'array de enum). Valores válidos: "ACUTE" (hospitales de cuidado ' +
            'agudo) o "SNF" (Skilled Nursing Facility — centro de enfermería ' +
            'especializada). Se envía SIEMPRE como ARRAY: ej ["ACUTE"] o ' +
            '["SNF"] o ["ACUTE", "SNF"]. Si el usuario menciona "ACUTE", "SNF", ' +
            '"agudos", "cuidado agudo", "nivel de cuidado", "enfermería ' +
            'especializada" o un valor específico, pásalo en este campo como ' +
            'array. Si el usuario no menciona nivel de cuidado / location, ' +
            'OMITE el campo (no envíes array vacío ni [""]).',
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
        loc: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACUTE', 'SNF'],
          },
          description:
            'Filtro por Location / Nivel de cuidado del hospital (opcional, ' +
            'array de enum). Valores válidos: "ACUTE" (hospitales de cuidado ' +
            'agudo) o "SNF" (Skilled Nursing Facility — centro de enfermería ' +
            'especializada). Se envía SIEMPRE como ARRAY: ej ["ACUTE"] o ' +
            '["SNF"] o ["ACUTE", "SNF"]. Si el usuario menciona "ACUTE", "SNF", ' +
            '"agudos", "cuidado agudo", "nivel de cuidado", "enfermería ' +
            'especializada" o un valor específico, pásalo en este campo como ' +
            'array. Si el usuario no menciona nivel de cuidado / location, ' +
            'OMITE el campo (no envíes array vacío ni [""]).',
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_monto',
    description:
      'Responde: "¿Qué determinación adversa genera mayor monto perdido / denegado?"\n\n' +
      'Devuelve un ranking de las determinaciones adversas ordenadas por el MONTO ' +
      '($) que generan (perdido / denegado), agrupadas por hospital y, opcionalmente, ' +
      'por plan.\n\n' +
      'DIFERENCIA CLAVE con `consultar_determinacion_adversa_mas_frecuente`: aquella ' +
      'rankea por FRECUENCIA (cantidad de registros), esta rankea por MONTO ($) ' +
      'generado.\n\n' +
      'DIFERENCIA con `consultar_concepto_mas_dias_denegados`: aquel rankea por DÍAS ' +
      'denegados, este rankea por MONTO ($) perdido/denegado.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por la "determinación que más dinero ' +
      'pierde", "el concepto con mayor pérdida", "lo que más denegación económica ' +
      'genera", "ranking de determinaciones por monto", o similares donde la métrica ' +
      'principal es el MONTO ($), no la cantidad ni los días.\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de planes ' +
      '(ids + nombres). Sin ese catálogo en contexto, NO puedes construir el ' +
      'parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), ' +
      'usa esa tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones ' +
      'anteriores.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite o se envía vacío, se asumen ' +
      'los 12 meses del año.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). Si el usuario solo ' +
      'dice "mis hospitales", usa el listado derivado de las herramientas de ' +
      'perfil/permisos.\n' +
      '  • `idPlanes`: int[] opcional. ANTES de usarlo, llama a ' +
      '`obtener_planes_disponibles` para obtener los IDs válidos. Si NO envías ' +
      '`idPlanes`, OMITE el campo (no envíes array vacío).\n' +
      '  • `top`: int opcional. Top-N por hospital. Si se omite, la API usa 10. ' +
      'Rango recomendado: 1–20.\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas ' +
      'simples con guion (una línea por concepto, con sus valores separados por ' +
      'comas o espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas ' +
      'alineadas para presentar datos.\n\n' +
      'PRINCIPIO DE MINIMIZACIÓN (CRÍTICO): muestra SOLO las métricas que el ' +
      'usuario pidió en su mensaje. Si pidió "monto perdido y plan", devuelve ' +
      '"- Concepto X — monto $Y\n- Plan Z — monto $W" — NUNCA incluyas ' +
      'cantidad de registros, días denegados, ni tasa de recuperación a menos ' +
      'que el usuario los pida explícitamente.',
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
            'IDs de hospitales a incluir (al menos uno). Ej: [1, 2, 5].',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Ej: [1127, 1123]. ' +
            'Si se omite, no se aplica filtro por plan. Cuando se envía, las ' +
            'auditorías sin plan asociado quedan excluidas. ANTES de usar este ' +
            'parámetro, llama a `obtener_planes_disponibles` para mapear el ' +
            'nombre del plan al `idPlan`.',
        },
        top: {
          type: 'integer',
          description:
            'Top-N por hospital. Si se omite, la API usa 10. Rango recomendado: 1–20.',
          minimum: 1,
          maximum: 50,
        },
        loc: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACUTE', 'SNF'],
          },
          description:
            'Filtro por Location / Nivel de cuidado del hospital (opcional, ' +
            'array de enum). Valores válidos: "ACUTE" (hospitales de cuidado ' +
            'agudo) o "SNF" (Skilled Nursing Facility — centro de enfermería ' +
            'especializada). Se envía SIEMPRE como ARRAY: ej ["ACUTE"] o ' +
            '["SNF"] o ["ACUTE", "SNF"]. Si el usuario no menciona nivel de ' +
            'cuidado / location, OMITE el campo.',
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'obtener_planes_por_hospital_con_loc',
    description:
      'OBLIGATORIO usar esta herramienta cuando necesitas resolver el `idPlan` ' +
      'filtrando por hospital Y por nivel de cuidado (LOC = "ACUTE" / "SNF").\n\n' +
      'Devuelve el catálogo JERÁRQUICO de planes médicos activos por hospital, ' +
      'agrupados por categoría, con los niveles de cuidado (locs) en los que cada ' +
      'plan opera. Estructura de la respuesta:\n' +
      '  • `hospitales[]` — un elemento por hospital consultado.\n' +
      '    - `hospital` (string): nombre del hospital.\n' +
      '    - `categorias[]` — agrupación por tipo de plan (ej. COMERCIAL, ASES (VITAL)).\n' +
      '      - `planes[]` — un elemento por plan con `idPlan`, `plan` (nombre) y `locs[]` ' +
      '        con los códigos de location en los que ese plan tiene actividad ' +
      '        (típicamente "ACUTE" y/o "SNF").\n' +
      '  • Solo aparecen planes con datos — los planes solicitados sin actividad NO ' +
      'aparecen en la respuesta.\n\n' +
      'ES UN PRERREQUISITO para las tools de datos cuando:\n' +
      '  • El usuario filtra por un hospital específico Y por nivel de cuidado ' +
      '("planes de Hospital San Lucas en nivel agudo", "qué planes hay en SNF en ' +
      'Centro Médico del Caribe"). En ese caso, usa esta tool para:\n' +
      '    1) Resolver `nombre → idHospital` (si aún no lo tienes de ' +
      '`obtener_hospitales_disponibles`).\n' +
      '    2) Construir `idPlanes` correcto para `consultar_*` (planes que SÍ ' +
      'operan en la loc pedida, descartando los que solo operan en otras locs).\n' +
      '  • NUNCA inventes `idPlanes` para `consultar_*` cuando hay filtro de loc; ' +
      'un plan que solo opera en SNF no debe incluirse en una consulta de planes ' +
      'en ACUTE.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte: "qué planes tiene X hospital", ' +
      '"planes disponibles por nivel de cuidado", "planes ACUTE / SNF de Y ' +
      'hospital", "qué planes operan como SNF", o cuando necesites el `idPlan` ' +
      'filtrado por loc.\n' +
      '  • Si el usuario NO filtra por loc, devuelve TODOS los planes del hospital ' +
      '(omite el campo `loc` y la respuesta trae todos los planes activos).\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `idHospitales`: int[] REQUERIDO. Antes, llama a ' +
      '`obtener_hospitales_disponibles` para mapear nombre → id.\n' +
      '  • `loc`: array opcional de "ACUTE" y/o "SNF" (sin la "s" final — es ' +
      'el nombre real del campo en el backend). Si se omite, no se filtra por ' +
      'nivel de cuidado. Si el usuario menciona una loc, pásala como array ' +
      '(ej ["ACUTE"] o ["SNF"] o ["ACUTE", "SNF"]).\n' +
      '  • `idPlanes`: int[] opcional. Limita el catálogo a un conjunto ' +
      'específico de planes. Útil cuando quieres ver la estructura de UNOS ' +
      'planes concretos dentro de los hospitales. Si NO envías `idPlanes`, OMITE ' +
      'el campo.\n\n' +
      'FORMATO DE SALIDA: la herramienta devuelve la estructura cruda. ' +
      'Preséntala al usuario de forma plana con listas simples con guion. NO uses ' +
      '<pre>, tablas, columnas alineadas ni caracteres Unicode tipo tabla. Ejemplo ' +
      'de respuesta correcta:\n' +
      '- Hospital San Lucas — ASES (VITAL): First Medical Vital (ACUTE, SNF), Triple S ' +
      'Vital (ACUTE), Menonita Vital (ACUTE, SNF), MMM Vital (ACUTE).\n' +
      '- Centro Medico del Caribe — COMERCIAL: MMM Vital (ACUTE).\n\n' +
      'PRINCIPIO DE MINIMIZACIÓN (CRÍTICO): si el usuario pidió ver los planes de ' +
      'X hospital, NO incluyas monto, días ni auditoría de esos planes — para eso ' +
      'están las tools `consultar_*`. Muestra SOLO la estructura del catálogo.',
    input_schema: {
      type: 'object',
      properties: {
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description:
            'IDs de hospitales a consultar (requerido, al menos uno). ' +
            'Antes de llamar, usa `obtener_hospitales_disponibles` para mapear ' +
            'el nombre del hospital al `idHospital`.',
        },
        loc: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACUTE', 'SNF'],
          },
          description:
            'Filtro por nivel de cuidado / location (opcional, array de enum). ' +
            'Nombre del campo en el backend: `loc` (sin la "s" final). Valores ' +
            'válidos: "ACUTE" (hospitales de cuidado agudo) o "SNF" (Skilled ' +
            'Nursing Facility — centro de enfermería especializada). Se envía ' +
            'como array: ej ["ACUTE"], ["SNF"] o ["ACUTE", "SNF"]. Si el ' +
            'usuario NO menciona nivel de cuidado, OMITE el campo.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir en el catálogo (opcional, int[]). Si se ' +
            'envía, la respuesta se limita a los planes indicados (típicamente ' +
            'se usa el catálogo de `obtener_planes_disponibles` para resolver ' +
            'el nombre del plan al `idPlan`). Si NO envías `idPlanes`, OMITE el ' +
            'campo (no envíes array vacío).',
        },
      },
      required: ['idHospitales'],
    },
  },
];
