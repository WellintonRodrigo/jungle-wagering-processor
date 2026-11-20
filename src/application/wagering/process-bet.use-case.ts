
import { randomUUID, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';

import { Money } from '../../domain/shared/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletLedgerEntry, LedgerDirection } from '../../domain/wallet/wallet-ledger-entry.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager/wager-transaction.js';

import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

export interface ProcessBetInput {
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  roundId: string;
  gameId: string;
  amount: string;
  currency: string;
}

export interface ProcessBetResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: string;
  failureCode?: string;
  idempotent: boolean;
}

@Injectable()
export class ProcessBetUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: ProcessBetInput): Promise<ProcessBetResult> {
    // Validação antes de abrir a transação.
    const money = Money.from({
      amount: input.amount,
      currency: input.currency,
    });

    if (!money.isPositive()) {
      throw new Error('Transaction amount must be positive');
    }

    const normalizedAmount = money.toJSON().amount;

    // Hash determinístico: mesmo payload gera o mesmo hash.
    const payloadHash = createHash('sha256')
      .update(JSON.stringify([
        input.providerId,
        input.externalTransactionId,
        input.walletId,
        input.playerId,
        input.roundId,
        input.gameId,
        normalizedAmount,
        input.currency,
        WagerTransactionKind.Bet,
      ]))
      .digest('hex');

    return this.em.transactional(async (tx) => {
      // Serializa tentativas com a mesma chave ou ID externo.
      // Os locks são liberados automaticamente ao finalizar a transação.
      const keys = [
        `bet:key:${input.idempotencyKey}`,
        `bet:external:${input.providerId}:${input.externalTransactionId}`,
      ].sort();

      for (const key of keys) {
        await tx.execute(
          'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))',
          [key],
        );
      }

      // Verifica as duas restrições de unicidade.
      const existing = await tx.findOne(
        WagerTransactionOrmEntity,
        {
          $or: [
            { idempotencyKey: input.idempotencyKey },
            {
              providerId: input.providerId,
              externalTransactionId: input.externalTransactionId,
            },
          ],
        },
      );

      if (existing) {
        if (
          existing.payloadHash !== payloadHash ||
          existing.idempotencyKey !== input.idempotencyKey ||
          existing.providerId !== input.providerId ||
          existing.externalTransactionId !== input.externalTransactionId
        ) {
          throw new Error('Idempotency conflict');
        }

        const currentWallet = await tx.findOneOrFail(
          WalletOrmEntity,
          { id: existing.wallet.id },
        );

        return {
          transactionId: existing.id,
          status: existing.status,
          balance: currentWallet.balance,
          failureCode: existing.failureCode,
          idempotent: true,
        };
      }

      // Bloqueia a carteira para impedir débitos concorrentes.
      const walletEntity = await tx.findOne(
        WalletOrmEntity,
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!walletEntity) {
        throw new Error('Wallet not found');
      }

      if (walletEntity.playerId !== input.playerId) {
        throw new Error('Wallet ownership mismatch');
      }

      if (walletEntity.currency !== input.currency) {
        throw new Error('Currency mismatch');
      }

      // Reconstitui o agregado com as regras de domínio.
      const wallet = Wallet.rehydrate({
        id: walletEntity.id,
        playerId: walletEntity.playerId,
        currency: walletEntity.currency,
        balance: Money.from({
          amount: walletEntity.balance,
          currency: walletEntity.currency,
        }),
        version: walletEntity.version,
        updatedAt: walletEntity.updatedAt,  
        createdAt: walletEntity.createdAt,
      });

      const transactionId = randomUUID();

      const wager = WagerTransaction.create({
        id: transactionId,
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: WagerTransactionKind.Bet,
        money,
      });

      let ledger: WalletLedgerEntry | undefined;

      try {
        // O domínio calcula o saldo e valida fundos.
        const movement = wallet.debit(money);

        ledger = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: input.walletId,
          transactionId,
          direction: LedgerDirection.Debit,
          money: movement.money,
          balanceBefore: movement.balanceBefore,
          balanceAfter: movement.balanceAfter,
          createdAt: new Date(),
        });

        wager.markProcessed(undefined, new Date());
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'Insufficient balance'
        ) {
          throw error;
        }

        // Rejeição de negócio: persiste sem alterar o saldo.
        wager.reject('INSUFFICIENT_FUNDS');
      }

      const wagerEntity = tx.create(WagerTransactionOrmEntity, {
        id: wager.id,
        providerId: wager.providerId,
        externalTransactionId: wager.externalTransactionId,
        idempotencyKey: wager.idempotencyKey,
        payloadHash: wager.payloadHash,
        wallet: walletEntity,
        playerId: wager.playerId,
        roundId: wager.roundId,
        gameId: wager.gameId,
        kind: wager.kind,
        amount: money.toJSON().amount,
        currency: money.currency,
        status: wager.status,
        failureCode: wager.failureCode,
        createdAt: wager.createdAt,
        processedAt: wager.processedAt,
      });

      if (ledger) {
        const movement = wallet.balance.toJSON();

        // Atualiza o saldo e a versão dentro da transação.
        walletEntity.balance = movement.amount;
        walletEntity.version = wallet.version;
        walletEntity.updatedAt = new Date();

        tx.create(WalletLedgerEntryOrmEntity, {
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
      }

      // Flush explícito: nenhuma alteração fica pendente.
      await tx.flush();

      return {
        transactionId: wagerEntity.id,
        status: wagerEntity.status,
        balance: walletEntity.balance,
        failureCode: wagerEntity.failureCode,
        idempotent: false,
      };
    });
  }
}
