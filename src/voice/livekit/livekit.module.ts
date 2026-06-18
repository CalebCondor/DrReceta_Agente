import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import voiceConfig from '../voice.config';
import { LiveKitService } from './livekit.service';
import { LiveKitController } from './livekit.controller';

@Module({
  imports: [ConfigModule.forFeature(voiceConfig)],
  controllers: [LiveKitController],
  providers: [LiveKitService],
  exports: [LiveKitService],
})
export class LiveKitModule {}
