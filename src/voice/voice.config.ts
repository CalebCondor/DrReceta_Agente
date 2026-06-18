import { registerAs } from '@nestjs/config';

export interface VoiceConfig {
  livekit: {
    url: string;
    apiKey: string;
    apiSecret: string;
    domain: string;
    sipNodeIp: string;
    sipTrunkId: string;
  };
  openai: {
    apiKey: string;
    sttModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
  twilio: {
    sipTrunkDomain: string;
    sipUsername: string;
    sipPassword: string;
  };
  redis: {
    url: string;
  };
  recording: {
    dir: string;
    retentionDays: number;
  };
  voice: {
    language: string;
    agentName: string;
    greeting: string;
  };
}

export default registerAs<VoiceConfig>('voice', () => ({
  livekit: {
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
    domain: process.env.LIVEKIT_DOMAIN || 'localhost',
    sipNodeIp: process.env.LIVEKIT_SIP_NODE_IP || '127.0.0.1',
    sipTrunkId: process.env.LIVEKIT_SIP_TRUNK_ID || '',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    sttModel: process.env.OPENAI_STT_MODEL || 'whisper-1',
    ttsModel: process.env.OPENAI_TTS_MODEL || 'tts-1',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'nova',
  },
  twilio: {
    sipTrunkDomain: process.env.TWILIO_SIP_TRUNK_DOMAIN || '',
    sipUsername: process.env.TWILIO_SIP_USERNAME || '',
    sipPassword: process.env.TWILIO_SIP_PASSWORD || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  recording: {
    dir: process.env.RECORDINGS_DIR || './recordings',
    retentionDays: parseInt(process.env.RECORDINGS_RETENTION_DAYS || '30', 10),
  },
  voice: {
    language: process.env.VOICE_LANGUAGE || 'es-ES',
    agentName: process.env.VOICE_AGENT_NAME || 'Isla',
    greeting:
      process.env.VOICE_GREETING ||
      'Hola, soy Isla, asistente de IslandMedPR. ¿En qué puedo ayudarte?',
  },
}));
