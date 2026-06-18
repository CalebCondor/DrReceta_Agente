import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Redis from 'ioredis';
import voiceConfig from '../voice.config';
import { CallStateService } from './call-state.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  imports: [ConfigModule.forFeature(voiceConfig)],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (cfg: { redis: { url: string } }) => {
        const client = new Redis(cfg.redis.url, {
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
        client.on('error', (e) => {
          console.error('[redis] error', e.message);
        });
        client.on('connect', () => {
          console.log('[redis] connected');
        });
        return client;
      },
      inject: [voiceConfig.KEY],
    },
    CallStateService,
  ],
  exports: [REDIS_CLIENT, CallStateService],
})
export class RedisModule {}
