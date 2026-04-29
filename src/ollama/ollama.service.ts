import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import * as dotenv from 'dotenv';
dotenv.config();

@Injectable()
export class OllamaService {
  async runGemma3(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const model = process.env.OLLAMA_MODEL || 'gemma3:4b';
      const command = `echo "${prompt}" | ollama run ${model}`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          const clean = this.cleanResponse(stdout.trim());
          resolve(clean);
        }
      });
    });
  }

  cleanResponse(text: string): string {
    // Elimina emojis, caracteres especiales y múltiples espacios
    return text
      .replace(/[\p{Emoji}\p{So}\p{Cn}\p{Sk}\p{Sm}\p{Sc}]+/gu, '') // elimina emojis y símbolos
      .replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n]+/gu, '') // deja letras, números, puntuación, espacios y saltos de línea
      .replace(/ +/g, ' ') // reemplaza múltiples espacios por uno
      .replace(/\n{3,}/g, '\n\n') // máximo dos saltos de línea seguidos
      .trim();
  }
}
