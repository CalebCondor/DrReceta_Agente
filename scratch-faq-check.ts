import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  normalizar,
  tokenizar,
  coincide,
  puntuar,
  esCortesia,
  UMBRAL,
  type KnowledgeEntry,
} from './src/agent/faq.service';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const QUERIES = [
  'hola',
  'gracias',
  'qué es la catarata',
  'tengo glaucoma',
  'veo puntos negros flotantes',
  'qué son los destellos',
  'estoy viendo una cortina oscura en la visión',
  'mi visión está borrosa de repente',
  'me duelen los ojos secos',
  'qué es el OCT',
  'aceptan el plan vital?',
  'qué planes médicos aceptan',
  'dónde está retina care?',
  'cuál es el horario de atención',
  'en qué dirección están ubicados',
  'quiero sacar una cita',
  'cada cuánto debe una persona diabética revisar su retina',
  'qué es la retinopatía diabética',
  'tengo diabetes, qué riesgo tengo',
  'hay cura para el glaucoma?',
  'me duele el ojo desde hace dos días',
  'cuánto cuesta una consulta',
  'de repente perdí la visión de un ojo',
  'hace cuánto están王国',
  'qué es la degeneración macular',
  'síntoma',
  'quiero información sobre la retina',
  'las inyecciones intravítreas duelen?',
  'qué pruebas hacen en una consulta de retina',
];

async function main() {
  const { rows } = await pool.query(
    'SELECT id, pregunta, respuesta FROM conocimiento_especifico ORDER BY id',
  );
  const entradas = rows as KnowledgeEntry[];

  for (const q of QUERIES) {
    const tokens = tokenizar(q);
    let mejor: { entry: KnowledgeEntry; score: number } | null = null;
    let ranking: string[] = [];
    for (const e of entradas) {
      const score = puntuar(q, tokens, e);
      if (score > 0) ranking.push(`${e.id}:${score}`);
      if (score > 0 && (!mejor || score > mejor.score)) mejor = { entry: e, score };
    }
    ranking.sort((a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1]));
    const hit = mejor && mejor.score >= UMBRAL;
    console.log(
      `\nQ: "${q}"\n  tokens=[${tokens.join(',')}]${esCortesia(q) ? ' CORTESIA' : ''}` +
        `\n  -> ${hit ? `#${mejor!.entry.id} (${mejor!.score}) ${mejor!.entry.pregunta}` : 'SIN MATCH'}` +
        `\n  top: ${ranking.slice(0, 5).join(' ')}`,
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
