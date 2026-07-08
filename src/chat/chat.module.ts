// src/chat/chat.module.ts

import { Module } from '@nestjs/common';
import { DbService } from '../agent/db.service';
import { AgentService } from '../agent/agent.service';
import { AutoResumeService } from '../agent/auto-resume.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

@Module({
  controllers: [ChatController],
  providers: [
    DbService,
    AgentService,
    ChatService,
    ChatGateway,
    AutoResumeService,
  ],
  exports: [ChatGateway],
})
export class ChatModule {}
