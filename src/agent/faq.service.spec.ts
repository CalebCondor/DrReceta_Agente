// src/agent/faq.service.spec.ts
// Agente de preguntas frecuentes por palabra clave (sin IA).
// La BD está mockeada: solo importa el matching de la base de conocimiento.

import {
  FaqService,
  coincide,
  esCortesia,
  esEmergencia,
  tokenizar,
} from './faq.service';
import { DbService } from './db.service';

const ENTRADAS = [
  {
    id: 1,
    pregunta: '¿Qué es la catarata?',
    respuesta:
      'La catarata es la opacificación del cristalino. Retina Care no realiza cirugía de catarata.',
  },
  {
    id: 2,
    pregunta: '¿Qué es el glaucoma?',
    respuesta:
      'El glaucoma daña el nervio óptico. Se evalúa con la presión intraocular.',
  },
  {
    id: 3,
    pregunta: '¿Dónde está Retina Care y cómo se coordina una cita?',
    respuesta:
      'Retina Care está en el #452 Ave. Dr. Rivera Aulet, Arecibo. Llame al 787-680-7222.',
  },
  {
    id: 4,
    pregunta: '¿Cuál es el horario de atención de Retina Care?',
    respuesta: 'Atendemos de Lunes a Viernes de 8:00am a 3:00pm.',
  },
];

describe('FaqService', () => {
  let service: FaqService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: ENTRADAS });
    service = new FaqService({ query } as unknown as DbService);
  });

  it('tokeniza sin acentos ni palabras vacías', () => {
    expect(tokenizar('¿Qué es la visión?')).toEqual(['vision']);
  });

  it('reconoce plural y género pero no temas distintos', () => {
    expect(coincide('puntos', 'punto')).toBe(true);
    expect(coincide('diabetes', 'diabética')).toBe(true);
    expect(coincide('retina', 'retinopatía')).toBe(false);
  });

  it('detecta saludos y urgencias', () => {
    expect(esCortesia('Hola')).toBe(true);
    expect(esCortesia('Hola, tengo una duda')).toBe(false);
    expect(esEmergencia('de repente perdí la visión')).toBe(true);
    expect(esEmergencia('qué es el glaucoma')).toBe(false);
  });

  it('encuentra la entrada por palabra clave', async () => {
    const match = await service.buscar('tengo glaucoma');
    expect(match?.entry.id).toBe(2);
  });

  it('ignora palabras genéricas que no identifican un tema', async () => {
    expect(
      await service.buscar('quiero información sobre la retina'),
    ).toBeNull();
  });

  it('devuelve la respuesta aprobada tal cual', async () => {
    const respuesta = await service.responder('¿Qué es la catarata?');
    expect(respuesta).toBe(ENTRADAS[0].respuesta);
  });

  it('deriva al teléfono de la clínica cuando no hay coincidencia', async () => {
    const respuesta = await service.responder('quiero saber sobre el precio');
    expect(respuesta).toContain('No podemos responder ese tipo de pregunta');
    expect(respuesta).toContain('787-680-7222');
  });

  it('responde con urgencias ante pérdida visual repentina', async () => {
    const respuesta = await service.responder(
      'de repente perdí la visión de un ojo',
    );
    expect(respuesta).toContain('9-1-1');
  });

  it('saluda cuando el mensaje es solo cortesía', async () => {
    const respuesta = await service.responder('hola');
    expect(respuesta).toContain('Retina Care');
  });
});
