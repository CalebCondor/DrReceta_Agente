import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import voiceConfig from './voice.config';
import { LiveKitModule } from './livekit/livekit.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { RedisModule } from './state/redis.module';

@Module({
  imports: [ConfigModule.forFeature(voiceConfig), RedisModule, LiveKitModule],
  controllers: [VoiceController],
  providers: [VoiceService],
  exports: [VoiceService, LiveKitModule],
})
export class VoiceModule {}
