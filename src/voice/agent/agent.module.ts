import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import voiceConfig from '../voice.config';
import { OpenAiSttService } from './stt/openai-stt.service';
import { OpenAiTtsService } from './tts/openai-tts.service';
import { ClaudeLlmService } from './llm/claude-llm.service';
import { VoiceTestHarness } from './agent.test-harness';
import { ChatModule } from '../../chat/chat.module';

@Module({
  imports: [ConfigModule.forFeature(voiceConfig), ChatModule],
  providers: [
    OpenAiSttService,
    OpenAiTtsService,
    ClaudeLlmService,
    VoiceTestHarness,
  ],
  exports: [
    OpenAiSttService,
    OpenAiTtsService,
    ClaudeLlmService,
    VoiceTestHarness,
  ],
})
export class AgentModule {}
