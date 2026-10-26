import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DbService } from './db.service';
import { ChatGateway } from '../chat/chat.gateway';

const DEFAULT_TIMEOUT_MIN = 5;
const CHECK_INTERVAL_MS = 30_000;

@Injectable()
export class AutoResumeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoResumeService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly timeoutMinutes: number;

  constructor(
    private readonly db: DbService,
    private readonly chatGateway: ChatGateway,
  ) {
    const env = parseInt(process.env.HUMAN_TIMEOUT_MINUTES ?? '', 10);
    this.timeoutMinutes =
      Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MIN;
  }

  onModuleInit() {
    this.interval = setInterval(() => {
      this.checkInactiveChats().catch((e) =>
        this.logger.error(`Error en checkInactiveChats: ${e}`),
      );
    }, CHECK_INTERVAL_MS);
    this.logger.log(
      `AutoResumeService activo: timeout=${this.timeoutMinutes} min, check cada ${CHECK_INTERVAL_MS / 1000}s`,
    );
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  /**
   * Auto-reanuda chats en los que el humano tomó el control pero no respondió
   * en el tiempo configurado. Usa como referencia el ÚLTIMO mensaje del chat
   * (si existe) o la marca de pausa, lo que sea más reciente.
   */
  private async checkInactiveChats(): Promise<void> {
    const { rows } = await this.db.query(
      `UPDATE chats_pausados cp
       SET reanudado_en = NOW()
       WHERE cp.reanudado_en IS NULL
         AND COALESCE(
           (SELECT MAX(hm.created_at)
            FROM historial_mensajes hm
            WHERE hm.chat_id = cp.chat_id),
           cp.pausado_en
         ) < NOW() - ($1 || ' minutes')::interval
       RETURNING cp.chat_id, cp.pausado_en`,
      [String(this.timeoutMinutes)],
    );

    const resumed = rows as Array<{
      chat_id: number | string;
      pausado_en: Date;
    }>;
    if (resumed.length === 0) return;

    for (const r of resumed) {
      this.logger.log(
        `Auto-resume chat ${r.chat_id} por inactividad (${this.timeoutMinutes} min sin mensajes)`,
      );
      this.chatGateway.emitPauseStatus(r.chat_id, false);
    }
  }
}
