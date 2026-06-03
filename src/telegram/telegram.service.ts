import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { AgentService } from '../agent/agent.service';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    const enabledRaw =
      this.config.get<string>('TELEGRAM_ENABLED') ??
      process.env.TELEGRAM_ENABLED ??
      'true';
    const enabled = enabledRaw.toLowerCase() !== 'false';
    if (!enabled) {
      this.logger.log('Telegram disabled via TELEGRAM_ENABLED=false');
      return;
    }

    const token =
      this.config.get<string>('TELEGRAM_BOT_TOKEN') ??
      process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN not set; Telegram bot will not start.',
      );
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on('polling_error', (err) => {
      this.logger.error(`polling_error: ${err.message}`);
    });

    this.bot.on('webhook_error', (err) => {
      this.logger.error(`webhook_error: ${err.message}`);
    });

    this.bot.on('message', (msg) => {
      this.handleIncomingMessage(msg).catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Error handling Telegram message: ${message}`);
      });
    });

    this.logger.log('Telegram bot started (polling).');
  }

  async onModuleDestroy() {
    if (!this.bot) return;

    try {
      // node-telegram-bot-api exposes stopPolling for polling mode
      const maybeStop = (this.bot as unknown as { stopPolling?: () => any })
        .stopPolling;
      if (typeof maybeStop === 'function') {
        await maybeStop.call(this.bot);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Error stopping Telegram polling: ${message}`);
    } finally {
      this.bot.removeAllListeners();
      this.bot = undefined;
    }
  }

  /**
   * Enviar un mensaje a un chat desde cualquier parte del backend.
   * Requiere que `TELEGRAM_BOT_TOKEN` esté configurado.
   */
  async sendMessage(chatId: number, text: string) {
    if (!this.bot) {
      throw new Error(
        'Telegram bot not initialized (missing TELEGRAM_BOT_TOKEN?)',
      );
    }
    await this.sendMessageSafe(chatId, text);
  }

  private async handleIncomingMessage(msg: TelegramBot.Message) {
    if (!this.bot) return;

    const text = msg.text?.trim();
    if (!text) return;

    const chatId = msg.chat.id;
    const userName = msg.from?.username ?? msg.from?.first_name;

    if (text === '/start') {
      await this.bot.sendMessage(
        chatId,
        'Hola. Envíame tu mensaje y te respondo aquí mismo.',
      );
      return;
    }

    const response = await this.agentService.chat(chatId, text, userName);
    await this.sendMessageSafe(chatId, response);
  }

  private splitMessage(text: string, maxLen = 3500): string[] {
    const normalized = String(text ?? '').trim();
    if (!normalized) return [''];

    const chunks: string[] = [];
    for (let i = 0; i < normalized.length; i += maxLen) {
      chunks.push(normalized.slice(i, i + maxLen));
    }
    return chunks;
  }

  private async sendMessageSafe(chatId: number, text: string) {
    if (!this.bot) return;

    const parts = this.splitMessage(text);
    for (const part of parts) {
      // Intentar HTML (por si el agente devuelve formatted_html), y fallback a plain.
      try {
        await this.bot.sendMessage(chatId, part, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      } catch {
        await this.bot.sendMessage(chatId, part, {
          disable_web_page_preview: true,
        });
      }
    }
  }
}
