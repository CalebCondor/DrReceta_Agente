import {
  Body,
  Controller,
  HttpCode,
  Post,
  Get,
  Delete,
  Param,
  ParseIntPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { AgentService } from '../agent/agent.service';
import { ChatService } from './chat.service';
class PreguntaRespuestaDto {
  @IsString()
  @IsNotEmpty()
  pregunta!: string;

  @IsString()
  @IsNotEmpty()
  respuesta!: string;
}
// src/chat/chat.controller.ts

class ChatDto {
  @IsNumber()
  @Type(() => Number)
  chat_id: number;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  user_name?: string;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly agentService: AgentService,
    private readonly chatService: ChatService,
  ) {}
  // Listar todas las preguntas y respuestas
  @Get('/conocimiento')
  async listPreguntasRespuestas() {
    try {
      const data = await this.chatService.listPreguntasRespuestas();
      return { success: true, total: data.length, data };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Insertar una nueva pregunta y respuesta
  @Post('/conocimiento')
  @HttpCode(201)
  async insertPreguntaRespuesta(@Body() body: PreguntaRespuestaDto) {
    try {
      const result = await this.chatService.insertPreguntaRespuesta(
        body.pregunta,
        body.respuesta,
      );
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('')
  @HttpCode(200)
  async chat(@Body() body: ChatDto) {
    try {
      const response = await this.agentService.chat(
        body.chat_id,
        body.message,
        body.user_name,
      );
      return { success: true, response };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('/user/:us_id')
  async getChatsByUser(@Param('us_id', ParseIntPipe) usId: number) {
    try {
      const messages = await this.chatService.getChatsByUserId(usId);
      return { success: true, chat_id: usId, total: messages.length, messages };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('/user/:us_id/fecha/:fecha')
  async deleteByUserIdAndDate(
    @Param('us_id', ParseIntPipe) usId: number,
    @Param('fecha') fecha: string,
  ) {
    try {
      const deleted = await this.chatService.deleteByUserIdAndDate(usId, fecha);
      return {
        success: true,
        message: `Se eliminaron ${deleted} mensaje(s) del chat ${usId} en la fecha ${fecha}.`,
        deleted,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('/users')
  async getAllUserIds() {
    try {
      const user_ids = await this.chatService.getAllUserIds();
      return { success: true, total: user_ids.length, user_ids };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
