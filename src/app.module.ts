import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './chat/chat.module';
import { OllamaModule } from './ollama/ollama.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ChatModule, OllamaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
