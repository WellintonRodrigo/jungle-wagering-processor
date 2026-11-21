import { Module } from '@nestjs/common';
import { WageringController } from './wagering.controller.js';
import { WageringDispatcher } from './wagering.dispatcher.js';

@Module({
  controllers: [WageringController],
  providers: [WageringDispatcher],
})
export class WageringModule {}
