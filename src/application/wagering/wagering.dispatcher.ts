import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ProcessBetUseCase } from './process-bet.use-case.js';
import { ProcessWinUseCase } from './process-win.use-case.js';
import { ProcessRefundUseCase } from './process-refund.use-case.js';
import { ProcessRollbackUseCase } from './process-rollback.use-case.js';
import { ProcessLossUseCase } from './process-loss.use-case.js';
import { OutboxEventOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/outbox-event.orm-entity.js';
import { randomUUID } from 'node:crypto';
import type { SubmitTransactionBody } from './wagering.types.js';

@Injectable()
export class WageringDispatcher {
  constructor(private readonly em: EntityManager) {}

  async execute(body: SubmitTransactionBody, idempotencyKey: string, manager?: EntityManager) {
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

    // Operação financeira e evento Outbox confirmam na mesma transação SQL.
    const em = manager ?? this.em.fork();
    const result = await em.transactional(async (tx) => {
      let operation;
      switch (body.kind) {
        case 'BET': operation = await new ProcessBetUseCase(tx).execute(input); break;
        case 'WIN': operation = await new ProcessWinUseCase(tx).execute(input); break;
        case 'REFUND': operation = await new ProcessRefundUseCase(tx).execute(input); break;
        case 'ROLLBACK': operation = await new ProcessRollbackUseCase(tx).execute(input); break;
        case 'LOSS': operation = await new ProcessLossUseCase(tx).execute(input); break;
      }
      if (!operation.idempotent) {
        tx.create(OutboxEventOrmEntity, {
          id: randomUUID(), aggregateId: operation.transactionId,
          eventType: 'WAGER_TRANSACTION_COMPLETED',
          payload: { transactionId: operation.transactionId, providerId: body.providerId,
            externalTransactionId: body.externalTransactionId, kind: body.kind,
            status: operation.status, failureCode: operation.failureCode ?? null },
          status: 'PENDING', attempts: 0, createdAt: new Date(),
        });
        await tx.flush();
      }
      return operation;
    });

    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: { amount: result.balance, currency: body.money.currency },
      idempotentReplay: result.idempotent,
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
    };
  }
}
