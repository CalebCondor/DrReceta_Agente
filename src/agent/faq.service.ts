// src/agent/faq.service.ts
// Agente de preguntas frecuentes SIN IA.
//
// Compara el mensaje del paciente contra la base de conocimiento
// (`conocimiento_especifico`) por palabra clave y devuelve la respuesta
// aprobada, tal cual está en la base. Si no hay coincidencia, deriva al
// personal humano.

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';

export interface KnowledgeEntry {
  id: number;
  pregunta: string;
  respuesta: string;
}

export interface FaqMatch {
  entry: KnowledgeEntry;
  /** Puntaje temático: cuánto coincide el mensaje con el tema de la entrada. */
  score: number;
}

/** Peso de una palabra que aparece en el TEMA (columna `pregunta`). */
const PESO_PREGUNTA = 3;
/** Peso de una palabra que solo aparece dentro del texto de la respuesta. */
const PESO_RESPUESTA = 1;
/**
 * Puntaje temático mínimo para responder. Una palabra que solo aparece en
 * una pregunta vale 3; una que aparece en varias vale menos (se pesa por
 * IDF), así que 2.5 descarta palabras genéricas como "ojo" o "consulta".
 */
export const UMBRAL = 2.5;

/** Palabras vacías que no aportan a la búsqueda. */
const STOPWORDS = new Set(
  (
    'del los las por para que con sin una unos unas su sus este esta ' +
    'esto esos esas ese esa hay han fue ser estan mas muy pero sino ' +
    'cada cual cuales cuando cuanto cuantos cuantas porque ' +
    'tambien sobre entre hasta desde tengo tiene tienen hacer hace ' +
    'puede pueden debe deben sigue era serian'
  ).split(' '),
);

/** Solo saludo/cortesía: el mensaje no trae una pregunta real. */
const CORTESIA = new Set(
  (
    'hola hey buenos buenas dias tardes noches saludos gracias ' +
    'adios adios hasta luego ok'
  ).split(' '),
);

/**
 * Síntomas que exigen atención inmediata. Se comprueban ANTES de buscar en
 * la base: una pérdida visual repentina siempre es una urgencia, aunque la
 * base tenga una entrada parecida.
 */
const EMERGENCIA: RegExp[] = [
  /(perdi|pierdo|perdida|perdi[a])\b[\s\S]{0,40}\b(vision|vista|ver)/,
  /\b(vision|vista|ver)\b[\s\S]{0,40}\b(perdi|pierdo|perdida)/,
  /\bno (puedo )?ver\b/,
  /\bno veo\b/,
  /cortina (oscura )?en la (vision|vista)/,
  /sangr(e|ado) en el ojo/,
  /golpe en el ojo/,
  /quemadura/i,
];

/** Quita acentos y deja solo `[a-z0-9]` separado por espacios. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokens con significado (sin palabras vacías). */
export function tokenizar(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Reduce una palabra a una forma comparable: quita plural y, si queda
 * larga, se queda con las 5 primeras letras. Así "puntos"/"punto",
 * "diabetes"/"diabética" y "retina"/"retinopatía" se reconocen como la
 * misma palabra.
 */
function clave(palabra: string): string {
  let p = palabra;
  if (p.length > 4 && p.endsWith('es')) p = p.slice(0, -2);
  else if (p.length > 3 && p.endsWith('s')) p = p.slice(0, -1);
  return p;
}

/** ¿Son la misma palabra (con variantes de plural/género)? */
export function coincide(a: string, b: string): boolean {
  const ka = clave(a);
  const kb = clave(b);
  if (ka === kb) return true;
  if (ka.length < 5 || kb.length < 5) return false;
  // Prefijo corto: "diabet" ~ "diabetica", pero NO "retina" ~ "retinopatia".
  const dif = Math.abs(ka.length - kb.length);
  return dif <= 3 && (ka.startsWith(kb) || kb.startsWith(ka));
}

/** ¿El mensaje es solo un saludo o un agradecimiento? */
export function esCortesia(mensaje: string): boolean {
  const tokens = normalizar(mensaje).split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => CORTESIA.has(t));
}

/** ¿El mensaje describe una urgencia? */
export function esEmergencia(mensaje: string): boolean {
  const t = normalizar(mensaje);
  return EMERGENCIA.some((re) => re.test(t));
}

