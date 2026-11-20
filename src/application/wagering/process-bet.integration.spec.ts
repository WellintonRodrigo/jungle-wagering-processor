
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../database/mikroOrmConfig.js';
import { ProcessBetUseCase } from './process-bet.use-case.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

/**
 * Teste de integração do processamento de apostas BET.
 *
 * Objetivos:
 * - Executar o caso de uso contra um PostgreSQL real.
 * - Confirmar que uma aposta debita o saldo corretamente.
 * - Verificar a criação da transação e do lançamento no ledger.
 * - Garantir que nenhuma alteração permaneça após o teste.
 *
 * Cada teste utiliza uma transação externa que é revertida no final.
 */

describe('ProcessBetUseCase - Integration', () => {

    
    let orm: MikroORM;

  beforeAll(async () => {
    // Proteção: nunca executar este teste no banco de desenvolvimento.
    if (process.env.DB_NAME !== 'jungle_wagering_test') {
      throw new Error(
        'Integration tests require DB_NAME=jungle_wagering_test',
      );
    }

    orm = await MikroORM.init(mikroOrmConfig);
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('deve debitar uma aposta e registrar a movimentação', async () => {
    // Uma conexão isolada mantém o teste dentro de uma transação.
    const em = orm.em.fork();

    await em.begin();

    try {
      const walletId = randomUUID();
      const playerId = randomUUID();

      // Prepara uma carteira fictícia com R$ 100,00.
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

      const useCase = new ProcessBetUseCase(em);

      // Executa uma aposta de R$ 25,00.
      const result = await useCase.execute({
        walletId,
        playerId,
        providerId: 'test-provider',
        externalTransactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        roundId: 'round-001',
        gameId: 'game-001',
        amount: '25.00',
        currency: 'BRL',
      });

      // Confirma o resultado retornado pelo caso de uso.
      expect(result.status).toBe('PROCESSED');
      expect(result.balance).toBe('75.00');
      expect(result.idempotent).toBe(false);

      // Consulta novamente o banco para verificar a persistência.
      const updatedWallet = await em.findOneOrFail(
        WalletOrmEntity,
        { id: walletId },
        { refresh: true },
      );

      const ledger = await em.findOne(
        WalletLedgerEntryOrmEntity,
        { transactionId: result.transactionId },
      );

      const transaction = await em.findOne(
        WagerTransactionOrmEntity,
        { id: result.transactionId },
      );

      expect(updatedWallet.balance).toBe('75.00');
      expect(updatedWallet.version).toBe(2);

      expect(ledger).not.toBeNull();
      expect(ledger?.direction).toBe('DEBIT');
      expect(ledger?.amount).toBe('25.00');

      expect(transaction).not.toBeNull();
      expect(transaction?.status).toBe('PROCESSED');
    } finally {
      // Reverte todos os dados criados durante o teste.
      await em.rollback();
    }
  });

/**
 * Garante a idempotência de uma aposta.
 *
 * Quando o provedor reenvia exatamente a mesma requisição:
 * - A primeira chamada deve debitar a carteira.
 * - A segunda deve retornar a transação existente.
 * - O saldo não pode ser debitado novamente.
 * - Apenas um lançamento deve existir no ledger.
 */
it('deve processar uma BET repetida sem debitar novamente', async () => {
  const em = orm.em.fork();

  // Todas as alterações serão revertidas ao final do teste.
  await em.begin();

  try {
    const walletId = randomUUID();
    const playerId = randomUUID();

    // Prepara uma carteira com saldo inicial de R$ 100,00.
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

    const useCase = new ProcessBetUseCase(em);

    // A mesma entrada será enviada duas vezes.
    const input = {
      walletId,
      playerId,
      providerId: 'test-provider',
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      roundId: 'round-idempotency',
      gameId: 'game-001',
      amount: '25.00',
      currency: 'BRL',
    };

    // Primeira requisição: efetua o débito.
    const first = await useCase.execute(input);

    // Segunda requisição: deve reutilizar a transação.
    const second = await useCase.execute(input);

    expect(first.status).toBe('PROCESSED');
    expect(first.idempotent).toBe(false);

    expect(second.status).toBe('PROCESSED');
    expect(second.idempotent).toBe(true);

    // As duas respostas devem identificar a mesma transação.
    expect(second.transactionId).toBe(first.transactionId);

    // Consulta o banco para verificar o saldo efetivamente persistido.
    const updatedWallet = await em.findOneOrFail(
      WalletOrmEntity,
      { id: walletId },
      { refresh: true },
    );

    expect(updatedWallet.balance).toBe('75.00');
    expect(updatedWallet.version).toBe(2);

    // Uma BET repetida não pode gerar dois lançamentos.
    const ledgerEntries = await em.find(
      WalletLedgerEntryOrmEntity,
      { transactionId: first.transactionId },
    );

    expect(ledgerEntries).toHaveLength(1);

    // Também deve existir somente uma transação financeira.
    const transactions = await em.find(
      WagerTransactionOrmEntity,
      { idempotencyKey: input.idempotencyKey },
    );

    expect(transactions).toHaveLength(1);
  } finally {
    // Desfaz todos os registros de teste.
    await em.rollback();
  }
});

  /** TESTE 3: saldo insuficiente deve gerar rejeição sem lançamento financeiro. */
  it('deve rejeitar uma BET com saldo insuficiente', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const walletId = randomUUID();
      const playerId = randomUUID();
      em.persist(em.create(WalletOrmEntity, {
        id: walletId, playerId, currency: 'BRL', balance: '100.00',
        version: 1, createdAt: new Date(), updatedAt: new Date(),
      }));
      await em.flush();

      const result = await new ProcessBetUseCase(em).execute({
        walletId, playerId, providerId: 'test-provider',
        externalTransactionId: randomUUID(), idempotencyKey: randomUUID(),
        roundId: 'round-insufficient', gameId: 'game-001',
        amount: '150.00', currency: 'BRL',
      });

      expect(result.status).toBe('REJECTED');
      expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
      const wallet = await em.findOneOrFail(WalletOrmEntity, { id: walletId }, { refresh: true });
      expect(wallet.balance).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(await em.count(WalletLedgerEntryOrmEntity, { transactionId: result.transactionId })).toBe(0);
      const transaction = await em.findOneOrFail(WagerTransactionOrmEntity, { id: result.transactionId });
      expect(transaction.status).toBe('REJECTED');
    } finally {
      await em.rollback();
    }
  });

  /** TESTE 4: mesma chave com payload diferente deve ser recusada. */
  it('deve impedir conflito de idempotência', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const walletId = randomUUID();
      const playerId = randomUUID();
      em.persist(em.create(WalletOrmEntity, {
        id: walletId, playerId, currency: 'BRL', balance: '100.00',
        version: 1, createdAt: new Date(), updatedAt: new Date(),
      }));
      await em.flush();
      const useCase = new ProcessBetUseCase(em);
      const input = {
        walletId, playerId, providerId: 'test-provider',
        externalTransactionId: randomUUID(), idempotencyKey: randomUUID(),
        roundId: 'round-conflict', gameId: 'game-001',
        amount: '25.00', currency: 'BRL',
      };
      const first = await useCase.execute(input);
      // A mesma chave não pode representar uma aposta de outro valor.
      await expect(useCase.execute({ ...input, amount: '50.00' })).rejects.toThrow();
      const wallet = await em.findOneOrFail(WalletOrmEntity, { id: walletId }, { refresh: true });
      expect(wallet.balance).toBe('75.00');
      expect(wallet.version).toBe(2);
      expect(await em.count(WagerTransactionOrmEntity, { idempotencyKey: input.idempotencyKey })).toBe(1);
      expect(await em.count(WalletLedgerEntryOrmEntity, { transactionId: first.transactionId })).toBe(1);
    } finally {
      await em.rollback();
    }
  });

  /** TESTE 5: não pode processar aposta de carteira inexistente. */
  it('deve rejeitar carteira inexistente', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const externalTransactionId = randomUUID();
      await expect(new ProcessBetUseCase(em).execute({
        walletId: randomUUID(), playerId: randomUUID(),
        providerId: 'test-provider', externalTransactionId,
        idempotencyKey: randomUUID(), roundId: 'round-missing',
        gameId: 'game-001', amount: '25.00', currency: 'BRL',
      })).rejects.toThrow();
      expect(await em.count(WagerTransactionOrmEntity, { externalTransactionId })).toBe(0);
    } finally {
      await em.rollback();
    }
  });

  /** TESTE 6: um jogador não pode movimentar a carteira de outro. */
  it('deve rejeitar jogador diferente do proprietário', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const walletId = randomUUID();
      em.persist(em.create(WalletOrmEntity, {
        id: walletId, playerId: randomUUID(), currency: 'BRL',
        balance: '100.00', version: 1,
        createdAt: new Date(), updatedAt: new Date(),
      }));
      await em.flush();
      await expect(new ProcessBetUseCase(em).execute({
        walletId, playerId: randomUUID(), providerId: 'test-provider',
        externalTransactionId: randomUUID(), idempotencyKey: randomUUID(),
        roundId: 'round-owner', gameId: 'game-001',
        amount: '25.00', currency: 'BRL',
      })).rejects.toThrow();
      const wallet = await em.findOneOrFail(WalletOrmEntity, { id: walletId }, { refresh: true });
      expect(wallet.balance).toBe('100.00');
      expect(wallet.version).toBe(1);
    } finally {
      await em.rollback();
    }
  });

  /** TESTE 7: moedas diferentes não podem ser movimentadas juntas. */
  it('deve rejeitar moeda diferente da carteira', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const walletId = randomUUID();
      const playerId = randomUUID();
      em.persist(em.create(WalletOrmEntity, {
        id: walletId, playerId, currency: 'BRL', balance: '100.00',
        version: 1, createdAt: new Date(), updatedAt: new Date(),
      }));
      await em.flush();
      await expect(new ProcessBetUseCase(em).execute({
        walletId, playerId, providerId: 'test-provider',
        externalTransactionId: randomUUID(), idempotencyKey: randomUUID(),
        roundId: 'round-currency', gameId: 'game-001',
        amount: '25.00', currency: 'USD',
      })).rejects.toThrow();
      const wallet = await em.findOneOrFail(WalletOrmEntity, { id: walletId }, { refresh: true });
      expect(wallet.balance).toBe('100.00');
      expect(wallet.version).toBe(1);
    } finally {
      await em.rollback();
    }
  });

  /** TESTE 8: valor zero nunca pode gerar uma movimentação financeira. */
  it('deve rejeitar uma BET de valor zero', async () => {
    const em = orm.em.fork();
    await em.begin();
    try {
      const walletId = randomUUID();
      const playerId = randomUUID();
      em.persist(em.create(WalletOrmEntity, {
        id: walletId, playerId, currency: 'BRL', balance: '100.00',
        version: 1, createdAt: new Date(), updatedAt: new Date(),
      }));
      await em.flush();
      const externalTransactionId = randomUUID();
      await expect(new ProcessBetUseCase(em).execute({
        walletId, playerId, providerId: 'test-provider',
        externalTransactionId, idempotencyKey: randomUUID(),
        roundId: 'round-zero', gameId: 'game-001',
        amount: '0.00', currency: 'BRL',
      })).rejects.toThrow();
      const wallet = await em.findOneOrFail(WalletOrmEntity, { id: walletId }, { refresh: true });
      expect(wallet.balance).toBe('100.00');
      expect(await em.count(WagerTransactionOrmEntity, { externalTransactionId })).toBe(0);
    } finally {
      await em.rollback();
    }
  });

});
