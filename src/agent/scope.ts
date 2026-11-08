// src/agent/scope.ts
// ───────────────────────────────────────────────────────────────────────────
// ALCANCE DE DATOS DE AUDITA.
//
// Aida solo puede responder sobre lo que las tools de `tools.ts` realmente
// traen. Este módulo es la ÚNICA fuente de verdad de:
//
//   1. `ALCANCE_DATOS` — el bloque de prompt que declara qué tenemos y qué no.
//   2. `detectarConsultaFueraDeAlcance()` — el detector determinista que
//      reconoce en el mensaje del usuario una entidad que NO existe en
//      Audita (enfermeras, pacientes, nómina, copagos, …).
//   3. `mensajeFueraDeAlcance()` — la respuesta canónica de negativa.
//
// Por qué existe: sin esto, el modelo "resuelve" una pregunta por enfermería
// llamando a `consultar_desempeno_medico` y devuelve el ranking de MÉDICOS
// como si fueran enfermeras. Eso es sustitución de entidad: un dato que NO
// es el que se pidió. Aquí se corta ese comportamiento en dos niveles:
// el prompt (para que el modelo rechace bien) y el código (para que no
// dependa de que el modelo obedezca).
// ───────────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/* 1. DEFINICIÓN DEL ALCANCE                                           */
/* ------------------------------------------------------------------ */

/** Lo que Audita SÍ tiene: entidades y dimensiones consultables. */
export const DIMENSIONES_DISPONIBLES = [
  'Hospitales (catálogo de hospitales activos).',
  'Planes médicos: categorías, planes, niveles de cuidado (PlanNivel) y nivel de atención (ACUTE / SNF).',
  'Indicadores operativos en días: días aprobados, días denegados, días recuperados y días de estancia (LOS).',
  'Indicadores financieros: facturado, perdido, recuperado, potencial recuperable y sus porcentajes.',
  'Determinaciones adversas (conceptos / motivos de denegación) con sus días, montos y porcentajes.',
  'Auditores: desempeño (días y montos) y determinaciones asociadas.',
  'Manejadores de caso: desempeño (días y montos) y determinaciones asociadas.',
  'Médicos de alta: desempeño (días y montos) y determinaciones asociadas.',
  'Conteo agregado de auditorías / casos.',
] as const;

/** Lo que Audita NO tiene. Nunca debe inventarse ni sustituirse. */
export const ENTIDADES_NO_DISPONIBLES = [
  'Personal de enfermería (enfermeras, enfermeros, MSN) ni cualquier otro personal de soporte (fisiatras, terapeutas ocupacionales, trabajadores sociales, farmacéuticos).',
  'Datos individuales de pacientes: admisiones, diagnósticos, expediente clínico, notas, medicamentos, signos vitales, estudios de laboratorio o imagen.',
  'Facturación al paciente: copagos, deducibles, balances y cuentas por cobrar.',
  'Recursos humanos: nómina, salarios, productividad individual, ausentismo, rotación y clima laboral.',
  'Cualquier otro empleado que no sea auditor, manejador de caso o médico de alta.',
] as const;

/**
 * Bloque ESTÁTICO del system prompt (cacheable).
 * Se inyecta al principio del prompt para que el modelo sepa el límite
 * ANTES de decidir qué tool llamar.
 */
export const ALCANCE_DATOS: string = [
  '═══════════════════════════════════════════════════════════════════════',
  '  ALCANCE DE DATOS — QUÉ TENEMOS Y QUÉ NO',
  '═══════════════════════════════════════════════════════════════════════',
  '',
  'SÍ TENEMOS (y NADA más que esto):',
  ...DIMENSIONES_DISPONIBLES.map((d) => `- ${d}`),
  '',
  'NO TENEMOS:',
  ...ENTIDADES_NO_DISPONIBLES.map((d) => `- ${d}`),
  '',
  '🚫 REGLA DE ALCANCE (OBLIGATORIA, PRIORIDAD MÁXIMA):',
  '  1) Si lo que el usuario pide NO está en la lista "SÍ TENEMOS", NO lo atiendas:',
  '     no llames herramientas para eso, no inventes cifras, nombres ni rankings.',
  '  2) Responde con una negativa breve y clara + el catálogo de lo que sí tienes. Plantilla:',
  '     "No tenemos información sobre <lo que pidió>. Los datos que sí manejamos son de auditoría',
  '     hospitalaria: hospitales, planes médicos, días aprobados, denegados y recuperados, días de',
  '     estancia (LOS), facturación (facturado, perdido, recuperado y potencial recuperable),',
  '     determinaciones adversas, y el desempeño de auditores, manejadores de caso y médicos de alta."',
  '  3) 🚫 NUNCA SUSTITUYAS la entidad pedida por otra que sí tienes. Si piden "la enfermera que',
  '     más días denegados tiene" y tú solo tienes médicos de alta, NO respondas con el ranking',
  '     de médicos: es OTRO dato, no el que preguntaron, y presentarlo como respuesta es incorrecto.',
  '  4) Si el mensaje trae DOS partes (una dentro del alcance y otra fuera), atiende la que SÍ está',
  '     en el alcance con sus herramientas y declara aparte, de forma breve, que la otra no está disponible.',
  '  5) Ante la duda de si algo está dentro del alcance, trátalo como FUERA del alcance y ofrece lo',
  '     que sí tienes. Es preferible decir "no tenemos ese dato" a devolver el dato equivocado.',
].join('\n');

