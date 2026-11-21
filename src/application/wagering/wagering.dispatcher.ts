import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ProcessBetUseCase } from './process-bet.use-case.js';
import { ProcessWinUseCase } from './process-win.use-case.js';
import { ProcessRefundUseCase } from './process-refund.use-case.js';
import { ProcessRollbackUseCase } from './process-rollback.use-case.js';
import type { SubmitTransactionBody } from './wagering.types.js';

@Injectable()
export class WageringDispatcher {
  constructor(private readonly em: EntityManager) {}

  async execute(body: SubmitTransactionBody, idempotencyKey: string) {
    const input = {
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      playerId: body.playerId,
      walletId: body.walletId,
      roundId: body.roundId,
      gameId: body.gameId,
      idempotencyKey,
      amount: body.money.amount,
      currency: body.money.currency,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
    };

    // Cada operação continua com suas regras de domínio e transação SQL.
    const em = this.em.fork();
    let result;
    switch (body.kind) {
      case 'BET': result = await new ProcessBetUseCase(em).execute(input); break;
      case 'WIN': result = await new ProcessWinUseCase(em).execute(input); break;
      case 'REFUND': result = await new ProcessRefundUseCase(em).execute(input); break;
      case 'ROLLBACK': result = await new ProcessRollbackUseCase(em).execute(input); break;
      case 'LOSS':
        // Não inventar persistência: LOSS exige registro PROCESSED sem alterar wallet/ledger.
        throw new UnprocessableEntityException('LOSS not implemented yet');
    }
    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: { amount: result.balance, currency: body.money.currency },
      idempotentReplay: result.idempotent,
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
    };
  }
}
