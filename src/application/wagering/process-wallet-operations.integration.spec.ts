import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../database/mikroOrmConfig.js';
import { ProcessBetUseCase } from './process-bet.use-case.js';
import { ProcessWinUseCase } from './process-win.use-case.js';
import { ProcessRefundUseCase } from './process-refund.use-case.js';
import { ProcessRollbackUseCase } from './process-rollback.use-case.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';
import { WagerTransactionOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

describe('WIN / REFUND / ROLLBACK - integração PostgreSQL', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    if (process.env.DB_NAME !== 'jungle_wagering_test') {
      throw new Error('Execute apenas com DB_NAME=jungle_wagering_test');
    }
    orm = await MikroORM.init(mikroOrmConfig);
  });

  afterAll(async () => { await orm?.close(true); });

  // Cada cenário usa uma transação externa; o rollback elimina os dados de teste.
  async function scenario(run: (ctx: {
    em: EntityManager;
    input: ReturnType<typeof newInput>;
    balance: () => Promise<string>;
    ledger: (id: string) => Promise<WalletLedgerEntryOrmEntity[]>;
  }) => Promise<void>) {
    const em = orm.em.fork();
    await em.begin();
    try {
      const input = newInput();
      em.create(WalletOrmEntity, {
        id: input.walletId, playerId: input.playerId, currency: 'BRL',
        balance: '100.00', version: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      await em.flush();
      const balance = async () => (await em.findOneOrFail(
        WalletOrmEntity, { id: input.walletId }, { refresh: true },
      )).balance;
      const ledger = (id: string) => em.find(WalletLedgerEntryOrmEntity, { transactionId: id });
      await run({ em, input, balance, ledger });
    } finally {
      await em.rollback();
    }
  }

  function newInput() {
    return {
      walletId: randomUUID(), playerId: randomUUID(), providerId: 'test-provider',
      externalTransactionId: randomUUID(), idempotencyKey: randomUUID(),
      roundId: 'round-001', gameId: 'game-001', amount: '25.00', currency: 'BRL',
    };
  }

  // Reutiliza a carteira/rodada, mas cria identidade própria para cada operação.
  function next(input: ReturnType<typeof newInput>, referenceExternalTransactionId?: string) {
    return {
      ...input, externalTransactionId: randomUUID(), idempotencyKey: randomUUID(),
      ...(referenceExternalTransactionId ? { referenceExternalTransactionId } : {}),
    };
  }

  it('WIN credita saldo e cria lançamento CREDIT', async () => scenario(async ({ em, input, balance, ledger }) => {
    const result = await new ProcessWinUseCase(em).execute(input);
    expect(result.status).toBe('PROCESSED');
    expect(result.balance).toBe('125.00');
    expect(await balance()).toBe('125.00');
    const entries = await ledger(result.transactionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.direction).toBe('CREDIT');
    expect(entries[0]?.amount).toBe('25.00');
  }));

  it('WIN repetida não credita duas vezes', async () => scenario(async ({ em, input, balance, ledger }) => {
    const win = new ProcessWinUseCase(em);
    const first = await win.execute(input);
    const second = await win.execute(input);
    expect(second.idempotent).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await balance()).toBe('125.00');
    expect(await ledger(first.transactionId)).toHaveLength(1);
  }));

  it('REFUND devolve BET processada', async () => scenario(async ({ em, input, balance, ledger }) => {
    const bet = await new ProcessBetUseCase(em).execute(input);
    expect(bet.status).toBe('PROCESSED');
    const refund = await new ProcessRefundUseCase(em).execute(next(input, input.externalTransactionId));
    expect(refund.status).toBe('PROCESSED');
    expect(await balance()).toBe('100.00');
    expect((await ledger(refund.transactionId))[0]?.direction).toBe('CREDIT');
    const row = await em.findOneOrFail(WagerTransactionOrmEntity, { id: refund.transactionId });
    expect(row.referenceTransactionId).toBe(bet.transactionId);
  }));

  it('ROLLBACK de BET devolve o débito', async () => scenario(async ({ em, input, balance }) => {
    await new ProcessBetUseCase(em).execute(input);
    const result = await new ProcessRollbackUseCase(em).execute(next(input, input.externalTransactionId));
    expect(result.status).toBe('PROCESSED');
    expect(await balance()).toBe('100.00');
  }));

  it('ROLLBACK de WIN debita o ganho', async () => scenario(async ({ em, input, balance, ledger }) => {
    await new ProcessWinUseCase(em).execute(input);
    const result = await new ProcessRollbackUseCase(em).execute(next(input, input.externalTransactionId));
    expect(result.status).toBe('PROCESSED');
    expect(await balance()).toBe('100.00');
    expect((await ledger(result.transactionId))[0]?.direction).toBe('DEBIT');
  }));

  it('impede REFUND e ROLLBACK da mesma BET', async () => scenario(async ({ em, input, balance }) => {
    await new ProcessBetUseCase(em).execute(input);
    await new ProcessRefundUseCase(em).execute(next(input, input.externalTransactionId));
    await expect(new ProcessRollbackUseCase(em).execute(next(input, input.externalTransactionId)))
      .rejects.toThrow('Reference transaction already compensated');
    expect(await balance()).toBe('100.00');
  }));

  it('rejeita referência inexistente', async () => scenario(async ({ em, input, balance }) => {
    await expect(new ProcessRefundUseCase(em).execute(next(input, randomUUID())))
      .rejects.toThrow('Reference transaction not found');
    expect(await balance()).toBe('100.00');
  }));

  it('rejeita valor divergente da transação original', async () => scenario(async ({ em, input, balance }) => {
    await new ProcessBetUseCase(em).execute(input);
    await expect(new ProcessRefundUseCase(em).execute({
      ...next(input, input.externalTransactionId), amount: '10.00',
    })).rejects.toThrow('Reference amount mismatch');
    expect(await balance()).toBe('75.00');
  }));

  it('ROLLBACK de WIN sem saldo suficiente é rejeitado sem ledger', async () => scenario(async ({ em, input, balance, ledger }) => {
    await new ProcessWinUseCase(em).execute(input); // 100 -> 125
    const betInput = { ...next(input), amount: '120.00' };
    await new ProcessBetUseCase(em).execute(betInput); // 125 -> 5
    const result = await new ProcessRollbackUseCase(em).execute(next(input, input.externalTransactionId));
    expect(result.status).toBe('REJECTED');
    expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(await balance()).toBe('5.00');
    expect(await ledger(result.transactionId)).toHaveLength(0);
  }));
});