/* ------------------------------------------------------------------ */
/* 2. DETECTOR DE ENTIDADES FUERA DE ALCANCE                           */
/* ------------------------------------------------------------------ */

interface ReglaFueraDeAlcance {
  /** Etiqueta legible (con artículo) para el mensaje de negativa. */
  etiqueta: string;
  /** Patrones que detectan la entidad en el mensaje del usuario. */
  patrones: RegExp[];
}

/**
 * Menciones que NORMALIZAMOS antes de detectar, porque son de alcance VÁLIDO:
 * "enfermería especializada" es el SNF (nivel de cuidado), no personal de
 * enfermería. Sin esta limpieza, "SNF" o "enfermería especializada"
 * dispararían un falso positivo y bloquearían una consulta legítima.
 */
const MENCIONES_DE_ALCANCE_VALIDO: Array<{
  patron: RegExp;
  sustituto: string;
}> = [
  // SNF = Skilled Nursing Facility = centro de enfermería especializada.
  {
    patron:
      /\b(?:enfermer[ií]a|centros? de enfermer[ií]a|servicio de enfermer[ií]a)\s+especializad[oa]\b/gi,
    sustituto: ' ',
  },
  { patron: /\bskilled\s+nursing(\s+facility)?\b/gi, sustituto: ' ' },
  { patron: /\bnursing\s+home\b/gi, sustituto: ' ' },
  // "SNF" (siglas del nivel de cuidado).
  { patron: /\bSNF\b/g, sustituto: ' ' },
  // "ingreso perdido" es el potencial recuperable (indicador EN ALCANCE).
  { patron: /\bingreso\s+perdido\b/gi, sustituto: ' ' },
  { patron: /\bingreso\s+potencial\b/gi, sustituto: ' ' },
];

/**
 * Entidades que NO existen en Audita. Cada entrada agrupa los sinónimos de
 * una misma familia para poder responder "no tenemos información sobre X".
 *
 * IMPORTANTE:
 *  - Son SUJETOS de la pregunta (a quién/qué se le atribuye el dato).
 *  - "médico", "auditor" y "manejador de caso" NO aparecen aquí: sí están
 *    en el alcance.
 *  - "readmisión" NO aparece aquí: es un ejemplo de determinación adversa.
 */
