import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  tokenizar,
  coincide,
  esCortesia,
  esEmergencia,
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
  'qué es la degeneración macular',
  'síntoma',
  'quiero información sobre la retina',
  'las inyecciones intravítreas duelen?',
  'qué pruebas hacen en una consulta de retina',
  'qué es la degeneración en lattice',
  'aceptan medicaid?',
  'hola, tengo una duda',
  'la retina está bien?',
];

async function main() {
  const { rows } = await pool.query(
    'SELECT id, pregunta, respuesta FROM conocimiento_especifico ORDER BY id',
  );
  const entradas = rows as KnowledgeEntry[];

  const perfiles = entradas.map((e) => ({
    e,
    q: tokenizar(e.pregunta),
    r: tokenizar(e.respuesta),
  }));
  const n = perfiles.length;
  const idfMax = Math.log(1 + n);

  for (const q of QUERIES) {
    const tokens = tokenizar(q);
    const info = new Map<string, { wq: number; enQ: Set<number> }>();
    for (const t of tokens) {
      const enQ = new Set<number>();
      perfiles.forEach((p, i) => {
        if (p.q.some((x) => coincide(t, x))) enQ.add(i);
      });
      info.set(t, {
        wq: enQ.size ? Math.log(1 + n / enQ.size) / idfMax : 0,
        enQ,
      });
    }
    const ranking: Array<{ id: number; topico: number; pregunta: string }> = [];
    perfiles.forEach((p, i) => {
      let topico = 0;
      for (const t of tokens) {
        const w = info.get(t)!;
        if (w.enQ.has(i)) topico += 3 * w.wq;
      }
      if (topico > 0)
        ranking.push({ id: p.e.id, topico, pregunta: p.e.pregunta });
    });
    ranking.sort((a, b) => b.topico - a.topico);
    const top = ranking[0];
    const hit = top && top.topico >= UMBRAL;
    const corte = esCortesia(q)
      ? 'CORTESIA'
      : esEmergencia(q)
        ? 'EMERGENCIA'
        : '';
    console.log(
      `\nQ: "${q}"  ${corte}\n  tokens=[${tokens.join(',')}]\n  -> ${
        hit ? `#${top.id} (${top.topico.toFixed(2)}) ${top.pregunta}` : 'SIN MATCH'
      }\n  top: ${ranking
        .slice(0, 4)
        .map((r) => `${r.id}:${r.topico.toFixed(2)}`)
        .join(' ')}`,
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
