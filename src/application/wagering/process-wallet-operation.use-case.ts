import { createHash, randomUUID } from 'node:crypto';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Money } from '../../domain/shared/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { LedgerDirection, WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry.js';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '../../domain/wager/wager-transaction.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

export interface ProcessWalletOperationInput {
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  roundId: string;
  gameId: string;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
}

export interface ProcessWalletOperationResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: string;
  failureCode?: string;
  idempotent: boolean;
}

/** Reutiliza o fluxo transacional sem duplicar a lógica de BET. */
export class ProcessWalletOperationUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(kind: WagerTransactionKind, input: ProcessWalletOperationInput): Promise<ProcessWalletOperationResult> {
    if (![WagerTransactionKind.Win, WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(kind)) {
      throw new Error('Unsupported wallet operation');
    }
    const money = Money.from({ amount: input.amount, currency: input.currency });
    if (!money.isPositive()) throw new Error('Transaction amount must be positive');
    const reference = input.referenceExternalTransactionId?.trim();
    if (kind !== WagerTransactionKind.Win && !reference) {
      throw new Error('Reference transaction is required');
    }
    if (kind === WagerTransactionKind.Win && reference) {
      throw new Error('WIN must not reference another transaction');
    }

    const payloadHash = createHash('sha256').update(JSON.stringify([
      input.providerId, input.externalTransactionId, input.walletId, input.playerId,
      input.roundId, input.gameId, money.toJSON().amount, input.currency, kind, reference ?? null,
    ])).digest('hex');

    return this.em.transactional(async (tx) => {
      // Ordenação fixa evita deadlocks entre requisições com chaves sobrepostas.
      const lockKeys = [
        `wager:key:${input.idempotencyKey}`,
        `wager:external:${input.providerId}:${input.externalTransactionId}`,
        `wallet:${input.walletId}`,
        ...(reference ? [`wager:reference:${input.providerId}:${reference}`] : []),
      ].sort();
      for (const key of lockKeys) {
        await tx.execute('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [key]);
      }

      const existing = await tx.findOne(WagerTransactionOrmEntity, {
        $or: [
          { idempotencyKey: input.idempotencyKey },
          { providerId: input.providerId, externalTransactionId: input.externalTransactionId },
        ],
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.idempotencyKey !== input.idempotencyKey ||
            existing.providerId !== input.providerId || existing.externalTransactionId !== input.externalTransactionId) {
          throw new Error('Idempotency conflict');
        }
        const currentWallet = await tx.findOneOrFail(WalletOrmEntity, { id: existing.wallet.id });
        return {
          transactionId: existing.id, status: existing.status, balance: currentWallet.balance,
          failureCode: existing.failureCode, idempotent: true,
        };
      }

      const walletEntity = await tx.findOne(WalletOrmEntity, { id: input.walletId }, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });
      if (!walletEntity) throw new Error('Wallet not found');
      if (walletEntity.playerId !== input.playerId) throw new Error('Wallet ownership mismatch');
      if (walletEntity.currency !== input.currency) throw new Error('Currency mismatch');

      let original: WagerTransactionOrmEntity | null = null;
      if (reference) {
        original = await tx.findOne(WagerTransactionOrmEntity, {
          providerId: input.providerId, externalTransactionId: reference,
        });
        if (!original) throw new Error('Reference transaction not found');
        if (original.status !== WagerTransactionStatus.Processed) throw new Error('Reference transaction is not processed');
        if (original.wallet.id !== input.walletId || original.playerId !== input.playerId ||
            original.currency !== input.currency || original.roundId !== input.roundId ||
            original.gameId !== input.gameId) throw new Error('Reference transaction mismatch');
        if (original.amount !== money.toJSON().amount) throw new Error('Reference amount mismatch');
        if (kind === WagerTransactionKind.Refund && original.kind !== WagerTransactionKind.Bet) {
          throw new Error('REFUND requires a processed BET');
        }
        if (kind === WagerTransactionKind.Rollback &&
            ![WagerTransactionKind.Bet, WagerTransactionKind.Win].includes(original.kind)) {
          throw new Error('ROLLBACK requires a processed BET or WIN');
        }
        // Impede dupla compensação (inclusive REFUND seguido de ROLLBACK).
        const compensated = await tx.findOne(WagerTransactionOrmEntity, {
          providerId: input.providerId,
          referenceExternalTransactionId: reference,
          status: WagerTransactionStatus.Processed,
          kind: { $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback] },
        });
        if (compensated) throw new Error('Reference transaction already compensated');
      }

      const wallet = Wallet.rehydrate({
        id: walletEntity.id, playerId: walletEntity.playerId, currency: walletEntity.currency,
        balance: Money.from({ amount: walletEntity.balance, currency: walletEntity.currency }),
        version: walletEntity.version, createdAt: walletEntity.createdAt, updatedAt: walletEntity.updatedAt,
      });
      const transactionId = randomUUID();
      const wager = WagerTransaction.create({
        id: transactionId, providerId: input.providerId, externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey, payloadHash, walletId: input.walletId,
        playerId: input.playerId, roundId: input.roundId, gameId: input.gameId,
        kind, money, referenceExternalTransactionId: reference,
      });
      const shouldDebit = kind === WagerTransactionKind.Rollback && original?.kind === WagerTransactionKind.Win;
      let ledger: WalletLedgerEntry | undefined;
      try {
        const movement = shouldDebit ? wallet.debit(money) : wallet.credit(money);
        ledger = WalletLedgerEntry.create({
          id: randomUUID(), walletId: input.walletId, transactionId,
          direction: shouldDebit ? LedgerDirection.Debit : LedgerDirection.Credit,
          money: movement.money, balanceBefore: movement.balanceBefore,
          balanceAfter: movement.balanceAfter, createdAt: new Date(),
        });
        wager.markProcessed(original?.id, new Date());
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Insufficient balance') throw error;
        wager.reject('INSUFFICIENT_FUNDS');
      }

      const wagerEntity = tx.create(WagerTransactionOrmEntity, {
        id: wager.id, providerId: wager.providerId, externalTransactionId: wager.externalTransactionId,
        idempotencyKey: wager.idempotencyKey, payloadHash: wager.payloadHash,
        wallet: walletEntity, playerId: wager.playerId, roundId: wager.roundId, gameId: wager.gameId,
        kind: wager.kind, amount: money.toJSON().amount, currency: money.currency,
        status: wager.status, referenceExternalTransactionId: wager.referenceExternalTransactionId,
        referenceTransactionId: wager.referenceTransactionId, failureCode: wager.failureCode,
        createdAt: wager.createdAt, processedAt: wager.processedAt,
      });
      if (ledger) {
        walletEntity.balance = wallet.balance.toJSON().amount;
        walletEntity.version = wallet.version;
        walletEntity.updatedAt = new Date();
        tx.create(WalletLedgerEntryOrmEntity, {
          id: ledger.id, wallet: walletEntity, transactionId: ledger.transactionId,
          direction: ledger.direction, amount: ledger.money.toJSON().amount,
          currency: ledger.money.currency, balanceBefore: ledger.balanceBefore.toJSON().amount,
          balanceAfter: ledger.balanceAfter.toJSON().amount, createdAt: ledger.createdAt,
        });
      }
      await tx.flush();
      return {
        transactionId: wagerEntity.id, status: wagerEntity.status, balance: walletEntity.balance,
        failureCode: wagerEntity.failureCode, idempotent: false,
      };
    });
  }
}