const REGLAS_FUERA_DE_ALCANCE: ReglaFueraDeAlcance[] = [
  {
    etiqueta: 'el personal de enfermería',
    patrones: [
      /\benfermer[oa]s?\b/i,
      /\benfermer[íi]a\b/i,
      /\bpersonal de enfermer[ií]a\b/i,
      /\bMSN\b/i,
      /\bregistered nurse\b/i,
      /\bnurses?\b/i,
      /\bnursing staff\b/i,
      /\bhead nurse\b/i,
    ],
  },
  {
    etiqueta:
      'el personal de soporte (fisiatras, terapeutas ocupacionales, trabajadores sociales o farmacéuticos)',
    patrones: [
      /\bfisiatras?\b/i,
      /\bfisioterapeut[oa]s?\b/i,
      /\bfisio(?:terapia|terapeuta)?\b/i,
      /\bkinesi[óo]logos?\b/i,
      /\bterapeutas? ocupacional(?:es)?\b/i,
      /\bterapia ocupacional\b/i,
      /\bterapia f[ií]sica\b/i,
      /\btrabajador(?:a|es)? social(?:es)?\b/i,
      /\bfarmac[eé]uticos?\b/i,
      /\bfarmacia\b/i,
    ],
  },
  {
    etiqueta: 'los datos individuales de los pacientes',
    patrones: [
      /\bpacientes?\b/i,
      /\bpatients?\b/i,
      /\badmisiones?\b/i,
      /\badmissions?\b/i,
      /\bexpedientes?\b/i,
      /\bhistorias? cl[ií]nicas?\b/i,
      /\bhistorial(?:es)? cl[ií]nic[oa]s?\b/i,
      /\brecords? m[ée]dicos?\b/i,
      /\bdiagn[óo]sticos?\b/i,
      /\bc[óo]digos? (?:icd|cie)\b/i,
      /\bmedicamentos?\b/i,
      /\bprescripciones?\b/i,
      /\bmedicaci[óo]n(?:es)?\b/i,
      /\bsignos? vitales?\b/i,
      /\blaboratorios?\b/i,
      /\bestudios? de imagen\b/i,
      /\bresonancia(?: magn[ée]tica)?\b/i,
      /\brayos? x\b/i,
    ],
  },
  {
    etiqueta: 'la facturación al paciente (copagos, deducibles y balances)',
    patrones: [
      /\bcopagos?\b/i,
      /\bco-?pagos?\b/i,
      /\bdeducibles?\b/i,
      /\bself[- ]?pay\b/i,
      /\bbalance(?:s)? (?:del|de la|de los) paciente/i,
      /\bcuentas? por cobrar (?:del|de la|de los) paciente/i,
      /\bpagos? (?:del|de la|de los) paciente/i,
    ],
  },
  {
    etiqueta:
      'los datos de recursos humanos (nómina, salarios y productividad individual)',
    patrones: [
      /\bn[óo]mina\b/i,
      /\bsalarios?\b/i,
      /\bsueldos?\b/i,
      /\bplanilla/i,
      /\bremuneraci[óo]n\b/i,
      /\bausentismo\b/i,
      /\brotaci[óo]n de personal\b/i,
      /\bclima laboral\b/i,
      /\bproductividad (?:por|de) (?:empleado|trabajador|personal|enfermer)/i,
      /\bempleados?\b/i,
    ],
  },
  {
    etiqueta: 'los expedientes y números de identificación',
    patrones: [
      /\bexpediente electr[óo]nico\b/i,
      /\bn[uú]mero de expediente\b/i,
      /\bexpediente de empleado\b/i,
      /\bn[uú]mero de empleado\b/i,
    ],
  },
];

/** Persona (o rol) que Audita SÍ conoce. Su presencia hace que el mensaje sea mixto. */
const ROLES_EN_ALCANCE =
  /\b(auditor(?:es)?|auditor[íi]as?|manejador(?:es)? de caso|manejadores?|m[ée]dicos?|m[ée]dicas?|doctor(?:es)?|doctoras?|dr\.?|drs\.?)\b/i;

export interface DeteccionFueraDeAlcance {
  /** true si el mensaje pide un dato que Audita no tiene. */
  fuera: boolean;
  /** Etiquetas legibles de las entidades detectadas (sin duplicados). */
  entidades: string[];
  /** Fragmentos literales que dispararon la detección (para verificar la respuesta). */
  matches: string[];
  /** Texto normalizado sobre el que se hizo la detección. */
  mensajeNormalizado: string;
  /** true si el mensaje también menciona un rol que SÍ está en el alcance. */
  tieneParteEnAlcance: boolean;
}

/**
 * Normaliza el mensaje: quita las menciones que son de alcance VÁLIDO
 * ("enfermería especializada", "SNF", "ingreso perdido") para que no
 * generen falsos positivos.
 */
export function normalizarMensaje(mensaje: string): string {
  let out = mensaje ?? '';
  for (const { patron, sustituto } of MENCIONES_DE_ALCANCE_VALIDO) {
    out = out.replace(patron, sustituto);
  }
  return out;
}

/**
 * Detecta si el usuario pide información sobre una entidad que Audita no
 * tiene. Determinista (no depende del LLM).
 */
