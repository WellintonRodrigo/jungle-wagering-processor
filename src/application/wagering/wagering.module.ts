import { Module } from '@nestjs/common';
import { WageringController } from './wagering.controller.js';
import { WageringDispatcher } from './wagering.dispatcher.js';
import { ProviderTransactionsController } from '../../providers/provider-transactions.controller.js';
import { GetWagerTransactionUseCase } from './get-wager-transaction.use-case.js';

@Module({
  controllers: [
    WageringController, 
    ProviderTransactionsController
  ],
  providers: [
    WageringDispatcher, 
    GetWagerTransactionUseCase
  ],
})
export class WageringModule {}
