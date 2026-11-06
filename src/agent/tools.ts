// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

/*──────────────────────────────────────────────────────────────────────────
  FILTRO POR DÍA (`dia`) — compartido por TODAS las tools de datos.

  El body de los endpoints de `IaPreguntas` acepta `dia` (int 1–31) como
  filtro de granularidad DÍA, y el backend SOLO lo interpreta cuando el
  request trae `meses` poblado. Por eso vive aquí como una constante
  reutilizada en vez de repetirse 13 veces dentro de los `input_schema`.

  NO se aplica a las tools de CATÁLOGO (`obtener_planes_disponibles`,
  `obtener_hospitales_disponibles`, `obtener_planes_por_hospital_con_loc`):
  esos endpoints son key/value y no aceptan período.
  ─────────────────────────────────────────────────────────────────────────*/
const DIA_SCHEMA = {
  type: 'integer',
  minimum: 1,
  maximum: 31,
  description:
    'Día específico (1–31) DENTRO de los meses indicados en `meses`. Úsalo ' +
    'cuando el usuario pida un día concreto: "el 5 de octubre" → ' +
    '`meses: [10], dia: 5`; "del 15 de marzo de 2026" → `anio: 2026, ' +
    'meses: [3], dia: 15`. REGLAS: (1) SOLO envíalo si `meses` viene ' +
    'poblado — `dia` sin `meses` no aplica y el backend lo ignora; ' +
    '(2) NO se puede filtrar un RANGO de días ("del 5 al 9"): en ese caso ' +
    'usa `meses` y OMITE `dia`; (3) si el usuario no menciona un día ' +
    'concreto, OMITE el campo (no mandes 0, null ni un array).',
};

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
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\n' +
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
      'trae aprobados/denegados/recuperados y el usuario solo pidió denegados, devuelve SOLO denegados.\n\n' +
      'CÓMO ELEGIR EL "MENOR" / "MAYOR" (ranking por hospital):\n' +
      '  • `porHospital[]` NO viene ordenado por la métrica (viene por días de estancia). Para "qué ' +
      'hospital tiene la MENOR cantidad / el MENOR % denegado" RECORRÉ TODOS los elementos y compará: ' +
      'el ganador es el de cifra MÁS BAJA, NO el primero del array. Lo mismo para el MÁXIMO.\n' +
      '  • Un hospital que aparece en `filtrosAplicados.hospitales` pero NO en `porHospital[]` NO ' +
      'tiene datos en el período: no es "el que menos denegó" (no registró nada) y no lo presentes ' +
      'como si tuviera un valor.\n' +
      '  • Si la pregunta pide un extremo con DOS métricas ("menor cantidad Y % denegado"), la ' +
      'respuesta es UN SOLO hospital: el que cumple el criterio PRINCIPAL (la métrica nombrada ' +
      'primero: la cantidad) y mostrale SUS dos valores, los del MISMO hospital. NUNCA mezcles los ' +
      'días de un hospital con el % de otro.',
    input_schema: {
      type: 'object',
      properties: {
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
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
      required: ['idHospitales'],
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
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\n' +
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
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
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
      required: ['idHospitales'],
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
        dia: DIA_SCHEMA,
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
      'CÓMO ELEGIR EL "MENOR" / "MAYOR" (ranking por hospital):\n' +
      '  • `porHospital[]` NO viene ordenado por la métrica (viene por `idHospital`). Para "qué ' +
      'hospital tiene la MENOR cantidad / el MENOR % perdido" RECORRÉ TODOS los elementos y compará: ' +
      'el ganador es el de cifra MÁS BAJA, NO el primero del array. Lo mismo para el MÁXIMO.\n' +
      '  • Cada hospital trae `perdido` ($), `potencial`, `porcentajePerdidaSobrePotencialHospital` ' +
      '(% de pérdida sobre SU propio potencial) y `porcentajeFacturadoSobrePotencialHospital`.\n' +
      '  • Un hospital que aparece en `filtrosAplicados.hospitales` pero NO en `porHospital[]` NO ' +
      'tiene datos en el período: no es "el que menos perdió" (no registró nada) y no lo presentes ' +
      'como si tuviera un valor.\n' +
      '  • Si la pregunta pide un extremo con DOS métricas ("menor cantidad Y % perdido de dinero"), ' +
      'la respuesta es UN SOLO hospital: el que cumple el criterio PRINCIPAL (la métrica nombrada ' +
      'primero: el monto/cantidad) y mostrale SUS dos valores, los del MISMO hospital. NUNCA mezcles ' +
      'el $ de un hospital con el % de otro ni presentes dos hospitales distintos como si fueran uno.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\n' +
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
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
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
      required: ['idHospitales'],
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
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). Si el usuario solo ' +
      'dice "mis hospitales", usa el listado derivado de las herramientas de ' +
      'perfil/permisos.\n' +
      '  • `idPlanes`: int[]. MODO OBLIGATORIO cuando la pregunta es por PLAN.\n' +
      '\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\n' +
      '  • Cuando la pregunta del usuario pide un ranking POR PLAN ("qué plan ' +
      'perdió más dinero", "plan con mayor monto perdido", "en qué plan se ' +
      'concentró la mayor pérdida", "plan que más denegación económica genera", ' +
      'etc.), DEBES llamar esta tool CON `idPlanes` poblado con TODOS los IDs del ' +
      'catálogo de `obtener_planes_disponibles` (o el subconjunto que aplique).\n' +
      '  • La razón: el backend devuelve el desglose por plan dentro de cada ' +
      'hospital SOLO en el campo `itemsPorPlan[]` CUANDO se envía `idPlanes`. ' +
      'Si omites `idPlanes`, ese campo viene `null` y NO PUEDES responder ' +
      '"plan con mayor monto por hospital".\n' +
      '  • `idPlanes` NO es opcional en este caso: es REQUERIDO para responder ' +
      'preguntas de ranking por plan. Si lo omites, NO declares "el endpoint no ' +
      'tiene esa información" — sí la tiene, solo que bajo `itemsPorPlan[]` y ' +
      'requiere el filtro.\n' +
      '  • Si el usuario pide ranking por CONCEPTO/DETERMINACIÓN ("qué ' +
      'determinación genera más pérdida", "concepto que más dinero pierde") ' +
      'SIN mencionar plan, puedes omitir `idPlanes` (en ese caso solo ' +
      'recibirás `items[]` por concepto y está bien).\n' +
      '  • ANTES de poblar `idPlanes`, llama a `obtener_planes_disponibles` para ' +
      'obtener los IDs válidos. Si NO envías `idPlanes`, OMITE el campo ' +
      'completamente (no envíes array vacío).\n\n' +
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
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
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
            'IDs de planes médicos. Ej: [1127, 1123]. Ver sección ' +
            '"🧠 CONTRATO DE FILTRO POR PLANES" arriba — REQUERIDO cuando la ' +
            'pregunta es ranking por plan (activa `itemsPorPlan[]` con el ' +
            'desglose `hospital × plan × monto`). Si se omite, `itemsPorPlan` ' +
            'viene `null`. ANTES de poblarlo, llama a `obtener_planes_disponibles` ' +
            'para mapear nombre → idPlan. Si NO envías `idPlanes`, OMITE el campo ' +
            '(no array vacío).',
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
      required: ['idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_monto_consolidado',
    description:
      'Devuelve el RANKING CONSOLIDADO de determinaciones adversas (los motivos/conceptos por los ' +
      'que un auditor negó días) con el DINERO PERDIDO y los DÍAS DENEGADOS que produjo cada una, ' +
      'AGREGADOS sobre TODOS los hospitales seleccionados. NO viene partido por hospital: es una ' +
      'sola lista, una fila por determinación adversa.\n\n' +
      'ÚSALA cuando el usuario pregunta qué motivo de determinación adversa costó más (en días o en ' +
      'dinero) para un conjunto de hospitales, un período o un plan. Ejemplos: "qué determinación ' +
      'adversa costó más", "cuál fue el motivo más caro de las denegaciones", "en qué se perdió más ' +
      'dinero", "qué razón de denegación pesa más", "cuántos días se negaron por cada causa", ' +
      '"cómo se reparten las denegaciones", "qué % de la estancia se perdió por denegaciones".\n\n' +
      'CÓMO ELEGIR ENTRE LAS VARIANTES (mismo dato, distinta forma):\n' +
      '  • `consultar_determinacion_adversa_monto_consolidado` (esta): UNA fila por determinación ' +
      'adversa con los datos SUMADOS de todos los hospitales. Para el RANKING GLOBAL.\n' +
      '  • `consultar_determinacion_adversa_monto` (ruta `determinacion-adversa-monto-por-hospital`): ' +
      'los MISMOS datos pero PARTIDOS por hospital (y por plan si mandás `idPlanes`). Usala cuando el ' +
      'usuario pregunta por un hospital puntual ("cuánto perdió el hospital X", "comparame estos dos ' +
      'hospitales").\n' +
      '  • `consultar_determinacion_adversa_mas_frecuente`: ranking por CANTIDAD de veces que se ' +
      'aplicó cada determinación (no por días ni por dinero).\n\n' +
      'PARÁMETROS:\n' +
      '  • `fechaInicio` / `fechaFin` (string YYYY-MM-DD, OBLIGATORIOS): el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: el backend filtra ' +
      'por rango de fechas. Manda SIEMPRE las dos fechas:\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → `fechaInicio` = ' +
      'primer día del rango, `fechaFin` = último día.\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = 1 de enero del ' +
      'año en curso, `fechaFin` = 31 de diciembre del año en curso. NO preguntes por el período.\n' +
      '  • `idHospitales` (array of numbers, OBLIGATORIO salvo que mandes `global: true`): los ' +
      'hospitales a considerar. Si el usuario no dijo cuáles, usá `global: true` o preguntale.\n' +
      '  • `global` (boolean, opcional): con `true` se consideran TODOS los hospitales del catálogo y ' +
      '`idHospitales` se ignora.\n' +
      '  • `idPlanes` (array of numbers, opcional): filtra por plan médico. NUNCA inventes ids ni uses ' +
      'ids memorizados de conversaciones anteriores: llamá antes a la tool de CATÁLOGO DE PLANES para ' +
      'mapear el nombre del plan al `idPlan` (el catálogo puede cambiar entre sesiones).\n' +
      '  • `loc` (array of strings, opcional): filtra por nivel de cuidado — "ACUTE" y/o "SNF" ' +
      '(case-insensitive). Vacío o ausente = todos.\n\n' +
      'FORMATO DE RESPUESTA: devuelve un objeto JSON con:\n' +
      '  • `filtrosAplicados` (object) — los filtros YA resueltos y en texto legible: `periodo` ' +
      '(p.ej. "01/01/2026 - 31/12/2026"), `hospitales` (array con los nombres cortos), `planes` ("Todos" ' +
      'o "2 planes solicitados: A, B") y `loc` ("Todos" o "ACUTE"). Usalo para confirmarle al usuario ' +
      'qué período y qué hospitales se aplicaron.\n' +
      '  • `totalDiasDenegados` (number) — Σ de días denegados del filtro.\n' +
      '  • `totalMontoPerdido` (number) — Σ del dinero perdido del filtro (días denegados × precio del ' +
      'plan del nivel).\n' +
      '  • `totalLos` (number) — Σ de los DÍAS DE ESTANCIA del filtro (las mismas auditorías, el mismo ' +
      'período, los mismos filtros). Es el denominador de la tasa de denegación.\n' +
      '  • `porcentajeDiasDenegadosVsTotalLos` (number) — TASA GLOBAL de denegación: qué % de los días ' +
      'de estancia del filtro quedaron denegados. La API lo devuelve con 4 decimales (ej. 41.5902) pero ' +
      'AL MOSTRARLO poné 2 decimales (41.59%).\n' +
      '  • `items` (array) — una entrada por determinación adversa, ordenada por `diasDenegados` DESC. ' +
      'Cada item trae `determinacionAdversa` (nombre del motivo), `diasDenegados`, `montoPerdido`, ' +
      '`porcentajeDiasDenegadosVsTotalDiasDenegados`, `porcentajeDiasDenegadosVsTotalLos`, ' +
      '`porcentajeMontoPerdido` y NADA más. Los campos `idConcepto`, `idGrupo` y `tipoCategoria` son ' +
      'INTERNOS.\n' +
      '  ⚠️ EL ORDEN DEL ARRAY ES POR DÍAS, NO POR DINERO: para "qué determinación costó más EN ' +
      'DINERO" el ganador es el item con el `montoPerdido` MÁS ALTO, que puede NO ser el primero del ' +
      'array (con algunos filtros de loc hay diferencias). Recorre los items y COMPARA los montos; no ' +
      'te quedes con el primero. Para "qué denegó más días" el primero SÍ es el ganador.\n' +
      'Ejemplo real de un item:\n' +
      '  { "idConcepto": 5, "determinacionAdversa": "Tardanza En Realizar Estudio Imagen/Med Nuclear",\n' +
      '    "idGrupo": 1, "tipoCategoria": "Administracion", "diasDenegados": 32.0, "montoPerdido": 13522.0,\n' +
      '    "porcentajeDiasDenegadosVsTotalDiasDenegados": 23.53,\n' +
      '    "porcentajeDiasDenegadosVsTotalLos": 9.7859,\n' +
      '    "porcentajeMontoPerdido": 23.62 }\n' +
      '(ejemplo crudo de la API: al usuario mostralo con 2 decimales → 23.53%, 9.79%, 23.62%).\n\n' +
      'LOS TRES PORCENTAJES NO SON LO MISMO — no los confundas:\n' +
      '  • `porcentajeDiasDenegadosVsTotalDiasDenegados` — CUOTA: qué % de todos los DÍAS DENEGADOS del ' +
      'filtro se deben a esta determinación. La suma de todos los items ≈ 100%. Si el usuario pregunta ' +
      '"¿qué parte de las denegaciones explica esta causa?", usá ESTE.\n' +
      '  • `porcentajeDiasDenegadosVsTotalLos` — TASA: qué % de los DÍAS DE ESTANCIA del filtro denegó ' +
      'esta determinación (comparar contra `totalLos`). La suma puede SUPERAR 100% (una misma auditoría ' +
      'puede tener varias determinaciones). Si el usuario pregunta "¿qué % de la estancia se perdió por ' +
      'esto?", usá ESTE.\n' +
      '  • `porcentajeMontoPerdido` — qué % del DINERO perdido del filtro explica esta determinación. La ' +
      'suma ≈ 100%.\n\n' +
      'CÓMO RESPONDERLE AL USUARIO:\n' +
      '  • Redondeá los porcentajes a 2 DECIMALES al mostrarlos (19.5532 → 19.55%, 41.5902 → 41.59%, ' +
      '23.62% → 23.62%). Es SOLO formato: no recalcules el porcentaje ni lo derives de otra fórmula.\n' +
      '  • Mostrá el nombre de la determinación (`determinacionAdversa`), los días denegados, el dinero ' +
      'perdido y el % que corresponda según lo que preguntó. `idConcepto`, `idGrupo` y `tipoCategoria` ' +
      'son INTERNOS: no los expongas salvo que el usuario los pida explícitamente.\n' +
      '  • Usá `filtrosAplicados` para confirmar qué período y qué hospitales se aplicaron: no los ' +
      'adivines.\n' +
      '  • Si `items` viene vacío, NO inventes determinaciones: decí que en ese período no hubo días ' +
      'denegados ni dinero perdido para los filtros indicados.\n' +
      '  • Si el usuario pregunta por un hospital concreto, usá la tool `consultar_determinacion_adversa_monto` ' +
      '(partida por hospital) en vez de esta.',
    input_schema: {
      type: 'object',
      properties: {
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de hospital a considerar. Obligatorio salvo que se mande global:true.',
        },
        global: {
          type: 'boolean',
          description:
            'true = considerar TODOS los hospitales del catálogo (ignora idHospitales).',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de plan médico. Obtenerlos del catálogo de planes; nunca inventarlos.',
        },
        loc: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Códigos de LOC: "ACUTE" y/o "SNF" (case-insensitive). Vacío = todos.',
        },
      },
      required: [],
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

  /*──────────────────────────────────────────────────────────────────────────
    Desempeño de médicos + Determinación adversa del médico de alta
    (NE — agregado 2026-10-18)

    Particularidad importante:
      • No existe aún una herramienta de catálogo de médicos. Para resolver
        nombre → `idMedicoAlta`, la IA debe llamar PRIMERO a
        `consultar_desempeno_medico` SIN pasar `idMedicoAlta` (dejando que el
        backend devuelva el catálogo de médicos disponible bajo los otros
        filtros) y usar el resultado para mapear.
      • Cuando el usuario pide datos de UN médico concreto, la IA debe
        preguntar el nombre del médico si no lo tiene, llamar primero a
        `consultar_desempeno_medico` sin `idMedicoAlta` para obtener el
        catálogo, identificar el ID, y entonces volver a llamar PASANDO
        `idMedicoAlta` ya resuelto.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_desempeno_medico',
    description:
      'Devuelve el desempeño de los médicos que han firmado altas en el período ' +
      'y filtros seleccionados (días aprobados / denegados / recuperados, ' +
      'montos facturados / perdidos / recuperados, número de auditorías, etc., ' +
      'agrupado por médico).\n\n' +
      'MODOS DE USO:\n' +
      '  • MODO CATÁLOGO: si NO se envía `idMedicoAlta`, el endpoint devuelve ' +
      'el listado de médicos disponibles para los filtros aplicados. USA este ' +
      'modo cuando necesites mapear un nombre de médico a su `idMedicoAlta`.\n' +
      '  • MODO CONSULTA: si SÍ se envía `idMedicoAlta`, devuelve solo los KPIs ' +
      'de ese médico.\n\n' +
      '🧠 AGRUPACIÓN DE LA RESPUESTA (`agruparPor`, opcional):\n' +
      '  La respuesta puede venir en DOS jerarquías. Elige según la DIMENSIÓN ' +
      'por la que el usuario quiere ver el dato, NO según los filtros: los ' +
      'datos y las cifras son EXACTAMENTE los mismos en los dos modos (solo ' +
      'cambia el orden de los niveles).\n' +
      '  • `agruparPor: 1` (o si lo OMITES) → POR HOSPITAL: ' +
      '`hospitales[] → medicos[] → categorias[] → planes[]`. Úsalo cuando la ' +
      'pregunta sea "¿cómo se comporta CADA médico EN un hospital?" o "ranking ' +
      'de médicos por hospital" (comparar médicos DENTRO de un hospital). ' +
      'Ej: "qué médico deniega más días en San Lucas", "cómo se comportan los ' +
      'médicos del San Lucas en 2026".\n' +
      '  • `agruparPor: 2` → POR MÉDICO: `medicos[] → planes[] → ' +
      'hospitales[]` (el médico es el nivel principal y los hospitals cuelgan ' +
      'del plan). Úsalo cuando la pregunta sea "¿cómo se comporta el médico X ' +
      'en TODOS los hospitales que evaluó?" o "¿en qué hospital/plan rinde o ' +
      'pierde más el médico X?". Ej: "cómo se comporta el Dr. X entre todos los ' +
      'hospitales", "en qué hospital pierde más el Dr. X".\n' +
      '    OJO, en el modo 2 hay DOS niveles de hospital: `medicos[].hospitales[]` ' +
      'es el TOTAL del médico en ese hospital (ya viene SUMADO entre todos sus ' +
      'planes: úsalo para "cuántos días denegados tuvo en San Lucas"), y ' +
      '`medicos[].planes[].hospitales[]` es el detalle de CADA plan dentro de ' +
      'ese hospital. Para la respuesta usa SIEMPRE los totales de ' +
      '`medicos[].hospitales[]` y NO sumes los planes a mano (una suma tuya no ' +
      'existe en la respuesta y se descarta como dato inventado).\n' +
      '  • Si la pregunta es ambigua ("desempeño del Dr. X"), usa ' +
      '`agruparPor: 2`: es el modo que responde POR EL MÉDICO y no por el ' +
      'hospital.\n' +
      '  • En el modo 2 la CATEGORÍA se colapsa dentro de cada plan (no existe ' +
      '`categorias[]`): el desglose disponible es plan → hospital.\n\n' +
      'PRERREQUISITOS:\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de ' +
      'planes (ids + nombres). Sin ese catálogo, NO puedes construir ' +
      '`idPlanes` de forma fiable.\n' +
      '  • Para resolver nombre → `idMedicoAlta`: llama primero a esta misma ' +
      'tool SIN `idMedicoAlta` (MODO CATÁLOGO) y luego vuelve a llamarla con ' +
      'el ID ya resuelto.\n' +
      '  • NUNCA inventes `idPlanes` ni `idMedicoAlta` — usa los IDs ' +
      'devueltos por las herramientas de catálogo.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite o se envía vacío, se ' +
      'asumen los 12 meses del año.\n' +
      '  • `idPlanes`: int[] opcional. Llama antes a `obtener_planes_disponibles` ' +
      'para mapear nombre → ID. Si el usuario dice "todos", omite el campo.\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF". Si el usuario menciona ' +
      'nivel de cuidado (agudo / SNF / enfermería especializada), pásalo. Si ' +
      'no, OMITE el campo.\n' +
      '  • `idMedicoAlta`: int opcional. Si el usuario preguntó por un médico ' +
      'CONCRETO (por nombre o ID), llámala primero en MODO CATÁLOGO para ' +
      'resolver el ID y luego repítela pasándolo.\n' +
      '  • `agruparPor`: int opcional (1 o 2). 1 = por hospital (omítelo si ' +
      'el usuario pregunta por un hospital puntual o no dice nada); 2 = por ' +
      'médico (úsalo cuando la pregunta es sobre UN médico a través de todos ' +
      'los hospitales, o sobre su desempeño global).\n\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\n' +
      '  • Si envías `idPlanes` → el backend devuelve el detalle agrupado POR ' +
      'PLAN (útil para responder "¿en qué plan X se concentran los días ' +
      'denegados?" o "¿cuánto perdió cada plan para este médico/auditor/ ' +
      'manejador?"). SIEMPRE lista primero el catálogo con ' +
      '`obtener_planes_disponibles` para tener los IDs reales.\n' +
      '  • Si OMITES `idPlanes` (o envías array vacío) → el backend devuelve ' +
      'el resultado GLOBAL del médico/auditor/manejador, sin desglose por ' +
      'plan (todos los planes sumados).\n' +
      '  • Para la pregunta "¿en qué plan se le deniegan más días al médico X?" ' +
      'PASA `idPlanes` con la lista completa del catálogo. NO omitas el campo.\n' +
      '  • Para "días denegados totales del médico X sin importar el plan" ' +
      'OMITE `idPlanes`.\n\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion (una línea por médico, con valores separados por comas o espacios). ' +
      'NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas.\n\n' +
      'LEE LA JERARQUÍA SEGÚN `agruparPor`: con 1 los médicos cuelgan de ' +
      '`hospitales[]`; con 2 los médicos cuelgan de la RAÍZ (`medicos[]`), cada ' +
      'médico trae `planes[]` (y dentro de cada plan sus `hospitales[]`) y ' +
      'además `hospitales[]` con su TOTAL por hospital. No busques médicos en el ' +
      'mismo nivel en los dos modos.',
    input_schema: {
      type: 'object',
      properties: {
        idHospitales: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description:
            'IDs de hospitales (int[] REQUERIDO, al menos uno). Resuélvelos ' +
            'SIEMPRE antes con `obtener_hospitales_disponibles` (campo ' +
            '`hosId`). Ej: si el usuario dice "San Lucas", mapea a su `hosId` ' +
            'y pásalo como `[6]`. SIEMPRE array, NUNCA objeto.',
        },
        anio: {
          type: 'integer',
          description:
            'Año del período (1900–2999). Si el usuario no lo da, pregunta ' +
            'concreta y brevemente.',
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
        dia: DIA_SCHEMA,
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías `idPlanes`, OMITE el ' +
            'campo (no envíes array vacío).',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional, array de enum). ' +
            'Se envía SIEMPRE como ARRAY: ej ["ACUTE"], ["SNF"] o ["ACUTE","SNF"]. ' +
            'Si el usuario no menciona nivel de cuidado, OMITE el campo.',
        },
        idMedicoAlta: {
          type: 'integer',
          description:
            'ID del médico de alta a consultar (opcional, int>0). Si se OMITE, ' +
            'el endpoint devuelve el catálogo completo de médicos disponibles ' +
            'bajo los otros filtros (modo catálogo). Si el usuario pidió un ' +
            'médico CONCRETO por nombre, PRIMERO llama sin este parámetro, ' +
            'identifica el ID en el catálogo, y VUELVE a llamar pasándolo.',
          minimum: 1,
        },
        agruparPor: {
          type: 'integer',
          enum: [1, 2],
          description:
            'Agrupador de la jerarquía de la respuesta (opcional). 1 (o si lo ' +
            'OMITES) = POR HOSPITAL: `hospitales[] → medicos[] → categorias[] → ' +
            'planes[]`; úsalo para "cada médico en cada hospital" y rankings ' +
            'por hospital. 2 = POR MÉDICO: `medicos[] → planes[] → ' +
            'hospitales[]`; úsalo para "el médico X en todos los hospitales que ' +
            'evaluó" y "en qué hospital/plan rinde más el médico X". Los datos ' +
            'y las cifras son los mismos en ambos modos; solo cambia el orden ' +
            'de los niveles.',
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_medico_alta',
    description:
      'Devuelve el/los concepto(s) de determinación adversa que MÁS se repiten ' +
      'en las auditorías asociadas al médico de alta del paciente ' +
      '(`idMedicoAlta`) dentro del período y filtros seleccionados.\n\n' +
      'CASO DE USO TÍPICO: "¿cuál es la determinación adversa más frecuente ' +
      'que deniega auditorías del Dr. X?" / "¿qué concepto sigue rechazando ' +
      'el médico número 18?".\n\n' +
      'PRERREQUISITOS:\n' +
      '  • `idMedicoAlta` ES OBLIGATORIO para esta herramienta (a diferencia ' +
      'de `consultar_desempeno_medico`). El endpoint NO devuelve el catálogo ' +
      'de médicos — solo devuelve KPIs del médico que se le pasa.\n' +
      '  • Para resolver nombre → `idMedicoAlta`: llama primero a ' +
      '`consultar_desempeno_medico` en MODO CATÁLOGO (sin `idMedicoAlta`), ' +
      'identifica el ID, y VUELVE a llamar a esta herramienta pasándolo.\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de ' +
      'planes (ids + nombres). Sin ese catálogo, NO puedes construir ' +
      '`idPlanes` de forma fiable.\n' +
      '  • NUNCA inventes `idPlanes` ni `idMedicoAlta` — usa los IDs ' +
      'devueltos por las herramientas de catálogo.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `idMedicoAlta`: int REQUERIDO (>=1). Si no lo tienes resuelto, ' +
      'pregunta el nombre al usuario o usa el catálogo de ' +
      '`consultar_desempeno_medico` sin filtro.\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\n' +
      '  • `idPlanes`: int[] opcional. Llama antes a `obtener_planes_disponibles` ' +
      'para mapear nombre → ID. Si el usuario dice "todos", omite el campo.\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF".\n\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\n' +
      '  • Si envías `idPlanes` → el backend devuelve los conceptos de ' +
      'determinación adversa FILTRADOS solo a esos planes. Pasarlo ayuda a ' +
      'responder "¿qué conceptos deniegan más en el plan X para este médico/ ' +
      'manejador/auditor?".\n' +
      '  • Si OMITES `idPlanes` → el backend devuelve los conceptos ' +
      'considerando TODOS los planes aplicables (global sin filtro de plan).\n\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion (una línea por concepto). NUNCA uses <pre>, <table>, <ul>, <li>, ' +
      '<br>, ni columnas alineadas.',
    input_schema: {
      type: 'object',
      properties: {
        idMedicoAlta: {
          type: 'integer',
          description:
            'ID del médico de alta (REQUERIDO, int>=1). Resuélvelo con el ' +
            'catálogo de `consultar_desempeno_medico` (llamándola sin filtro ' +
            'previamente).',
          minimum: 1,
        },
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional). Se envía como ' +
            'ARRAY. Si el usuario no menciona nivel de cuidado, OMITE el campo.',
        },
      },
      required: ['idMedicoAlta'],
    },
  },

  /*──────────────────────────────────────────────────────────────────────────
    Desempeño de manejadores de caso + Determinación adversa del manejador

    Es el espejo de las dos tools anteriores (`*_medico_*`) pero referidas al
    MANEJADOR DE CASO, es decir, la persona que gestiona/administra el caso
    del paciente (no quien firma el alta médica). Su identificador es
    `idManejadorCaso`.

    Misma mecánica de MODO CATÁLOGO → MODO CONSULTA: para resolver
    nombre → `idManejadorCaso`, la IA debe llamar primero a
    `consultar_desempeno_manejador_caso` SIN pasar `idManejadorCaso` y usar
    la respuesta para mapear.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_desempeno_manejador_caso',
    description:
      'Devuelve el desempeño de los MANEJADORES DE CASO que gestionan los ' +
      'casos en el período y filtros seleccionados (días aprobados / denegados ' +
      '/ recuperados, montos facturados / perdidos / recuperados, número de ' +
      'auditorías, etc., agrupado por manejador).\\n\\n' +
      '⚠️ DISTINCIÓN IMPORTANTE: "manejador de caso" es la persona que ' +
      'administra/coordina el caso del paciente; NO es lo mismo que el médico ' +
      'que firma el alta. Si el usuario no aclara, pregúntale si se refiere al ' +
      'médico o al manejador antes de elegir herramienta.\\n\\n' +
      'MODOS DE USO:\\n' +
      '  • MODO CATÁLOGO: si NO se envía `idManejadorCaso`, el endpoint ' +
      'devuelve el listado de manejadores disponibles para los filtros ' +
      'aplicados. USA este modo cuando necesites mapear un nombre a su ' +
      '`idManejadorCaso`.\\n' +
      '  • MODO CONSULTA: si SÍ se envía `idManejadorCaso`, devuelve solo los ' +
      'KPIs de ese manejador.\\n\\n' +
      'PRERREQUISITOS:\\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de ' +
      'planes (ids + nombres).\\n' +
      '  • Para resolver nombre → `idManejadorCaso`: llama primero a esta ' +
      'misma tool SIN `idManejadorCaso` (MODO CATÁLOGO) y luego vuelve a ' +
      'llamarla con el ID ya resuelto.\\n' +
      '  • NUNCA inventes `idPlanes` ni `idManejadorCaso` — usa los IDs ' +
      'devueltos por las herramientas de catálogo.\\n\\n' +
      'OBTENCIÓN DE PARÁMETROS:\\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\\n' +
      '  • `idPlanes`: int[] opcional. Llama antes a ' +
      '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.\\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF". Si el usuario no ' +
      'menciona nivel de cuidado, OMITE el campo.\\n' +
      '  • `idManejadorCaso`: int opcional. Si el usuario preguntó por un ' +
      'manejador CONCRETO, llámala primero en MODO CATÁLOGO para resolver ' +
      'el ID y luego repítela pasándolo.\\n\\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\\n' +
      '  • Si envías `idPlanes` → el backend devuelve el detalle agrupado POR ' +
      'PLAN (útil para responder "¿en qué plan X se concentran los días ' +
      'denegados del manejador Y?" o "¿cuánto perdió cada plan para este ' +
      'manejador?"). SIEMPRE lista primero el catálogo con ' +
      '`obtener_planes_disponibles` para tener los IDs reales.\\n' +
      '  • Si OMITES `idPlanes` (o envías array vacío) → el backend devuelve ' +
      'el resultado GLOBAL del manejador, sin desglose por plan.\\n' +
      '  • Para la pregunta "¿en qué plan se le deniegan más días al ' +
      'manejador X?" PASA `idPlanes` con la lista completa del catálogo.\\n' +
      '  • Para "días denegados totales del manejador X sin importar el plan" ' +
      'OMITE `idPlanes`.\\n\\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por manejador, con valores separados por comas o ' +
      'espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas ' +
      'alineadas.',
    input_schema: {
      type: 'object',
      properties: {
        idHospitales: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description:
            'IDs de hospitales (int[] REQUERIDO, al menos uno). Resuélvelos ' +
            'SIEMPRE antes con `obtener_hospitales_disponibles` (campo ' +
            '`hosId`). SIEMPRE array, NUNCA objeto.',
        },
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías `idPlanes`, OMITE el ' +
            'campo.',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional, array de enum). ' +
            'Se envía SIEMPRE como ARRAY. Si el usuario no menciona nivel, OMITE.',
        },
        idManejadorCaso: {
          type: 'integer',
          description:
            'ID del manejador de caso (opcional, int>0). Si se OMITE, el ' +
            'endpoint devuelve el catálogo de manejadores disponibles bajo ' +
            'los otros filtros (modo catálogo). Si el usuario pidió un ' +
            'manejador CONCRETO por nombre, PRIMERO llama sin este parámetro, ' +
            'identifica el ID en el catálogo, y VUELVE a llamar pasándolo.',
          minimum: 1,
        },
      },
      required: ['idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_manejador_caso',
    description:
      'Devuelve el/los concepto(s) de determinación adversa que MÁS se ' +
      'repiten en las auditorías asociadas al MANEJADOR DE CASO del ' +
      'paciente (`idManejadorCaso`) dentro del período y filtros ' +
      'seleccionados.\\n\\n' +
      '⚠️ DISTINCIÓN IMPORTANTE: "manejador de caso" es quien ' +
      'administra/coordina el caso, NO el médico de alta. Si el usuario ' +
      'dijo "médico", usa `consultar_determinacion_adversa_medico_alta` en ' +
      'lugar de esta.\\n\\n' +
      'CASO DE USO TÍPICO: "¿cuál es la determinación adversa más ' +
      'frecuente que deniega auditorías del manejador X?" / "¿qué concepto ' +
      'sigue rechazando el manejador de caso 3?".\\n\\n' +
      'PRERREQUISITOS:\\n' +
      '  • `idManejadorCaso` ES OBLIGATORIO para esta herramienta. El ' +
      'endpoint NO devuelve el catálogo de manejadores — solo devuelve KPIs ' +
      'del manejador que se le pasa.\\n' +
      '  • Para resolver nombre → `idManejadorCaso`: llama primero a ' +
      '`consultar_desempeno_manejador_caso` en MODO CATÁLOGO (sin ' +
      '`idManejadorCaso`), identifica el ID, y VUELVE a llamar a esta ' +
      'herramienta pasándolo.\\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de ' +
      'planes.\\n' +
      '  • NUNCA inventes `idPlanes` ni `idManejadorCaso` — usa los IDs ' +
      'devueltos por las herramientas de catálogo.\\n\\n' +
      'OBTENCIÓN DE PARÁMETROS:\\n' +
      '  • `idManejadorCaso`: int REQUERIDO (>=1). Si no lo tienes resuelto, ' +
      'pregunta el nombre al usuario o usa el catálogo de ' +
      '`consultar_desempeno_manejador_caso` sin filtro.\\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\\n' +
      '  • `idPlanes`: int[] opcional. Llama antes a ' +
      '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.\\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF".\\n\\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\\n' +
      '  • Si envías `idPlanes` → el backend devuelve los conceptos de ' +
      'determinación adversa FILTRADOS solo a esos planes. Útil para ' +
      'responder "¿qué conceptos deniegan más en el plan X para este ' +
      'manejador/auditor?".\\n' +
      '  • Si OMITES `idPlanes` → el backend devuelve los conceptos ' +
      'considerando TODOS los planes aplicables (global sin filtro de plan).\\n\\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por concepto). NUNCA uses <pre>, <table>, <ul>, ' +
      '<li>, <br>, ni columnas alineadas.',
    input_schema: {
      type: 'object',
      properties: {
        idManejadorCaso: {
          type: 'integer',
          description:
            'ID del manejador de caso (REQUERIDO, int>=1). Resuélvelo con el ' +
            'catálogo de `consultar_desempeno_manejador_caso` (llamándola ' +
            'sin filtro previamente).',
          minimum: 1,
        },
        fechaInicio: {
          type: 'string',
          pattern: '\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional). Se envía ' +
            'como ARRAY. Si el usuario no menciona nivel de cuidado, OMITE.',
        },
      },
      required: ['idManejadorCaso'],
    },
  },

  /*──────────────────────────────────────────────────────────────────────────
    Facturación agregada por manejador de caso a través de hospitales

    NO depende de un ID pivote (médico / manejador): siempre devuelve el
    desglose de cuánto dinero se facturó / perdió / recuperó POR CADA
    manejador bajo los filtros aplicados. La IA ordena / filtra el resultado
    según la pregunta del usuario (p. ej. "¿quién perdió más?" → ordenar por
    monto perdido desc, devolver top).

    DIFERENCIA con `consultar_desempeno_manejador_caso`:
      • `desempeno_manejador` → agrupa por MÉTRICAS OPERATIVAS (días, casos).
      • esta → agrupa por MONTOS ($ facturado / perdido / recuperado).
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_facturacion_manejador_hospitales',
    description:
      'Devuelve cuánto dinero se FACTURÓ / PERDIÓ / RECUPERÓ POR MANEJADOR ' +
      'DE CASO en los hospitales / planes / período seleccionados. Es la ' +
      'herramienta indicada para responder preguntas del estilo:\\n' +
      '  • "¿cuánto dinero perdió cada manejador en este hospital?"\\n' +
      '  • "¿qué manejador recuperó más plata en octubre?"\\n' +
      '  • "facturación agregada por manejador — planes Medicare — 2026"\\n\\n' +
      '⚠️ DIFERENCIA IMPORTANTE:\\n' +
      '  • `consultar_desempeno_manejador_caso` agrupa por MÉTRICAS ' +
      'OPERATIVAS (días aprobados / denegados, número de casos, etc.).\\n' +
      '  • ESTA herramienta agrupa por MONTOS ($ facturado / perdido / ' +
      'recuperado). Si la pregunta del usuario menciona "dinero / plata / ' +
      'facturación / monto / $ / pérdida en $ / recuperado en $", usa ESTA ' +
      'herramienta, no la de desempeño.\\n\\n' +
      'CARACTERÍSTICAS:\\n' +
      '  • NO tiene filtro por ID de manejador: el endpoint SIEMPRE devuelve ' +
      'el desglose completo (un manejador por fila) bajo los filtros ' +
      'aplicados. La IA ordena / filtra el resultado según la pregunta.\\n' +
      '  • Si el usuario pregunta por "el manejador que más perdió en ' +
      'octubre", llama con el rango de octubre (`fechaInicio` = 1 de ' +
      'octubre, `fechaFin` = último día del mes) y devuelve el ' +
      'ranking ordenado por monto perdido descendente.\\n\\n' +
      'PRERREQUISITOS:\\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para resolver nombre → ID de planes ' +
      '(si vas a filtrar por plan).\\n' +
      '  • Para `idHospitales` mapea el nombre con `obtener_hospitales_disponibles` ' +
      '(campo `hosId`).\\n' +
      '  • NUNCA inventes `idHospitales` ni `idPlanes`.\\n\\n' +
      'OBTENCIÓN DE PARÁMETROS:\\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\\n' +
      '  • `idHospitales`: int[] REQUERIDO (al menos un hospital). Resuélvelos ' +
      'SIEMPRE antes con `obtener_hospitales_disponibles`. SIEMPRE array.\\n' +
      '  • `idPlanes`: int[] opcional. Si el usuario dice "todos", OMITE el ' +
      'campo (no envíes array vacío).\\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF". SIEMPRE como ARRAY. Si ' +
      'el usuario no menciona nivel de cuidado, OMITE el campo.\\n\\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por manejador, con valores separados por comas ' +
      'o espacios — usa el símbolo $ antes de los montos). NUNCA uses <pre>, ' +
      '<table>, <ul>, <li>, <br>, ni columnas alineadas.\n\n' +
      '📦 ESTRUCTURA DEL PAYLOAD QUE DEVUELVE EL ENDPOINT (úsalo literal, ' +
      'NO renombres NI recalcules nada):\n' +
      '  • `totales`: { cantidadCasos, cantidadPlanes, cantidadManejadores, ' +
      '    montoFacturado, montoPerdido, montoRecuperado, ' +
      '    porcentajeFacturado, porcentajePerdido, porcentajeRecuperado }\n' +
      '  • `hospitales[]`: un elemento por hospital, con sus propios montos ' +
      '    y porcentajes.\n' +
      '  • `manejadores[]`: un elemento por manejador, con los campos ' +
      '    `idManejadorCaso`, `manejador` (nombre), `casos`, ' +
      '    `montoFacturado`, `montoPerdido`, `montoRecuperado`, ' +
      '    `porcentajeFacturado`, `porcentajePerdido`, `porcentajeRecuperado`.\n' +
      '⚠️ NOTA: el campo de porcentaje se llama EXACTAMENTE `porcentajePerdido` ' +
      '(NO `porcentajePerdida`, NO `porcentajePerdidoDeFacturado`, etc.). Si el ' +
      'usuario pregunta por el "% de pérdida", lee directamente el campo ' +
      '`porcentajePerdido` del payload — NO lo calcules dividiendo ' +
      'montoPerdido entre montoFacturado ni sumando nada. NO existe un campo ' +
      '"potencial" explícito: NO inventes esa cifra.',
    input_schema: {
      type: 'object',
      properties: {
        fechaInicio: {
          type: 'string',
          pattern: '\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description:
            'IDs de hospitales (int[] REQUERIDO, al menos uno). Resuélvelos ' +
            'SIEMPRE antes con `obtener_hospitales_disponibles` (campo ' +
            '`hosId`). Ej: "San Lucas" → `[6]`. SIEMPRE array, NUNCA objeto.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías `idPlanes`, OMITE el ' +
            'campo (no envíes array vacío).',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional, array de enum). ' +
            'Se envía SIEMPRE como ARRAY: ej ["ACUTE"], ["SNF"] o ' +
            '["ACUTE","SNF"]. Si el usuario no menciona nivel, OMITE el campo.',
        },
      },
      required: ['idHospitales'],
    },
  },

  /*──────────────────────────────────────────────────────────────────────────
    Facturación agregada por AUDITOR a través de hospitales

    Espejo de `consultar_facturacion_manejador_hospitales`, pero agrupada
    por AUDITOR (la persona que firma / revisa la auditoría) en vez de por
    manejador de caso. Mismos filtros, misma estructura de payload.

    DIFERENCIAS clave con la tool de manejador:
      • `*_facturacion_manejador_*`  → un manejador por fila.
      • ESTA                           → un auditor por fila.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_facturacion_auditor_hospitales',
    description:
      'Devuelve cuánto dinero se FACTURÓ / PERDIÓ / RECUPERÓ POR AUDITOR ' +
      'en los hospitales / planes / período seleccionados. Es la herramienta ' +
      'indicada para responder preguntas del estilo:\\n' +
      '  • "¿cuánto dinero perdió cada auditor en este hospital?"\\n' +
      '  • "¿qué auditor recuperó más plata en octubre?"\\n' +
      '  • "facturación agregada por auditor — planes Medicare — 2026"\\n\\n' +
      '⚠️ DISTINCIÓN IMPORTANTE:\\n' +
      '  • `consultar_facturacion_manejador_hospitales` agrupa por MANEJADOR ' +
      'DE CASO.\\n' +
      '  • ESTA herramienta agrupa por AUDITOR (la persona que firma / revisa ' +
      'la auditoría). Son roles distintos: el manejador es quien ADMINISTRA ' +
      'el caso; el auditor es quien lo FIRMA / REVISA. Si dudas cuál usar, ' +
      'pregúntale al usuario.\\n\\n' +
      'CARACTERÍSTICAS:\\n' +
      '  • NO tiene filtro por ID de auditor: el endpoint SIEMPRE devuelve ' +
      'el desglose completo (un auditor por fila) bajo los filtros aplicados. ' +
      'La IA ordena / filtra el resultado según la pregunta.\\n' +
      '  • Si el usuario pregunta por "el auditor que más perdió en octubre", ' +
      'llama con el rango de octubre (`fechaInicio` = 1 de octubre, ' +
      '`fechaFin` = último día del mes) y devuelve el ranking ' +
      'ordenado por monto perdido descendente.\\n\\n' +
      'PRERREQUISITOS:\\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para resolver nombre → ID de planes ' +
      '(si vas a filtrar por plan).\\n' +
      '  • Para `idHospitales` mapea el nombre con `obtener_hospitales_disponibles` ' +
      '(campo `hosId`).\\n' +
      '  • NUNCA inventes `idHospitales` ni `idPlanes`.\\n\\n' +
      'OBTENCIÓN DE PARÁMETROS:\\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\\n' +
      '  • `idHospitales`: int[] REQUERIDO (al menos un hospital). Resuélvelos ' +
      'SIEMPRE antes con `obtener_hospitales_disponibles`. SIEMPRE array.\\n' +
      '  • `idPlanes`: int[] opcional. Si el usuario dice "todos", OMITE el ' +
      'campo (no envíes array vacío).\\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF". SIEMPRE como ARRAY. Si ' +
      'el usuario no menciona nivel de cuidado, OMITE el campo.\\n\\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por auditor, con valores separados por comas ' +
      'o espacios — usa el símbolo $ antes de los montos). NUNCA uses <pre>, ' +
      '<table>, <ul>, <li>, <br>, ni columnas alineadas.\\n\\n' +
      '📦 ESTRUCTURA DEL PAYLOAD QUE DEVUELVE EL ENDPOINT (úsalo literal, ' +
      'NO renombres NI recalcules nada):\\n' +
      '  • `totales`: { cantidadCasos, cantidadPlanes, cantidadAuditores, ' +
      '    montoFacturado, montoPerdido, montoRecuperado, ' +
      '    porcentajeFacturado, porcentajePerdido, porcentajeRecuperado }\\n' +
      '  • `hospitales[]`: un elemento por hospital, con sus propios montos ' +
      'y porcentajes.\\n' +
      '  • `auditores[]`: un elemento por auditor, con los campos ' +
      '    `idAuditor`, `auditor` (nombre), `casos`, ' +
      '    `montoFacturado`, `montoPerdido`, `montoRecuperado`, ' +
      '    `porcentajeFacturado`, `porcentajePerdido`, `porcentajeRecuperado`.\\n' +
      '⚠️ NOTA: el campo de porcentaje se llama EXACTAMENTE `porcentajePerdido` ' +
      '(NO `porcentajePerdida`, NO `porcentajePerdidoDeFacturado`, etc.). Si el ' +
      'usuario pregunta por el "% de pérdida", lee directamente el campo ' +
      '`porcentajePerdido` del payload — NO lo calcules dividiendo ' +
      'montoPerdido entre montoFacturado ni sumando nada. NO existe un campo ' +
      '"potencial" explícito: NO inventes esa cifra.',
    input_schema: {
      type: 'object',
      properties: {
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description:
            'IDs de hospitales (int[] REQUERIDO, al menos uno). Resuélvelos ' +
            'SIEMPRE antes con `obtener_hospitales_disponibles` (campo ' +
            '`hosId`). Ej: "San Lucas" → `[6]`. SIEMPRE array, NUNCA objeto.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías `idPlanes`, OMITE el ' +
            'campo (no envíes array vacío).',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional, array de enum). ' +
            'Se envía SIEMPRE como ARRAY: ej ["ACUTE"], ["SNF"] o ' +
            '["ACUTE","SNF"]. Si el usuario no menciona nivel, OMITE el campo.',
        },
      },
      required: ['idHospitales'],
    },
  },

  /*──────────────────────────────────────────────────────────────────────────
    Desempeño de auditores + Determinación adversa del auditor

    Espejo de las dos tools de médico / manejador, pero referidas al
    AUDITOR (la persona que firma / revisa la auditoría). Su identificador es
    `idAuditor`.

    Misma mecánica MODO CATÁLOGO → MODO CONSULTA: para resolver
    nombre → `idAuditor`, la IA debe llamar primero a
    `consultar_desempeno_auditor` SIN pasar `idAuditor` y usar la respuesta
    para mapear.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_desempeno_auditor',
    description:
      'Devuelve el desempeño de los AUDITORES que han firmado/revisado ' +
      'auditorías en el período y filtros seleccionados (días aprobados / ' +
      'denegados / recuperados, montos, número de auditorías, etc., agrupado ' +
      'por auditor).\\n\\n' +
      '⚠️ DISTINCIÓN IMPORTANTE: "auditor" es la persona que FIRMA/REVISA la ' +
      'auditoría. NO es lo mismo que:\\n' +
      '  • el MÉDICO DE ALTA (quien firma el alta médica del paciente) → usa ' +
      '`consultar_desempeno_medico`.\\n' +
      '  • el MANEJADOR DE CASO (quien administra/coordina el caso) → usa ' +
      '`consultar_desempeno_manejador_caso`.\\n' +
      'Si el usuario no aclara, pregúntale a cuál rol se refiere antes de ' +
      'elegir herramienta.\\n\\n' +
      'MODOS DE USO:\\n' +
      '  • MODO CATÁLOGO: si NO se envía `idAuditor`, el endpoint devuelve ' +
      'el listado de auditores disponibles para los filtros aplicados. USA ' +
      'este modo cuando necesites mapear un nombre a su `idAuditor`.\\n' +
      '  • MODO CONSULTA: si SÍ se envía `idAuditor`, devuelve solo los KPIs ' +
      'de ese auditor.\\n\\n' +
      'PRERREQUISITOS:\\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de ' +
      'planes (ids + nombres).\\n' +
      '  • Para resolver nombre → `idAuditor`: llama primero a esta misma ' +
      'tool SIN `idAuditor` (MODO CATÁLOGO) y luego vuelve a llamarla con el ' +
      'ID ya resuelto.\\n' +
      '  • NUNCA inventes `idPlanes` ni `idAuditor` — usa los IDs devueltos ' +
      'por las herramientas de catálogo.\\n\\n' +
      'OBTENCIÓN DE PARÁMETROS:\\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\\n' +
      '  • `idPlanes`: int[] opcional. Llama antes a ' +
      '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.\\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF". Si el usuario no ' +
      'menciona nivel de cuidado, OMITE el campo.\\n' +
      '  • `idAuditor`: int opcional. Si el usuario preguntó por un auditor ' +
      'CONCRETO, llámala primero en MODO CATÁLOGO para resolver el ID y ' +
      'luego repítela pasándolo.\\n\\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\\n' +
      '  • Si envías `idPlanes` → el backend devuelve el detalle agrupado POR ' +
      'PLAN (útil para responder "¿en qué plan X se concentran los días ' +
      'denegados del auditor Y?" o "¿cuánto perdió cada plan para este ' +
      'auditor?"). SIEMPRE lista primero el catálogo con ' +
      '`obtener_planes_disponibles` para tener los IDs reales.\\n' +
      '  • Si OMITES `idPlanes` (o envías array vacío) → el backend devuelve ' +
      'el resultado GLOBAL del auditor, sin desglose por plan.\\n' +
      '  • Para la pregunta "¿en qué plan se le deniegan más días al ' +
      'auditor X?" PASA `idPlanes` con la lista completa del catálogo.\\n' +
      '  • Para "días denegados totales del auditor X sin importar el plan" ' +
      'OMITE `idPlanes`.\\n\\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por auditor, con valores separados por comas o ' +
      'espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas ' +
      'alineadas.',
    input_schema: {
      type: 'object',
      properties: {
        idHospitales: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description:
            'IDs de hospitales (int[] REQUERIDO, al menos uno). Resuélvelos ' +
            'SIEMPRE antes con `obtener_hospitales_disponibles` (campo ' +
            '`hosId`). SIEMPRE array, NUNCA objeto.',
        },
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías `idPlanes`, OMITE el ' +
            'campo.',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional, array de enum). ' +
            'Se envía SIEMPRE como ARRAY. Si el usuario no menciona nivel, OMITE.',
        },
        idAuditor: {
          type: 'integer',
          description:
            'ID del auditor (opcional, int>0). Si se OMITE, el endpoint ' +
            'devuelve el catálogo de auditores disponibles bajo los otros ' +
            'filtros (modo catálogo). Si el usuario pidió un auditor CONCRETO ' +
            'por nombre, PRIMERO llama sin este parámetro, identifica el ID ' +
            'en el catálogo, y VUELVE a llamar pasándolo.',
          minimum: 1,
        },
      },
      required: ['idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_auditor',
    description:
      'Devuelve el/los concepto(s) de determinación adversa que MÁS se ' +
      'repiten en las auditorías firmadas/revisadas por el AUDITOR ' +
      '(`idAuditor`) dentro del período y filtros seleccionados.\\n\\n' +
      '⚠️ DISTINCIÓN IMPORTANTE: "auditor" es la persona que FIRMA/REVISA ' +
      'la auditoría. NO es lo mismo que:\\n' +
      '  • el MÉDICO DE ALTA (firma del alta) → usa ' +
      '`consultar_determinacion_adversa_medico_alta`.\\n' +
      '  • el MANEJADOR DE CASO (administra/coordina el caso) → usa ' +
      '`consultar_determinacion_adversa_manejador_caso`.\\n\\n' +
      'CASO DE USO TÍPICO: "¿cuál es la determinación adversa más frecuente ' +
      'que deniega las auditorías firmadas por el auditor X?" / "¿qué ' +
      'concepto sigue rechazando el auditor 18?".\\n\\n' +
      'PRERREQUISITOS:\\n' +
      '  • `idAuditor` ES OBLIGATORIO para esta herramienta. El endpoint NO ' +
      'devuelve el catálogo de auditores — solo devuelve KPIs del auditor ' +
      'que se le pasa.\\n' +
      '  • `idHospitales` ES OBLIGATORIO (int[], ≥1). El backend devuelve ' +
      'HTTP 400 si falta. Resuélvelos antes con ' +
      '`obtener_hospitales_disponibles` (campo `hosId`).\\n' +
      '  • Para resolver nombre → `idAuditor`: llama primero a ' +
      '`consultar_desempeno_auditor` en MODO CATÁLOGO (sin `idAuditor`), ' +
      'identifica el ID, y VUELVE a llamar a esta herramienta pasándolo.\\n' +
      '  • Antes de invocar esta tool, DEBES llamar antes a ' +
      '`obtener_planes_disponibles` para tener el catálogo actualizado de ' +
      'planes.\\n' +
      '  • NUNCA inventes `idPlanes` ni `idAuditor` — usa los IDs devueltos ' +
      'por las herramientas de catálogo.\\n\\n' +
      'OBTENCIÓN DE PARÁMETROS:\\n' +
      '  • `idAuditor`: int REQUERIDO (>=1). Si no lo tienes resuelto, ' +
      'pregunta el nombre al usuario o usa el catálogo de ' +
      '`consultar_desempeno_auditor` sin filtro.\\n' +
      '  • `fechaInicio` / `fechaFin`: string (YYYY-MM-DD) — el PERÍODO como rango, ' +
      'con ambos extremos INCLUSIVOS. Esta tool NO usa `anio` / `meses` / `dia`: ' +
      'el backend filtra por rango de fechas. Manda SIEMPRE las dos fechas:\\n' +
      '    - "de marzo a octubre" / "del 5 al 9 de marzo" / "entre enero y junio" → ' +
      '`fechaInicio` = primer día del rango, `fechaFin` = último día.\\n' +
      '    - "octubre" / "en octubre" → mes completo (del día 1 al último del mes).\\n' +
      '    - "el 15 de octubre" → `fechaInicio` = `fechaFin` = ese día.\\n' +
      '    - "2025" / "en 2025" → `2025-01-01` a `2025-12-31`.\\n' +
      '    - El usuario NO menciona período → AÑO EN CURSO COMPLETO: `fechaInicio` = ' +
      '1 de enero del año en curso, `fechaFin` = 31 de diciembre del año en curso. ' +
      'NO preguntes por el período.\\n' +
      '  • `idPlanes`: int[] opcional. Llama antes a ' +
      '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.\\n' +
      '  • `loc`: array opcional de "ACUTE" / "SNF".\\n\\n' +
      '🧠 CONTRATO DE FILTRO POR PLANES (CRÍTICO):\\n' +
      '  • Si envías `idPlanes` → el backend devuelve los conceptos de ' +
      'determinación adversa FILTRADOS solo a esos planes. Útil para ' +
      'responder "¿qué conceptos deniegan más en el plan X para este ' +
      'manejador/auditor?".\\n' +
      '  • Si OMITES `idPlanes` → el backend devuelve los conceptos ' +
      'considerando TODOS los planes aplicables (global sin filtro de plan).\\n\\n' +
      'FORMATO DE SALIDA: usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por concepto). NUNCA uses <pre>, <table>, <ul>, ' +
      '<li>, <br>, ni columnas alineadas.',
    input_schema: {
      type: 'object',
      properties: {
        idHospitales: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description:
            'IDs de hospitales (int[] REQUERIDO, al menos uno). Resuélvelos ' +
            'SIEMPRE antes con `obtener_hospitales_disponibles` (campo ' +
            '`hosId`). SIEMPRE array, NUNCA objeto.',
        },
        idAuditor: {
          type: 'integer',
          description:
            'ID del auditor (REQUERIDO, int>=1). Resuélvelo con el catálogo ' +
            'de `consultar_desempeno_auditor` (llamándola sin filtro ' +
            'previamente).',
          minimum: 1,
        },
        fechaInicio: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Primer día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-03-01". Si el usuario no menciona período, usa el 1 de enero ' +
            'del año en curso.',
        },
        fechaFin: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description:
            'Último día del período (INCLUSIVO), formato YYYY-MM-DD. Ej: ' +
            '"2026-04-30". Si el usuario no menciona período, usa el 31 de ' +
            'diciembre del año en curso. NO puede ser anterior a `fechaInicio`.',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes a incluir (opcional, int[]). Resuélvelos con ' +
            '`obtener_planes_disponibles`. Si NO envías, OMITE el campo.',
        },
        loc: {
          type: 'array',
          items: { type: 'string', enum: ['ACUTE', 'SNF'] },
          description:
            'Filtro por Location / Nivel de cuidado (opcional). Se envía ' +
            'como ARRAY. Si el usuario no menciona nivel de cuidado, OMITE.',
        },
      },
      required: ['idAuditor', 'idHospitales'],
    },
  },
];
