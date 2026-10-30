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
  score: number;
}

/** Token que aparece en el TEMA (columna `pregunta`): pesa más. */
const PESO_PREGUNTA = 3;
/** Token que solo aparece dentro del texto de la respuesta. */
const PESO_RESPUESTA = 1;
/** Bonus si el paciente repite la pregunta casi tal cual. */
const BONUS_FRASE = 5;
/** Score mínimo para responder con la base de conocimiento. */
export const UMBRAL = 3;

/** Palabras vacías que no aportan a la búsqueda. */
const STOPWORDS = new Set(
  (
    'del los las por para que con sin una uno unos unas su sus este esta ' +
    'esto esos esas ese esa hay han fue ser esta estan mas muy pero sino ' +
    'cada como cual cuales cuando donde cuanto cuantos cuantas porque ' +
    'tambien sobre entre hasta desde tengo tiene tienen hacer hace ' +
    'puede pueden debe deben sigue sino era serian'
  ).split(' '),
);

/** Palabras que abren una pregunta: no son parte del tema. */
const INTERROGATIVOS = new Set(
  'que como donde cuando cuanto cuantos cuantas cual cuales quien por que para son es'.split(
    ' ',
  ),
);

/** Solo saludo/cortesía: el mensaje no trae una pregunta real. */
const CORTESIA = new Set(
  'hola buenos buenas dias tardes noches saludos hey hola hey hola gracias ' +
    'adios adios hasta luego bendiga bendito bendita chao'.split(' '),
);

/** Síntomas que exigen atención inmediata si no encontramos respuesta. */
const EMERGENCIA =
  /\b(emergencia|urgente|urgencia|perdida de vision|perdi la vision|no veo|no puedo ver|sangrado|sangre en el ojo|golpe en el ojo|quemadura)\b/;

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
  return ka.length >= 5 && kb.length >= 5 && ka.slice(0, 5) === kb.slice(0, 5);
}

/** El tema de la entrada, sin la palabra que abre la pregunta. */
function tema(pregunta: string): string {
  const palabras = normalizar(pregunta).split(' ').filter(Boolean);
  while (palabras.length && INTERROGATIVOS.has(palabras[0])) palabras.shift();
  return palabras.join(' ');
}

/** ¿El mensaje es solo un saludo o un agradecimiento? */
export function esCortesia(mensaje: string): boolean {
  const tokens = normalizar(mensaje).split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => CORTESIA.has(t));
}

/**
 * Score de una entrada para un mensaje:
 * 3 por cada palabra clave del tema, 1 por cada palabra que solo sale en
 * la respuesta y 5 si el paciente repite el tema casi literal.
 */
export function puntuar(
  mensaje: string,
  tokens: string[],
  entrada: KnowledgeEntry,
): number {
  if (tokens.length === 0) return 0;

  const tokensPregunta = tokenizar(entrada.pregunta);
  const tokensRespuesta = tokenizar(entrada.respuesta);

  let score = 0;
  for (const t of tokens) {
    if (tokensPregunta.some((p) => coincide(t, p))) score += PESO_PREGUNTA;
    else if (tokensRespuesta.some((r) => coincide(t, r))) score += PESO_RESPUESTA;
  }

  const t = tema(entrada.pregunta);
  if (t.length >= 10 && normalizar(mensaje).includes(t)) score += BONUS_FRASE;

  return score;
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

  /** Mejor coincidencia por palabra clave, o `null` si no hay. */
  async buscar(mensaje: string): Promise<FaqMatch | null> {
    const tokens = tokenizar(mensaje);
    if (tokens.length === 0) return null;

    const entradas = await this.entradas();
    let mejor: FaqMatch | null = null;
    for (const entrada of entradas) {
      const score = puntuar(mensaje, tokens, entrada);
      // Empate: se queda la entrada más antigua (id menor), que es la
      // versión canónica del tema.
      if (score > 0 && (!mejor || score > mejor.score)) {
        mejor = { entry: entrada, score };
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
        'Saludos, gracias por comunicarse con Retina Care. ' +
        'Puede escribirnos su pregunta sobre síntomas y enfermedades de retina, ' +
        'los planes médicos que aceptamos, la dirección o el horario de atención.'
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

    const match = await this.buscar(texto);
    if (match) {
      this.logger.log(
        `FAQ match chat: entrada #${match.entry.id} score=${match.score} ` +
          `"${match.entry.pregunta}"`,
      );
      return match.entry.respuesta;
    }

    if (EMERGENCIA.test(normalizar(texto))) {
      return (
        'Si está perdiendo la visión de forma repentina, ve con destellos ' +
        'intensos o con una sombra o cortina en la vista, acuda de inmediato a ' +
        'urgencias o llame al 9-1-1. No conduzca. Si no se trata de una ' +
        'urgencia, nuestro personal clínico puede atenderle.'
      );
    }

    return (
      'No encontramos la respuesta a su consulta en nuestra base de conocimiento. ' +
      'Por favor comuníquese con nuestro equipo de Retina Care y con gusto le ' +
      'ayudaremos.'
    );
  }
}
