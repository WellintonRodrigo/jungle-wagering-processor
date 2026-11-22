
import { randomUUID, createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../domain/shared/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../domain/wallet/wallet-ledger-entry.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager/wager-transaction.js';

import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: {
    amount: string;
    currency: string;
  };
}

@Injectable()
export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput) {
    const money = Money.from(input.initialBalance);

    if (money.isNegative()) {
      throw new Error('Initial balance cannot be negative');
    }

    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: input.playerId,
      initialBalance: money,
    });

    try {
      return await this.em.transactional(async (tx) => {
        const existing = await tx.findOne(WalletOrmEntity, {
          playerId: wallet.playerId,
          currency: wallet.currency,
        });

        if (existing) {
          throw new ConflictException('Wallet already exists');
        }

        const walletEntity = tx.create(WalletOrmEntity, {
          id: wallet.id,
          playerId: wallet.playerId,
          currency: wallet.currency,
          balance: wallet.balance.toJSON().amount,
          version: wallet.version,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        });

        tx.persist(walletEntity);

        // Saldo zero não produz movimentação financeira.
        if (money.isPositive()) {
          const transactionId = randomUUID();
          const now = new Date();
          const amount = money.toJSON().amount;

          // Identificadores internos exclusivos para OPENING.
          const externalId = `opening:${wallet.id}`;

          const payloadHash = createHash('sha256')
            .update(JSON.stringify([
              wallet.id,
              wallet.playerId,
              amount,
              wallet.currency,
              WagerTransactionKind.Opening,
            ]))
            .digest('hex');

          const opening = tx.create(WagerTransactionOrmEntity, {
            id: transactionId,
            providerId: 'internal',
            externalTransactionId: externalId,
            idempotencyKey: externalId,
            payloadHash,
            wallet: walletEntity,
            playerId: wallet.playerId,
            roundId: 'opening',
            gameId: 'wallet',
            kind: WagerTransactionKind.Opening,
            amount,
            currency: wallet.currency,
            status: WagerTransactionStatus.Processed,
            createdAt: now,
            processedAt: now,
          });

          tx.persist(opening);

          const ledger = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId,
            direction: LedgerDirection.Credit,
            money,
            balanceBefore: Money.zero(wallet.currency),
            balanceAfter: wallet.balance,
            createdAt: now,
          });

          const ledgerEntity = tx.create(WalletLedgerEntryOrmEntity, {
            id: ledger.id,
            wallet: walletEntity,
            transactionId: ledger.transactionId,
            direction: ledger.direction,
            amount: ledger.money.toJSON().amount,
            currency: ledger.money.currency,
            balanceBefore: ledger.balanceBefore.toJSON().amount,
            balanceAfter: ledger.balanceAfter.toJSON().amount,
            createdAt: ledger.createdAt,
          });

          tx.persist(ledgerEntity);
        }

        // Flush único: todas as inserções participam do mesmo commit.
        await tx.flush();

        return {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: wallet.balance.toJSON(),
          version: wallet.version,
        };
      });
    } catch (error) {
      // A restrição única no banco também protege contra concorrência.
      if (
        error instanceof Error &&
        (error.message.includes('uq_wallet_player_currency') ||
          error.message.includes('wallets_player_id_currency_unique'))
      ) {
        throw new ConflictException('Wallet already exists');
      }

      throw error;
    }
  }
}
