import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { WebSocket, WebSocketServer as WSServer } from 'ws';

type ClientMeta = { subscribedChatIds: Set<string> };

@WebSocketGateway({
  cors: { origin: '*' },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: WSServer;

  private meta = new WeakMap<WebSocket, ClientMeta>();

  handleConnection(client: WebSocket) {
    this.meta.set(client, { subscribedChatIds: new Set() });
    this.logger.log(`Cliente conectado: ${this.idOf(client)}`);
  }

  handleDisconnect(client: WebSocket) {
    this.meta.delete(client);
    this.logger.log(`Cliente desconectado: ${this.idOf(client)}`);
  }

  /**
   * Cliente se suscribe a eventos de un chat_id.
   * Espera: { event: 'subscribe', data: { chat_id: number|string } }
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { chat_id: number | string },
    @ConnectedSocket() client: WebSocket,
  ) {
    const chatId = String(data?.chat_id ?? '').trim();
    if (!chatId) {
      this.send(client, {
        event: 'subscribed',
        ok: false,
        error: 'chat_id requerido',
      });
      return;
    }
    const m = this.meta.get(client);
    if (m) m.subscribedChatIds.add(chatId);
    this.logger.log(`Cliente ${this.idOf(client)} suscrito a chat:${chatId}`);
    this.send(client, { event: 'subscribed', ok: true, chat_id: chatId });
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: { chat_id: number | string },
    @ConnectedSocket() client: WebSocket,
  ) {
    const chatId = String(data?.chat_id ?? '').trim();
    if (!chatId) return;
    const m = this.meta.get(client);
    if (m) m.subscribedChatIds.delete(chatId);
    this.send(client, { event: 'unsubscribed', ok: true, chat_id: chatId });
  }

  // ─── Métodos públicos para emitir desde otros servicios ────────────────

  emitHumanMessage(chatId: number | string, payload: unknown) {
    this.broadcastToChat(String(chatId), {
      event: 'human-message',
      data: payload,
    });
  }

  emitPauseStatus(chatId: number | string, paused: boolean) {
    this.broadcastToChat(String(chatId), {
      event: 'pause-status',
      data: { chat_id: chatId, paused },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private broadcastToChat(chatId: string, message: unknown) {
    if (!this.server?.clients) return;
    let count = 0;
    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const m = this.meta.get(client);
      if (m?.subscribedChatIds.has(chatId)) {
        this.send(client, message);
        count++;
      }
    }
    if (count > 0) {
      this.logger.log(
        `WS → chat:${chatId} (${count} cliente(s)): ${(message as { event?: string }).event ?? 'unknown'}`,
      );
    }
  }

  private send(client: WebSocket, message: unknown) {
    try {
      client.send(JSON.stringify(message));
    } catch (e) {
      this.logger.warn(`Error enviando WS a cliente: ${e}`);
    }
  }

  private idOf(client: WebSocket): string {
    // @ts-expect-error la prop _id existe en runtime
    return client._id ?? 'unknown';
  }
}