export function detectarConsultaFueraDeAlcance(
  mensaje: string,
): DeteccionFueraDeAlcance {
  const normalizado = normalizarMensaje(mensaje ?? '');
  const entidades: string[] = [];
  const matches: string[] = [];

  for (const regla of REGLAS_FUERA_DE_ALCANCE) {
    for (const patron of regla.patrones) {
      const m = normalizado.match(patron);
      if (m && m.length > 0) {
        if (!entidades.includes(regla.etiqueta)) entidades.push(regla.etiqueta);
        for (const hit of m) {
          if (!matches.includes(hit)) matches.push(hit);
        }
      }
    }
  }

  return {
    fuera: entidades.length > 0,
    entidades,
    matches,
    mensajeNormalizado: normalizado,
    tieneParteEnAlcance: ROLES_EN_ALCANCE.test(normalizado),
  };
}

/* ------------------------------------------------------------------ */
/* 3. RESPUESTA CANÓNICA DE NEGATIVA                                   */
/* ------------------------------------------------------------------ */

export type Idioma = 'es' | 'en';

/**
 * Detecta el idioma del mensaje del usuario para responder en el mismo
 * idioma (regla IDIOMA del system prompt).
 */
export function detectarIdioma(mensaje: string): Idioma {
  const t = (mensaje ?? '').toLowerCase();
  const es = (
    t.match(
      /\b(el|la|los|las|de|que|cual|cu[aá]l|con|para|m[aá]s|d[ií]as|auditor|m[eé]dico|enfermer|hospital|plan|por)\b/g,
    ) ?? []
  ).length;
  const en = (
    t.match(
      /\b(the|which|of|is|are|with|for|more|days|nurse|nursing|doctor|auditor|hospital|plan|most|least)\b/g,
    ) ?? []
  ).length;
  if (en > es) return 'en';
  return 'es';
}

/** Une una lista en español/inglés con la conjunción final. */
function unirLista(items: string[], conjuncion = 'y'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ${conjuncion} ${items[items.length - 1]}`;
}

/**
 * Construye la respuesta de negativa. Es determinista: nunca depende de que
 * el modelo haya cooperado.
 */
export function mensajeFueraDeAlcance(
  entidades: string[],
  idioma: Idioma = 'es',
): string {
  const lista = unirLista(
    entidades.length > 0 ? entidades : ['ese dato'],
    idioma === 'en' ? 'and' : 'y',
  );

  if (idioma === 'en') {
    return (
      `We don't have information about ${lista}. ` +
      'The data we do have is hospital audit data: hospitals, medical plans, ' +
      'approved / denied / recovered days and length of stay (LOS), billing ' +
      '(billed, lost, recovered and recoverable potential), adverse ' +
      'determinations, and the performance of auditors, case handlers and ' +
      'attending physicians.'
    );
  }

  return (
    `No tenemos informaci\u00f3n sobre ${lista}. ` +
    'Los datos que s\u00ed manejamos son de auditor\u00eda hospitalaria: hospitales, planes m\u00e9dicos, ' +
    'd\u00edas aprobados, denegados y recuperados, d\u00edas de estancia (LOS), ' +
    'facturaci\u00f3n (facturado, perdido, recuperado y potencial recuperable), ' +
    'determinaciones adversas, y el desempe\u00f1o de auditores, manejadores de caso ' +
    'y m\u00e9dicos de alta.'
  );
}

/* ------------------------------------------------------------------ */
/* 4. DIRECTIVA DINÁMICA PARA EL TURNO                                 */
/* ------------------------------------------------------------------ */

/**
 * Nota dinámica que se añade al final del system prompt cuando el detector
 * marca el turno. Va al final a propósito del bloque cacheable.
 */
