// src/ultramsg/chat-id.spec.ts
// El chat_id derivado del id de WhatsApp debe ser estable y no chocar con
// los us_id secuenciales de DrReceta.

import { chatIdFromWhatsappId } from './chat-id';

describe('chatIdFromWhatsappId', () => {
  it('usa el número del contacto como chat_id', () => {
    expect(chatIdFromWhatsappId('51993314858@c.us')).toBe(51993314858);
    expect(chatIdFromWhatsappId('+17876807222')).toBe(17876807222);
  });

  it('usa el hash para ids de grupo (no son un número de teléfono válido)', () => {
    const id = chatIdFromWhatsappId('120363228356317247-441234567890@g.us');
    expect(id).toBeGreaterThan(1e12);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBe(
      chatIdFromWhatsappId('120363228356317247-441234567890@g.us'),
    );
  });

  it('es determinista', () => {
    const a = chatIdFromWhatsappId('51993314858@c.us');
    const b = chatIdFromWhatsappId('51993314858@c.us');
    expect(a).toBe(b);
  });

  it('no choca con los us_id secuenciales de DrReceta', () => {
    const id = chatIdFromWhatsappId('51993314858@c.us');
    expect(id).toBeGreaterThan(1000);
  });

  it('usa el offset para ids que no son un número válido', () => {
    const id = chatIdFromWhatsappId('abc-xyz@g.us');
    expect(id).toBeGreaterThan(1e12);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBe(chatIdFromWhatsappId('abc-xyz@g.us'));
  });
});
