import { createHash, randomUUID } from 'node:crypto';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Money } from '../../domain/shared/money.js';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '../../domain/wager/wager-transaction.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';
import type { ProcessWalletOperationInput, ProcessWalletOperationResult } from './process-wallet-operation.use-case.js';

/** LOSS registra o resultado da rodada sem movimentar saldo ou ledger. */
export class ProcessLossUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: ProcessWalletOperationInput): Promise<ProcessWalletOperationResult> {
    const money = Money.from({ amount: input.amount, currency: input.currency });
    if (!money.isPositive()) throw new Error('Transaction amount must be positive');
    if (input.referenceExternalTransactionId) throw new Error('LOSS must not reference another transaction');
    const payloadHash = createHash('sha256').update(JSON.stringify([
      input.providerId, input.externalTransactionId, input.walletId, input.playerId,
      input.roundId, input.gameId, money.toJSON().amount, input.currency,
      WagerTransactionKind.Loss, null,
    ])).digest('hex');

    return this.em.transactional(async (tx) => {
      // Mesmo lock por chave/identidade externa evita registros duplicados em instâncias concorrentes.
      for (const key of [
        `wager:key:${input.idempotencyKey}`,
        `wager:external:${input.providerId}:${input.externalTransactionId}`,
      ].sort()) {
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
        const wallet = await tx.findOneOrFail(WalletOrmEntity, { id: existing.wallet.id });
        return { transactionId: existing.id, status: existing.status, balance: wallet.balance,
          failureCode: existing.failureCode, idempotent: true };
      }
      const wallet = await tx.findOne(WalletOrmEntity, { id: input.walletId }, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });
      if (!wallet) throw new Error('Wallet not found');
      if (wallet.playerId !== input.playerId) throw new Error('Wallet ownership mismatch');
      if (wallet.currency !== input.currency) throw new Error('Currency mismatch');
      const wager = WagerTransaction.create({
        id: randomUUID(), providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey, payloadHash,
        walletId: input.walletId, playerId: input.playerId,
        roundId: input.roundId, gameId: input.gameId,
        kind: WagerTransactionKind.Loss, money,
      });
      wager.markProcessed(undefined, new Date());
      const record = tx.create(WagerTransactionOrmEntity, {
        id: wager.id, providerId: wager.providerId,
        externalTransactionId: wager.externalTransactionId,
        idempotencyKey: wager.idempotencyKey, payloadHash: wager.payloadHash,
        wallet, playerId: wager.playerId, roundId: wager.roundId, gameId: wager.gameId,
        kind: wager.kind, amount: money.toJSON().amount, currency: money.currency,
        status: WagerTransactionStatus.Processed,
        createdAt: wager.createdAt, processedAt: wager.processedAt,
      });
      await tx.flush();
      return { transactionId: record.id, status: record.status, balance: wallet.balance, idempotent: false };
    });
  }
}
