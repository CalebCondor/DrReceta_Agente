import { Controller, Post, Body } from '@nestjs/common';
import { OllamaService } from './ollama.service';

@Controller('ollama')
export class OllamaController {
  constructor(private readonly ollamaService: OllamaService) {}

  @Post('send-message')
  async sendMessage(
    @Body('prompt') prompt: string,
  ): Promise<{ response: string }> {
    const response = await this.ollamaService.runGemma3(prompt);
    return { response };
  }
}
