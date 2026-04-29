import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { OllamaModule } from './ollama/ollama.module';
import { TwilioModule } from './twilio/twilio.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,
    OllamaModule,
    TwilioModule,
  ],
})
export class AppModule {}