interface Perfil {
  entry: KnowledgeEntry;
  q: string[];
  r: string[];
}

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);

  constructor(private readonly db: DbService) {}

  /** Todas las entradas de la base de conocimiento. */
  private async entradas(): Promise<KnowledgeEntry[]> {
    const { rows } = await this.db.query(
      'SELECT id, pregunta, respuesta FROM conocimiento_especifico ORDER BY id',
    );
    return rows as KnowledgeEntry[];
  }

  /**
   * Mejor coincidencia por palabra clave, o `null` si no hay.
   *
   * Cada palabra del paciente se pesa por IDF: una palabra que aparece en
   * muchas respuestas pesa menos que una que define un tema. Solo cuenta
   * como evidencia las palabras que aparecen en el TEMA de la entrada
   * (columna `pregunta`); las que solo salen en el texto de la respuesta
   * sirven para desempatar, no para decidir.
   */
  async buscar(mensaje: string): Promise<FaqMatch | null> {
    const tokens = tokenizar(mensaje);
    if (tokens.length === 0) return null;

    const entradas = await this.entradas();
    if (entradas.length === 0) return null;

    const perfiles: Perfil[] = entradas.map((entry) => ({
      entry,
      q: tokenizar(entry.pregunta),
      r: tokenizar(entry.respuesta),
    }));

    const n = perfiles.length;
    const idfMax = Math.log(1 + n);

    // En qué entradas aparece cada palabra del paciente.
    const info = new Map<
      string,
      { wq: number; wr: number; enQ: Set<number>; enR: Set<number> }
    >();
    for (const t of tokens) {
      const enQ = new Set<number>();
      const enR = new Set<number>();
      perfiles.forEach((p, i) => {
        if (p.q.some((x) => coincide(t, x))) enQ.add(i);
        else if (p.r.some((x) => coincide(t, x))) enR.add(i);
      });
      info.set(t, {
        wq: enQ.size ? Math.log(1 + n / enQ.size) / idfMax : 0,
        wr: enR.size ? Math.log(1 + n / enR.size) / idfMax : 0,
        enQ,
        enR,
      });
    }

    let mejor: FaqMatch | null = null;
    for (let i = 0; i < perfiles.length; i++) {
      let topico = 0;
      for (const t of tokens) {
        const w = info.get(t)!;
        if (w.enQ.has(i)) topico += PESO_PREGUNTA * w.wq;
        else if (w.enR.has(i)) topico += PESO_RESPUESTA * w.wr;
      }
      // Empate: se queda la entrada más antigua (id menor), que es la
      // versión canónica del tema.
      if (topico > 0 && (!mejor || topico > mejor.score)) {
        mejor = { entry: perfiles[i].entry, score: topico };
      }
    }

    if (!mejor || mejor.score < UMBRAL) return null;
    return mejor;
  }

  /** Respuesta completa para el paciente. */
  async responder(mensaje: string): Promise<string> {
    const texto = (mensaje ?? '').trim();

    if (!texto) {
      return (
        'Saludos, gracias por comunicarse con Retina Care. Puede escribirnos ' +
        'su pregunta sobre síntomas y enfermedades de retina, los planes médicos ' +
        'que aceptamos, la dirección o el horario de atención.'
      );
    }

    if (esCortesia(texto)) {
      return (
        '¡Hola! Gracias por comunicarse con Retina Care. Puede preguntarnos sobre ' +
        'síntomas y enfermedades de retina (puntos negros, destellos, glaucoma, ' +
        'catarata, degeneración macular), sobre el OCT, los planes médicos que ' +
        'aceptamos, la dirección de la clínica o el horario de atención. ' +
        '¿Cuál es su pregunta?'
      );
    }

    if (esEmergencia(texto)) {
      return (
        'Si está perdiendo la visión de forma repentina, ve con destellos ' +
        'intensos o con una sombra o cortina en la vista, acuda de inmediato a ' +
        'urgencias o llame al 9-1-1. No conduzca. Si no se trata de una ' +
        'urgencia, nuestro personal clínico puede atenderle.'
      );
    }

    const match = await this.buscar(texto);
    if (match) {
      this.logger.log(
        `FAQ match: entrada #${match.entry.id} score=${match.score.toFixed(2)} ` +
          `"${match.entry.pregunta}"`,
      );
      return match.entry.respuesta;
    }

    return (
      'No encontramos la respuesta a su consulta en nuestra base de conocimiento. ' +
      'Por favor comuníquese con nuestro equipo de Retina Care y con gusto le ' +
      'ayudaremos.'
    );
  }
}
