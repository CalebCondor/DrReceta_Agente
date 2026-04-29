import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { OllamaModule } from './ollama/ollama.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ChatModule, OllamaModule],
})
export class AppModule {}
