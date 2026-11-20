import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../database/mikroOrmConfig.js';
import { ProcessBetUseCase } from './process-bet.use-case.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

/**
 * Integração avançada: concorrência e rollback com PostgreSQL real.
 * Nunca executar contra o banco principal.
 */
describe('ProcessBetUseCase - Concorrência e Rollback', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    if (process.env.DB_NAME !== 'jungle_wagering_test') {
      throw new Error('Integration tests require DB_NAME=jungle_wagering_test');
    }
    orm = await MikroORM.init(mikroOrmConfig);
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  // Cria uma carteira real, visível para conexões independentes.
  async function createWallet(walletId: string, playerId: string) {
    const em = orm.em.fork();
    const wallet = em.create(WalletOrmEntity, {
      id: walletId,
      playerId,
      currency: 'BRL',
      balance: '100.00',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persist(wallet).flush();
  }

  // Limpa somente os dados pertencentes à carteira exclusiva do teste.
  // A ordem respeita as FKs: ledger -> transações -> carteira.
  async function cleanup(walletId: string) {
    const em = orm.em.fork();
    await em.nativeDelete(WalletLedgerEntryOrmEntity, { wallet: walletId });
    await em.nativeDelete(WagerTransactionOrmEntity, { wallet: walletId });
    await em.nativeDelete(WalletOrmEntity, { id: walletId });
  }

  it('deve impedir gasto duplicado em duas BETs concorrentes', async () => {
    const walletId = randomUUID();
    const playerId = randomUUID();
    await createWallet(walletId, playerId);

    try {
      // Forks separados: cada requisição tem seu próprio contexto de persistência.
      const betA = new ProcessBetUseCase(orm.em.fork());
      const betB = new ProcessBetUseCase(orm.em.fork());
      const base = {
        walletId,
        playerId,
        providerId: 'integration-provider',
        roundId: 'round-concurrency',
        gameId: 'game-001',
        amount: '80.00',
        currency: 'BRL',
      };

      // Dispara as duas requisições sem aguardar a primeira terminar.
      const results = await Promise.all([
        betA.execute({
          ...base,
          externalTransactionId: randomUUID(),
          idempotencyKey: randomUUID(),
        }),
        betB.execute({
          ...base,
          externalTransactionId: randomUUID(),
          idempotencyKey: randomUUID(),
        }),
      ]);

      expect(results.filter(r => r.status === 'PROCESSED')).toHaveLength(1);
      expect(results.filter(r => r.status === 'REJECTED')).toHaveLength(1);

      const verify = orm.em.fork();
      const wallet = await verify.findOneOrFail(WalletOrmEntity, { id: walletId });
      const ledger = await verify.find(WalletLedgerEntryOrmEntity, { wallet: walletId });
      const transactions = await verify.find(WagerTransactionOrmEntity, { wallet: walletId });

      expect(wallet.balance).toBe('20.00');
      expect(wallet.version).toBe(2);
      expect(ledger).toHaveLength(1);
      expect(ledger[0].direction).toBe('DEBIT');
      expect(ledger[0].amount).toBe('80.00');
      expect(transactions).toHaveLength(2);
    } finally {
      await cleanup(walletId);
    }
  }, 15_000);

  it('deve desfazer todas as alterações quando a transação externa sofre rollback', async () => {
    const walletId = randomUUID();
    const playerId = randomUUID();
    const externalTransactionId = randomUUID();
    const em = orm.em.fork();

    // A carteira é persistida fora da transação para comprovar que ela permanece.
    await createWallet(walletId, playerId);

    try {
      await em.begin();
      try {
        const useCase = new ProcessBetUseCase(em);
        const result = await useCase.execute({
          walletId,
          playerId,
          providerId: 'integration-provider',
          externalTransactionId,
          idempotencyKey: randomUUID(),
          roundId: 'round-rollback',
          gameId: 'game-001',
          amount: '25.00',
          currency: 'BRL',
        });
        expect(result.status).toBe('PROCESSED');

        // Simula uma falha do fluxo chamador após a operação.
        // O rollback precisa reverter também as gravações feitas pelo use case.
      } finally {
        await em.rollback();
      }

      // Novo contexto: lê o estado efetivamente persistido no banco.
      const verify = orm.em.fork();
      const wallet = await verify.findOneOrFail(WalletOrmEntity, { id: walletId });
      const transactions = await verify.find(WagerTransactionOrmEntity, {
        externalTransactionId,
      });
      const ledger = await verify.find(WalletLedgerEntryOrmEntity, { wallet: walletId });

      expect(wallet.balance).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(transactions).toHaveLength(0);
      expect(ledger).toHaveLength(0);
    } finally {
      await cleanup(walletId);
    }
  });
});
