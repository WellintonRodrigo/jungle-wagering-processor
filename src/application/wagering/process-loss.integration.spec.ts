import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../database/mikroOrmConfig.js';
import { ProcessLossUseCase } from './process-loss.use-case.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

// Testa LOSS contra PostgreSQL real; rollback preserva o banco de testes.
describe('LOSS — integração PostgreSQL', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'jungle_wagering_test') {
      throw new Error('Execute apenas com DB_NAME=jungle_wagering_test');
    }
    orm = await MikroORM.init(mikroOrmConfig);
  });
  afterAll(async () => { await orm?.close(true); });

  it('registra LOSS sem alterar saldo, versão ou ledger; replay é idempotente', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const walletId = randomUUID();
      const playerId = randomUUID();
      em.create(WalletOrmEntity, {
        id: walletId, playerId, currency: 'BRL', balance: '100.00',
        version: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      await em.flush();
      const input = {
        walletId, playerId, providerId: 'loss-test', externalTransactionId: randomUUID(),
        idempotencyKey: randomUUID(), roundId: 'round-loss', gameId: 'game-loss',
        amount: '25.00', currency: 'BRL',
      };
      const useCase = new ProcessLossUseCase(em);
      const first = await useCase.execute(input);
      const replay = await useCase.execute(input);
      expect(first.status).toBe('PROCESSED');
      expect(first.balance).toBe('100.00');
      expect(replay.idempotent).toBe(true);
      expect(replay.transactionId).toBe(first.transactionId);
      const wallet = await em.findOneOrFail(WalletOrmEntity, { id: walletId }, { refresh: true });
      expect(wallet.balance).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(await em.count(WalletLedgerEntryOrmEntity, { transactionId: first.transactionId })).toBe(0);
      expect(await em.count(WagerTransactionOrmEntity, { id: first.transactionId })).toBe(1);
    } finally {
      await em.rollback();
    }
  });
});
