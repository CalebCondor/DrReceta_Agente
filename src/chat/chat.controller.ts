import {
  Body,
  Controller,
  HttpCode,
  Post,
  Get,
  Put,
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
import { ChatGateway } from './chat.gateway';
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
  chat_id!: number;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  @IsString()
  user_name?: string;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly agentService: AgentService,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}
  // Listar todas las preguntas y respuestas
  @Get('/conocimiento')
  async listPreguntasRespuestas() {
    try {
      const data = await this.chatService.listPreguntasRespuestas();
      return { success: true, total: data.length, data };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server errors';
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

  // Editar (actualizar) una pregunta y respuesta existente por id
  @Put('/conocimiento/:id')
  @HttpCode(200)
  async updatePreguntaRespuesta(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PreguntaRespuestaDto,
  ) {
    try {
      const result = await this.chatService.updatePreguntaRespuesta(
        id,
        body.pregunta,
        body.respuesta,
      );
      if (!result.updated) {
        throw new HttpException(
          { success: false, error: `No se encontró el registro con id=${id}.` },
          HttpStatus.NOT_FOUND,
        );
      }
      return {
        ...result,
        message: `Registro ${id} actualizado correctamente.`,
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Eliminar una pregunta y respuesta por id
  @Delete('/conocimiento/:id')
  @HttpCode(200)
  async deletePreguntaRespuesta(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.chatService.deletePreguntaRespuesta(id);
      if (!result.deleted) {
        throw new HttpException(
          { success: false, error: `No se encontró el registro con id=${id}.` },
          HttpStatus.NOT_FOUND,
        );
      }
      return { ...result, message: `Registro ${id} eliminado correctamente.` };
    } catch (e) {
      if (e instanceof HttpException) throw e;
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

  // Pausar la conversación con un usuario (la IA deja de responderle)
  @Post('/user/:us_id/pause')
  @HttpCode(200)
  async pauseChat(@Param('us_id', ParseIntPipe) usId: number) {
    try {
      const result = await this.chatService.pauseChat(usId);
      this.chatGateway.emitPauseStatus(usId, true);
      return {
        success: true,
        chat_id: usId,
        alreadyPaused: result.alreadyPaused,
        pausado_en: result.pausado_en,
        message: result.alreadyPaused
          ? `El chat ${usId} ya estaba pausado.`
          : `Chat ${usId} pausado. La IA dejará de responder hasta que se reanude.`,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Reanudar la conversación con un usuario (la IA vuelve a responderle)
  @Post('/user/:us_id/resume')
  @HttpCode(200)
  async resumeChat(@Param('us_id', ParseIntPipe) usId: number) {
    try {
      const result = await this.chatService.resumeChat(usId);
      this.chatGateway.emitPauseStatus(usId, false);
      return {
        success: true,
        chat_id: usId,
        wasPaused: result.wasPaused,
        reanudado_en: result.reanudado_en,
        message: result.wasPaused
          ? `Chat ${usId} reanudado. La IA volverá a responder.`
          : `El chat ${usId} no estaba pausado.`,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Consultar el estado de pausa de un chat
  @Get('/user/:us_id/pause-status')
  async getPauseStatus(@Param('us_id', ParseIntPipe) usId: number) {
    try {
      const status = await this.chatService.getPauseStatus(usId);
      return { success: true, chat_id: usId, ...status };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Guardar un mensaje escrito por un humano (mientras la IA está pausada)
  @Post('/user/:us_id/human-message')
  @HttpCode(201)
  async saveHumanMessage(
    @Param('us_id', ParseIntPipe) usId: number,
    @Body() body: { message?: string },
  ) {
    try {
      const message = (body?.message ?? '').toString();
      const result = (await this.chatService.saveHumanMessage(
        usId,
        message,
      )) as {
        success: boolean;
        error?: string;
        id?: number | string;
      };
      if (!result.success) {
        return { success: false, error: result.error };
      }
      // Emitir por WebSocket a todos los clientes suscritos a este chat
      this.chatGateway.emitHumanMessage(usId, {
        id: result.id,
        chat_id: usId,
        role: 'human',
        content: message.trim(),
      });
      return { success: true, chat_id: usId, id: result.id };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      throw new HttpException(
        { success: false, error: message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
