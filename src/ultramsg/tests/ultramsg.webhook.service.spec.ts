// src/ultramsg/ultramsg.webhook.service.spec.ts
// Pipeline de WhatsApp entrante: webhook → agente → respuesta por WhatsApp.
// Con el agente, el cliente HTTP y la BD mockeados (no sale nada a internet).

import { AgentService } from '../../agent/agent.service';
import { DbService } from '../../agent/db.service';
import { UltramsgService } from '../api/ultramsg.service';
import { UltramsgWebhookService } from '../webhook/ultramsg.webhook.service';

const OLD_ENV = process.env;

describe('UltramsgWebhookService', () => {
  let agentChat: jest.Mock;
  let sendMessage: jest.Mock;
  let dbQuery: jest.Mock;
  let service: UltramsgWebhookService;

  const evento = (over: Record<string, unknown> = {}) => ({
    event_type: 'message_received',
    instanceId: 'instance170610',
    data: {
      id: 'false_51993314858@c.us_ABC',
      from: '51993314858@c.us',
      to: '51993314859@c.us',
      ack: 'pending',
      type: 'chat',
      body: 'Hola, quiero una cita',
      fromMe: false,
      ...over,
    },
  });

  beforeEach(() => {
    process.env = { ...OLD_ENV, ULTRAMSG_INSTANCE_ID: 'instance170610' };

    agentChat = jest.fn().mockResolvedValue('Buenísimo, con gusto le ayudo.');
    sendMessage = jest
      .fn()
      .mockResolvedValue({ success: true, message: 'ok', raw: {} });
    dbQuery = jest.fn().mockResolvedValue({ rows: [] });

    service = new UltramsgWebhookService(
      { chat: agentChat } as unknown as AgentService,
      { sendMessage } as unknown as UltramsgService,
      { query: dbQuery } as unknown as DbService,
    );
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('pasa el mensaje al agente y responde por WhatsApp', async () => {
    const result = await service.handle(evento());

    expect(result.handled).toBe(true);
    expect(result.chat_id).toBe(51993314858);
    expect(agentChat).toHaveBeenCalledWith(
      51993314858,
      'Hola, quiero una cita',
    );
    expect(sendMessage).toHaveBeenCalledWith(
      '51993314858@c.us',
      'Buenísimo, con gusto le ayudo.',
    );
  });

  it('guarda el teléfono del remitente en la memoria del chat', async () => {
    await service.handle(evento());

    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('memoria_largo_plazo'),
      [51993314858, '51993314858@c.us'],
    );
  });

  it('ignora los mensajes enviados por la propia instancia (evita el bucle)', async () => {
    const result = await service.handle(evento({ fromMe: true }));

    expect(result.handled).toBe(false);
    expect(agentChat).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignora los tipos que no son texto', async () => {
    const result = await service.handle(evento({ type: 'image', body: 'img' }));

    expect(result.handled).toBe(false);
    expect(agentChat).not.toHaveBeenCalled();
  });

  it('ignora otros tipos de evento', async () => {
    const result = await service.handle({
      ...evento(),
      event_type: 'message_ack',
    });

    expect(result.handled).toBe(false);
    expect(agentChat).not.toHaveBeenCalled();
  });

  it('ignora eventos de otra instancia', async () => {
    const result = await service.handle({ ...evento(), instanceId: 'otra' });

    expect(result.handled).toBe(false);
    expect(agentChat).not.toHaveBeenCalled();
  });

  it('acepta el instanceId que manda UltraMsg en el webhook ("170610")', async () => {
    // En el payload real el id viene SIN el prefijo "instance".
    const result = await service.handle({ ...evento(), instanceId: '170610' });

    expect(result.handled).toBe(true);
    expect(agentChat).toHaveBeenCalled();
  });

  it('ignora los boletines/canales de WhatsApp', async () => {
    const result = await service.handle(
      evento({ from: '120363160347659112@newsletter', body: 'noticia' }),
    );

    expect(result.handled).toBe(false);
    expect(agentChat).not.toHaveBeenCalled();
  });

  it('ignora los mensajes marcados con self=true', async () => {
    const result = await service.handle(evento({ self: true }));

    expect(result.handled).toBe(false);
    expect(agentChat).not.toHaveBeenCalled();
  });

  it('no responde por WhatsApp si el chat está pausado', async () => {
    agentChat.mockResolvedValue('');

    const result = await service.handle(evento());

    expect(result.handled).toBe(true);
    expect(agentChat).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('no revienta si el agente falla', async () => {
    agentChat.mockRejectedValue(new Error('boom'));

    const result = await service.handle(evento());

    expect(result.handled).toBe(false);
    expect(result.reason).toContain('boom');
  });
});
