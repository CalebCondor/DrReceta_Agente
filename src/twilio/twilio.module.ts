import { Module } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { TwilioController } from './twilio.controller';
import { OllamaService } from '../ollama/ollama.service';

@Module({
  providers: [TwilioService, OllamaService],
  controllers: [TwilioController],
  exports: [TwilioService],
})
export class TwilioModule {}
