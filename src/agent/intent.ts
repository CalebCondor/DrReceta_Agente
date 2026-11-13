// src/agent/intent.ts
// ───────────────────────────────────────────────────────────────────────────
// DETECCIÓN DE "CONSULTA SIN INDICADOR DECLARADO" + MENÚ PROACTIVO.
//
// CASO DE USO:
//   "A cuál hospital le va mejor?"
//   "Cuál hospital es el mejor?"
//   "dame los 5 mejores hospitales"
//   "compara San Lucas y Bayamón"
//
// Esas preguntas NO dicen qué se quiere medir (días denegados, % de
// denegación, monto perdido, facturación, determinaciones, desempeño por
// profesional…). Cada métrica ordena los hospitales de forma distinta, así
// que asumir una produce una respuesta incorrecta.
//
// SIN este módulo el comportamiento era errático (verificado en ejecución):
//   · "Cuál hospital es el mejor?"      → ASUMÍA el % de denegación y
//                                          respondía con un ranking.
//   · "dame los 5 mejores hospitales"   → volcaba TODAS las métricas y
//                                          al final preguntaba.
//   · "A cuál hospital le va mejor?"    → preguntaba en abierto.
//
// Aquí se unifica: cuando la pregunta compara pero no declara la métrica,
// Aida NO asume y NO consulta: ofrece el menú de métricas que sí puede
// entregar, y espera a que el usuario elija.
// ───────────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/* 1. MÉTRICAS QUE AIDA PUEDE COMPARAR                                 */
/* ------------------------------------------------------------------ */

/**
 * Cada métrica es una opción del menú. El `patron` sirve para:
 *   (a) construir el patrón de "el usuario YA declaró un indicador";
 *   (b) detectar si una respuesta del modelo realmente ofrece opciones.
 */
export interface MetricaComparable {
  clave: string;
  /** Etiqueta corta para el menú. */
  etiqueta: string;
  /** Explicación de una línea para el menú. */
  detalle: string;
  /** Patrón que identifica esta métrica en un texto. */
  patron: RegExp;
}

export const METRICAS_COMPARABLES: MetricaComparable[] = [
  {
    clave: 'dias_denegados',
    etiqueta: 'Días denegados',
    detalle: 'cuántos días se negaron en cada uno.',
    patron:
      /\bd[ií]as?\s+denegados\b|\bdenegados\b|\bdenegaci[óo]n\b|\bdenied\b|\bdenials?\b/i,
  },
  {
    clave: 'porcentaje_denegacion',
    etiqueta: '% de denegación',
    detalle:
      'qué porcentaje de sus propias auditorías quedó denegado en cada uno.',
    patron:
      /%\s*(de\s*)?denegaci[óo]n\b|porcentaje\s+de\s+denegaci[óo]n|%?\s*denegado|\bdenial\s+rate\b|\bdenial\s+percentage\b/i,
  },
  {
    clave: 'los',
    etiqueta: 'Días de estancia (LOS) y % de días denegados sobre LOS',
    detalle: 'cuánta estancia registró cada uno y qué parte se perdió.',
    patron: /\bLOS\b|\bestancia\b|d[ií]as\s+de\s+estancia|\blength of stay\b/i,
  },
  {
    clave: 'monto_perdido',
    etiqueta: 'Monto perdido ($) y % de pérdida',
    detalle: 'cuánto dinero dejó de recibir cada uno.',
    patron:
      /\bmonto\s+perdido\b|\bperdido\b|\bp[eé]rdida(s)?\b|%?\s*(de\s*)?p[eé]rdida|\blost\s+amount\b|\bloss\b/i,
  },
  {
    clave: 'facturacion',
    etiqueta: 'Monto facturado ($) y monto recuperado ($)',
    detalle: 'cuánto facturó y cuánto recuperó cada uno.',
    patron: /\bfactur\w*\b|\bfacturado\b|\bbilled\b|\bbilling\b/i,
  },
  {
    clave: 'recuperacion',
    etiqueta: 'Días recuperados y % de recuperación',
    detalle: 'cuántos días se recuperaron tras la gestión.',
    patron:
      /\brecuperad\w*\b|\brecuperaci[óo]n\b|%?\s*(de\s*)?recuperaci[óo]n|\brecovered\b|\brecovery\b/i,
  },
  {
    clave: 'determinaciones',
    etiqueta: 'Determinaciones adversas',
    detalle:
      'el motivo de denegación más frecuente (por días denegados) y el de mayor pérdida.',
    patron:
      /\bdeterminaci[óo]n\w*\b|\badvers\w*\b|\bmotivo(s)?\b|\braz[óo]n\w*\b|\bfrecuente\b|\badverse\s+determination\w*\b|\bmotives?\b|\breasons?\b/i,
  },
  {
    clave: 'profesionales',
    etiqueta: 'Ranking de auditores, manejadores de caso o médicos de alta',
    detalle:
      'quién rindió más en cada hospital, por días denegados o por monto perdido.',
    patron:
      /\bauditor\w*\b|\bmanejador\w*\b|\bm[eé]dico\w*\b|\bdoctor\w*\b|\benfermer\w*\b|\bcase\s+handler\w*\b|\battending\s+physician\w*\b/i,
  },
];

