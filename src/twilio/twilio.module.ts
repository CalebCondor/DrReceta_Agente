import { Module } from '@nestjs/common';
import { TwilioController } from './twilio.controller';
import { TwilioService } from './twilio.service';
import { DbService } from '../agent/db.service';
import { AgentService } from '../agent/agent.service';

@Module({
  controllers: [TwilioController],
  providers: [TwilioService, DbService, AgentService],
  exports: [TwilioService],
})
export class TwilioModule {}
