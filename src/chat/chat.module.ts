// src/chat/chat.module.ts

import { Module } from '@nestjs/common';
import { DbService } from '../agent/db.service';
import { AgentService } from '../agent/agent.service';
import { ChatController } from './chat.controller';

@Module({
  controllers: [ChatController],
  providers: [DbService, AgentService],
})
export class ChatModule {}
