// src/ultramsg/ultramsg.service.spec.ts
// Cubre la config leída del entorno y el envío contra la API de UltraMsg
// (con fetch mockeado: nunca sale a internet).

import { loadUltramsgConfig } from '../config/ultramsg.config';
import { UltramsgService } from '../api/ultramsg.service';

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
};

const OLD_ENV = process.env;

function mockResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): FetchResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('Ultramsg', () => {
  let fetchMock: jest.Mock<Promise<FetchResponse>, [string, FetchInit]>;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    fetchMock = jest.fn<Promise<FetchResponse>, [string, FetchInit]>();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('loadUltramsgConfig', () => {
    it('lee las tres variables del entorno', () => {
      const cfg = loadUltramsgConfig({
        ULTRAMSG_BASE_URL: 'https://api.ultramsg.com/',
        ULTRAMSG_INSTANCE_ID: 'instance123',
        ULTRAMSG_TOKEN: 'tok123',
      });

      expect(cfg.baseUrl).toBe('https://api.ultramsg.com');
      expect(cfg.instanceId).toBe('instance123');
      expect(cfg.token).toBe('tok123');
      expect(cfg.configured).toBe(true);
    });

    it('no marca como configurado los placeholders del .env', () => {
      const cfg = loadUltramsgConfig({
        ULTRAMSG_BASE_URL: 'https://api.ultramsg.com',
        ULTRAMSG_INSTANCE_ID: 'tu_id_de_instancia',
        ULTRAMSG_TOKEN: 'tu_token',
      });

      expect(cfg.configured).toBe(false);
    });

    it('usa la base por defecto si no viene ULTRAMSG_BASE_URL', () => {
      const cfg = loadUltramsgConfig({});
      expect(cfg.baseUrl).toBe('https://api.ultramsg.com');
      expect(cfg.configured).toBe(false);
    });

    it('arma la URL con el instance id', () => {
      const cfg = loadUltramsgConfig({
        ULTRAMSG_BASE_URL: 'https://api.ultramsg.com',
        ULTRAMSG_INSTANCE_ID: 'instance170610',
        ULTRAMSG_TOKEN: 'tok123',
      });
      expect(cfg.apiUrl).toBe(
        'https://api.ultramsg.com/instance170610/messages/chat',
      );
    });

    it('no duplica el instance id si la base ya lo trae', () => {
      const cfg = loadUltramsgConfig({
        ULTRAMSG_BASE_URL: 'https://api.ultramsg.com/instance170610/',
        ULTRAMSG_INSTANCE_ID: 'instance170610',
        ULTRAMSG_TOKEN: 'tok123',
      });
      expect(cfg.apiUrl).toBe(
        'https://api.ultramsg.com/instance170610/messages/chat',
      );
    });

    it('lee el destinatario de prueba', () => {
      const cfg = loadUltramsgConfig({
        ULTRAMSG_INSTANCE_ID: 'instance170610',
        ULTRAMSG_TOKEN: 'tok123',
        ULTRAMSG_TEST_TO: '51993314858@c.us',
      });
      expect(cfg.testTo).toBe('51993314858@c.us');
    });

    it('solo permite usuarios por defecto (los grupos se descartan)', () => {
      expect(loadUltramsgConfig({}).allowGroups).toBe(false);
      expect(
        loadUltramsgConfig({ ULTRAMSG_ALLOW_GROUPS: 'true' }).allowGroups,
      ).toBe(true);
    });
  });

  describe('UltramsgService.sendMessage', () => {
    beforeEach(() => {
      process.env.ULTRAMSG_BASE_URL = 'https://api.ultramsg.com';
      process.env.ULTRAMSG_INSTANCE_ID = 'instance123';
      process.env.ULTRAMSG_TOKEN = 'tok123';
    });

    it('envía el mensaje a la URL de UltraMsg con token, to y body', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ sent: 'true', message: 'ok', id: 44897 }),
      );

      const service = new UltramsgService();
      const result = await service.sendMessage('+17876807222', 'Hola Retina');

      expect(result.success).toBe(true);
      expect(result.message).toBe('ok');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.ultramsg.com/instance123/messages/chat');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        token: 'tok123',
        to: '+17876807222',
        body: 'Hola Retina',
      });
    });

    it('reporta el error que devuelve la API', async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ Error: 'instance not found or pending' }),
      );

      const service = new UltramsgService();
      const result = await service.sendMessage('+17876807222', 'Hola');

      expect(result.success).toBe(false);
      expect(result.message).toBe('instance not found or pending');
    });

    it('reporta el error HTTP', async () => {
      fetchMock.mockResolvedValue(
        mockResponse('nope', { ok: false, status: 404 }),
      );

      const service = new UltramsgService();
      const result = await service.sendMessage('+17876807222', 'Hola');

      expect(result.success).toBe(false);
      expect(result.message).toContain('404');
    });

    it('no llama a la API si faltan las credenciales', async () => {
      process.env.ULTRAMSG_INSTANCE_ID = 'tu_id_de_instancia';

      const service = new UltramsgService();
      const result = await service.sendMessage('+17876807222', 'Hola');

      expect(result.success).toBe(false);
      expect(result.message).toContain('no está configurado');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no llama a la API si falta el destinatario o el texto', async () => {
      const service = new UltramsgService();

      expect((await service.sendMessage('', 'Hola')).success).toBe(false);
      expect((await service.sendMessage('+17876807222', '')).success).toBe(
        false,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('usa ULTRAMSG_TEST_TO cuando el request no trae "to"', async () => {
      process.env.ULTRAMSG_TEST_TO = '51993314858@c.us';
      fetchMock.mockResolvedValue(
        mockResponse({ sent: 'true', message: 'ok', id: 1 }),
      );

      const service = new UltramsgService();
      const result = await service.sendMessage(undefined, 'Hola Retina');

      expect(result.success).toBe(true);
      const [, init] = fetchMock.mock.calls[0];
      const sent = JSON.parse(init.body) as { to: string };
      expect(sent.to).toBe('51993314858@c.us');
    });

    it('no envía a un grupo de WhatsApp', async () => {
      const service = new UltramsgService();
      const result = await service.sendMessage(
        '120363228356317247-441234567890@g.us',
        'Hola grupo',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('grupo');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('envía a un grupo si ULTRAMSG_ALLOW_GROUPS=true', async () => {
      process.env.ULTRAMSG_ALLOW_GROUPS = 'true';
      fetchMock.mockResolvedValue(
        mockResponse({ sent: 'true', message: 'ok', id: 1 }),
      );

      const service = new UltramsgService();
      const result = await service.sendMessage(
        '120363228356317247-441234567890@g.us',
        'Hola grupo',
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