/* ------------------------------------------------------------------ */
/* 2. EL INDICADOR QUE EL USUARIO YA DECLARÓ                           */
/* ------------------------------------------------------------------ */

/**
 * Menciones que SÍ dicen qué medir. Si aparece alguna, la consulta NO es
 * vaga y Aida debe ejecutarla (no preguntar, no ofrecer menú).
 */
const INDICADORES_DECLARADOS: RegExp[] = [
  /\bd[ií]as?\b/i,
  /\bdays?\b/i,
  /\b(porcentaje|porcentajes)\b/i,
  /\bpercent\b/i,
  /%/,
  /\b(monto|montos|importe|importes|plata|dinero)\b/i,
  /\bamounts?\b/i,
  /\bmoney\b/i,
  /\bfactur\w*\b/i,
  /\b(billed|billing)\b/i,
  /\b(perdido|p[eé]rdida|p[eé]rdidas)\b/i,
  /\b(lost|loss)\b/i,
  /\b(recuperado|recuperados|recuperaci[óo]n)\b/i,
  /\b(recovered|recovery)\b/i,
  /\b(aprobado|aprobados|aprobaci[óo]n)\b/i,
  /\b(approved|approval)\b/i,
  /\b(denegado|denegados|denegaci[óo]n)\b/i,
  /\b(denied|denials?|denial)\b/i,
  // "LOS" (Length of Stay) SIN flag `i`: con `i` matcheaba el artículo
  // español "los" ("dame LOS 5 mejores hospitales") y toda consulta con
  // "los" se daba por declarada.
  /\bLOS\b/,
  /\b(length of stay)\b/i,
  /\bd[ií]as\s+de\s+estancia\b/i,
  /\bestancia\b/i,
  /\b(auditor[ií]a|auditor[ií]as|casos)\b/i,
  /\b(audits?|cases?)\b/i,
  /\b(determinaci[óo]n|determinaciones|adversa|adversas)\b/i,
  /\b(determinations?|adverse)\b/i,
  /\b(motivo|motivos|raz[óo]n|razones|frecuente|frecuentes)\b/i,
  /\b(reasons?|frequent)\b/i,
  /\b(tope|top\s*\d+)\b/i,
];

/* ------------------------------------------------------------------ */
/* 3. INTENCIÓN COMPARATIVA (sin indicador)                             */
/* ------------------------------------------------------------------ */

/**
 * Señales de que el usuario quiere COMPARAR o ORDENAR. Sin un indicador
 * declarado, esta combinación es la que dispara el menú proactivo.
 */
const INTENCIONES_COMPARATIVAS: RegExp[] = [
  /\bmejor(es)?\b/i,
  /\bpeor(es)?\b/i,
  /\bbetter\b/i,
  /\bbest\b/i,
  /\bworst\b/i,
  /\bva\s+(bien|mal|mejor|peor)\b/i,
  /\b(ranking|rankings)\b/i,
  /\btop\s*\d*\b/i,
  /\b(compara\w*|comparaci[óo]n)\b/i,
  /\bcompare\b|\bcomparison\b/i,
  /\bversus\b|\bvs\b/i,
  /\b(destaca\w*|sobresale\w*|est[aá]\s+destacad\w*)\b/i,
  /\bm[aá]s\s+(importante|relevante|grande|significativ\w*)\b/i,
  /\bmost\s+\w+/i,
  /\b(recomienda\w*|sugerencia\w*)\b/i,
  /\bcu[aá]l(es)?\s+(es|son|tiene|tienen|va|le\s+va)\b/i,
  /\bwhich\s+(one|ones|is|are|has|have)\b/i,
  /\bprincipal(es)?\b/i,
  /\ble\s+va\s+mejor\b/i,
];

/* ------------------------------------------------------------------ */
/* 4. DIMENSIÓN QUE SE QUIERE COMPARAR                                 */
/* ------------------------------------------------------------------ */

