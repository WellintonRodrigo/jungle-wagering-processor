import { Controller, Get, Param } from '@nestjs/common';

import { GetWagerTransactionUseCase } from '../application/wagering/get-wager-transaction.use-case.js';

@Controller('providers')
export class ProviderTransactionsController {
  constructor(private readonly getTransaction: GetWagerTransactionUseCase) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  async findByExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.getTransaction.byExternalId(providerId, externalTransactionId);
  }
}