export function directivaFueraDeAlcance(
  entidades: string[],
  tieneParteEnAlcance: boolean,
  idioma: Idioma = 'es',
): string {
  const lista = unirLista(entidades, idioma === 'en' ? 'and' : 'y');

  if (idioma === 'en') {
    return [
      '\u26a0\ufe0f OUT-OF-SCOPE QUESTION DETECTED IN THE LAST USER MESSAGE:',
      `The user asked about: ${lista}.`,
      'RULES FOR THIS TURN:',
      '1. Do NOT call any tool to answer that part.',
      '2. Do NOT invent figures, names or rankings for it.',
      '3. Do NOT substitute another entity you do have (auditor, case handler, physician) ' +
        'for the one requested — that is a different metric and it is wrong.',
      '4. Answer that part with a short, clear refusal plus the list of what you do have ' +
        '(see the ALCANCE DE DATOS block).',
      tieneParteEnAlcance
        ? '5. If the message also contains an in-scope question, answer THAT part normally ' +
          'with its tools, and state separately that the other part is not available.'
        : '5. This message is entirely out of scope: answer ONLY with the refusal.',
    ].join('\n');
  }

  return [
    '\u26a0\ufe0f CONSULTA FUERA DEL ALCANCE DE DATOS (detectada en el \u00faltimo mensaje del usuario):',
    `El usuario pregunt\u00f3 por: ${lista}.`,
    'REGLAS PARA ESTE TURNO:',
    '1. NO llames a ninguna herramienta para responder esa parte.',
    '2. NO inventes cifras, nombres ni rankings sobre eso.',
    '3. NO sustituyas esa entidad por otra que s\u00ed tienes (auditor, manejador de caso, ' +
      'm\u00e9dico de alta): es otro dato y la respuesta quedar\u00eda mal.',
    '4. Responde esa parte con una negativa breve y clara + la lista de lo que s\u00ed manejas ' +
      '(ver bloque "ALCANCE DE DATOS").',
    tieneParteEnAlcance
      ? '5. Si el mensaje tambi\u00e9n trae una consulta dentro del alcance, atiende ESA parte ' +
        'con sus herramientas y declara aparte que la otra no est\u00e1 disponible.'
      : '5. Este mensaje es totalmente fuera de alcance: responde SOLO con la negativa.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 5. VERIFICACIÓN DE LA RESPUESTA DEL MODELO                          */
/* ------------------------------------------------------------------ */

/**
 * Marcadores FUERTES de un rechazo válido: por sí solos prueban que el
 * modelo se negó (y no que respondió datos).
 */
const MARCADORES_RECHAZO_FUERTE: RegExp[] = [
  // Español
  /\bno (tenemos|cuento con|disponemos de)\b/i,
  /\bnunca (se )?(registr[oó]|guard[oó]|disponible|tiene|hay)\b/i,
  /\bsolo (tenemos|cuento con|disponemos de|maneja)\b/i,
  /\bno (est[áa]|est[ée]|est[áa]n|est[ée]n|est[á]?) (disponible|registrad[oa]s?|cubiert[oa]s?|presentes?)\b/i,
  /\bno (puedo|podemos|podr[ií]a|podr[ií]amos) (consultar|obtener|dar|proporcionar|reportar|mostrar|ver)\b/i,
  /\bno (hay|tenemos|tiene) (datos|informaci[óo]n|registros|nombres|ranking|rankings) (de|sobre|para)\b/i,
  /\bno (hay|tenemos|tiene) (datos|informaci[oó]n|registros)\b/i,
  /\bno (incluye|incluyen|contiene|contienen|cubre|cubren|registra|registran|existe|existen)\b/i,
  /\bfuera de (mi |nuestro )?alcance\b/i,
  // English
  /\bwe (do not|don't) (have|track|store)\b/i,
  /\bno (information|data|records) (is |are )?available\b/i,
  /\bnot (tracked|available|recorded)\b/i,
  /\bwe only (have|track|store|handle)\b/i,
  /\bunavailable\b/i,
  /\bdo not track\b/i,
];

/**
 * Marcadores DÉBILES: solo prueban un rechazo si la respuesta además
 * menciona la entidad por la que el usuario preguntó.
 */
const MARCADORES_RECHAZO_DEBIL: RegExp[] = [
  /\bno (hay|existe|existen|tiene|tenemos)\b/i,
  /\bno (puedo|podemos)\b/i,
  /\bnunca\b/i,
  /\bno se (registra|guarda|disponible)\b/i,
  /\bwe (do not|don't)\b/i,
  /\bno\b/i,
];

/**
 * ¿La respuesta del modelo es un rechazo válido de la parte fuera de alcance?
 *
 * Si NO lo es (el modelo respondió con un ranking, una cifra o sustituyó la
 * entidad), el llamador reemplaza la respuesta por el mensaje canónico.
 */
export function pareceRechazoDeAlcance(
  texto: string,
  matches: string[] = [],
): boolean {
  if (!texto || !texto.trim()) return false;

  if (MARCADORES_RECHAZO_FUERTE.some((re) => re.test(texto))) return true;

  // Solo hay un rechazo si además menciona lo que el usuario pidió.
  const mencionaEntidad =
    matches.length > 0 &&
    matches.some((m) => {
      const limpio = m.trim().toLowerCase();
      return limpio.length > 2 && texto.toLowerCase().includes(limpio);
    });

  if (!mencionaEntidad) return false;

  return MARCADORES_RECHAZO_DEBIL.some((re) => re.test(texto));
}