export type DimensionComparada = 'hospital' | 'plan' | 'general';

const DIMENSIONES: Array<{ dim: DimensionComparada; patron: RegExp }> = [
  { dim: 'hospital', patron: /\bhospital(es)?\b|\bhospitalario\b/i },
  { dim: 'plan', patron: /\bplans?\b|\bplan\s+m[eé]dico\b/i },
];

/** Entity over which the comparison is being requested. */
export function detectarDimensionComparada(
  mensaje: string,
): DimensionComparada {
  const t = mensaje ?? '';
  for (const d of DIMENSIONES) {
    if (d.patron.test(t)) return d.dim;
  }
  return 'general';
}

/* ------------------------------------------------------------------ */
/* 5. DETECCIÓN PRINCIPAL                                               */
/* ------------------------------------------------------------------ */

export interface DeteccionSinIndicador {
  /** true si la pregunta compara pero no dice qué medir. */
  sinIndicador: boolean;
  /** La dimensión que se quiere comparar. */
  dimension: DimensionComparada;
  /** true si el mensaje menciona un profesional (auditor/médico/manejador). */
  mencionaProfesional: boolean;
}

/**
 * Detecta una consulta comparativa cuyo indicador NO está declarado.
 */
export function detectarConsultaSinIndicador(
  mensaje: string,
): DeteccionSinIndicador {
  const t = (mensaje ?? '').trim();
  const tieneIndicador = INDICADORES_DECLARADOS.some((re) => re.test(t));
  const tieneIntencion = INTENCIONES_COMPARATIVAS.some((re) => re.test(t));

  return {
    sinIndicador: !tieneIndicador && tieneIntencion,
    dimension: detectarDimensionComparada(t),
    mencionaProfesional:
      /\b(auditor\w*|manejador\w*|m[eé]dico\w*|doctor\w*|m[eé]dica\w*)\b/i.test(
        t,
      ),
  };
}

/* ------------------------------------------------------------------ */
/* 6. VERIFICACIÓN DE QUE LA RESPUESTA OFRECE OPCIONES                  */
/* ------------------------------------------------------------------ */

/**
 * ¿La respuesta del modelo ofrece realmente un menú de métricas?
 *
 * Exige al menos 3 métricas DISTINTAS mencionadas. Un respuesta que asume
 * una métrica y da datos ("el % de denegación más bajo es X con 21.67%")
 * menciona 1-2 y por tanto NO cuenta como menú.
 */
export function ofreceOpcionesDeMetrica(texto: string): boolean {
  if (!texto || !texto.trim()) return false;
  const distintas = METRICAS_COMPARABLES.filter((m) => m.patron.test(texto));
  return distintas.length >= 3;
}

/**
 * ¿La respuesta contiene cifras (o sea, respondió datos en vez de ofrecer
 * opciones)? Se ignoran los años y los números de lista.
 */
export function contieneCifras(texto: string): boolean {
  if (!texto) return false;
  const limpio = texto
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b(19|20|21)\d{2}\b/g, ' ')
    .replace(/^\s*\d{1,2}[.)]\s/gm, ' ')
    .replace(/\btop\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*(hospitales|planes|meses|d[ií]as)\b/gi, ' ');
  return /\d/.test(limpio);
}

/* ------------------------------------------------------------------ */
/* 7. MENÚ CANÓNICO                                                     */
/* ------------------------------------------------------------------ */

/** "cada hospital" / "cada plan" / "cada uno" */
function cadaDe(dimension: DimensionComparada): string {
  if (dimension === 'hospital') return 'cada hospital';
  if (dimension === 'plan') return 'cada plan';
  return 'cada uno';
}

/** "por hospital" / "por plan" */
function porDe(dimension: DimensionComparada): string {
  if (dimension === 'plan') return 'por plan';
  return 'por hospital';
}

/**
 * Menú de métricas: la respuesta canónica cuando el usuario comparó pero no
 * dijo qué medir. Determinista — no depende de que el modelo obedezca.
 */
