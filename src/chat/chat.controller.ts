// src/chat/chat.controller.ts

import {
  Body,
  Controller,
  HttpCode,
  Post,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsString, IsNotEmpty } from 'class-validator';
import { AgentService } from '../agent/agent.service';

class ChatDto {
  @IsNumber()
  @Type(() => Number)
  chat_id: number;

  @IsString()
  @IsNotEmpty()
  message: string;
}

@Controller('api')
export class ChatController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  @HttpCode(200)
  async chat(@Body() body: ChatDto) {
    try {
      const response = await this.agentService.chat(body.chat_id, body.message);
      return { success: true, response };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
