
import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  // Consulta pelo UUID interno do sistema.
  async byId(transactionId: string) {
    const transaction = await this.em.findOne(
      WagerTransactionOrmEntity,
      { id: transactionId },
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return this.toResponse(transaction);
  }

  // Consulta pela identificação enviada pelo provedor.
  async byExternalId(
    providerId: string,
    externalTransactionId: string,
  ) {
    const transaction = await this.em.findOne(
      WagerTransactionOrmEntity,
      {
        providerId,
        externalTransactionId,
      },
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return this.toResponse(transaction);
  }

  // Centraliza o contrato de resposta dos dois endpoints.
  private toResponse(transaction: WagerTransactionOrmEntity) {
    return {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      playerId: transaction.playerId,
      walletId: transaction.wallet.id,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      money: {
        amount: transaction.amount,
        currency: transaction.currency,
      },
      status: transaction.status,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId:
        transaction.referenceTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt ?? null,
    };
  }
}