export function menuDeMetricas(
  dimension: DimensionComparada = 'general',
  idioma: 'es' | 'en' = 'es',
): string {
  const plural = dimension !== 'general';

  if (idioma === 'en') {
    const ent = plural ? 'each one of them' : 'each one';
    return [
      `Sure. "Doing better" depends on the metric, and each metric ranks ${ent} differently. I can compare them by:`,
      '',
      '- <b>Denied days</b>: how many days were denied.',
      '- <b>Denial rate</b>: the share of their own audits that ended denied.',
      '- <b>Length of stay (LOS)</b> and <b>% of denied days over LOS</b>.',
      '- <b>Lost amount ($)</b> and <b>loss rate</b>.',
      '- <b>Billed amount ($)</b> and <b>recovered amount ($)</b>.',
      '- <b>Recovered days</b> and <b>recovery rate</b>.',
      '- <b>Adverse determinations</b>: most frequent reason, the one with the most days, and the one with the biggest loss.',
      '- <b>Ranking of auditors, case handlers or attending physicians</b>.',
      '',
      'By default I use the current year, all plans and levels of care, and all active hospitals. Pick the metric and I will build it right away.',
    ].join('\n');
  }

  const dimTexto = cadaDe(dimension);

  return [
    `Claro. "Ir mejor" depende de la m\u00e9trica, y cada m\u00e9trica ordena ${dimTexto} de forma distinta. Te puedo comparar por:`,
    '',
    '- <b>D\u00edas denegados</b>: cu\u00e1ntos d\u00edas se negaron en cada uno.',
    '- <b>% de denegaci\u00f3n</b>: qu\u00e9 porcentaje de sus propias auditor\u00edas qued\u00f3 denegado en cada uno.',
    '- <b>D\u00edas de estancia (LOS)</b> y <b>% de d\u00edas denegados sobre LOS</b>.',
    '- <b>Monto perdido ($)</b> y <b>% de p\u00e9rdida</b>: cu\u00e1nto dinero dej\u00f3 de recibir cada uno.',
    '- <b>Monto facturado ($)</b> y <b>monto recuperado ($)</b>.',
    '- <b>D\u00edas recuperados</b> y <b>% de recuperaci\u00f3n</b>.',
    '- <b>Determinaciones adversas</b>: el motivo m\u00e1s frecuente, el que m\u00e1s d\u00edas concentra y el de mayor p\u00e9rdida.',
    `- <b>Ranking de auditores, manejadores de caso o m\u00e9dicos de alta</b> ${porDe(dimension)}.`,
    '',
    'Por defecto uso el a\u00f1o en curso, todos los planes y niveles de cuidado, y todos los hospitales activos. Elige la m\u00e9trica que te interese y te la armo al momento.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 8. DIRECTIVA DINÁMICA PARA EL TURNO                                 */
/* ------------------------------------------------------------------ */

/**
 * Nota dinámica del system prompt para el turno detectado.
 */
export function directivaSinIndicador(
  dimension: DimensionComparada,
  idioma: 'es' | 'en' = 'es',
): string {
  if (idioma === 'en') {
    return [
      '\u26a0\ufe0f THE QUESTION COMPARES BUT DOES NOT SAY WHAT TO MEASURE:',
      'RULES FOR THIS TURN:',
      '1. Do NOT assume a metric. "Which hospital is better" has a different',
      '   answer depending on the metric (denied days, denial rate, lost amount,',
      '   billed amount, recovered days, adverse determinations…).',
      '2. Do NOT call any data tool: without a metric there is nothing to query.',
      '3. Do NOT dump every available metric for every entity.',
      '4. Answer with a SHORT, CONCRETE MENU of the metrics you can compare',
      '   (at least three of them, one per line with a hyphen), and say which one',
      '   the user should pick. Offer to build it immediately once they choose.',
      '5. Do not ask for the period, the hospital or the plan: those are inferred',
      '   by default (current year, all active hospitals, all plans and levels).',
    ].join('\n');
  }

  return [
    '\u26a0\ufe0f LA PREGUNTA COMPARA PERO NO DICE QU\u00c9 MEDIR:',
    'REGLAS PARA ESTE TURNO:',
    '1. NO asumas una m\u00e9trica. "Cu\u00e1l hospital le va mejor" tiene respuestas',
    '   distintas seg\u00fan la m\u00e9trica (d\u00edas denegados, % de denegaci\u00f3n, monto',
    '   perdido, facturado, d\u00edas recuperados, determinaciones adversas…).',
    '2. NO llames a ninguna herramienta de datos: sin m\u00e9trica no hay nada que consultar.',
    '3. NO vuelques todas las m\u00e9tricas disponibles de cada entidad.',
    '4. Responde con un MEN\u00da CORTO Y CONCRETO de las m\u00e9tricas que puedes comparar',
    '   (al menos tres, una por l\u00ednea con guion) y di cu\u00e1l elige el usuario.',
    '5. NO preguntes por el per\u00edodo, el hospital ni el plan: se infieren por defecto',
    '   (a\u00f1o en curso, todos los hospitales activos, todos los planes y niveles).',
  ].join('\n');
}
