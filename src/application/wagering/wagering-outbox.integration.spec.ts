import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../database/mikroOrmConfig.js';
import { WageringDispatcher } from './wagering.dispatcher.js';
import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { OutboxEventOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/outbox-event.orm-entity.js';

describe('Dispatcher + Outbox — integração PostgreSQL', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'jungle_wagering_test') {
      throw new Error('Execute apenas com DB_NAME=jungle_wagering_test');
    }
    orm = await MikroORM.init(mikroOrmConfig);
  });
  afterAll(async () => { await orm?.close(true); });

  it('cria um evento por operação e não duplica no replay', async () => {
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
      const body = {
        walletId, playerId, providerId: 'outbox-test',
        externalTransactionId: randomUUID(), roundId: 'round-1', gameId: 'game-1',
        kind: 'LOSS' as const, money: { amount: '25.00', currency: 'BRL' },
      };
      const dispatcher = new WageringDispatcher(em);
      const key = randomUUID();
      const first = await dispatcher.execute(body, key, em);
      const replay = await dispatcher.execute(body, key, em);
      expect(first.status).toBe('PROCESSED');
      expect(replay.idempotentReplay).toBe(true);
      const events = await em.find(OutboxEventOrmEntity, { aggregateId: first.transactionId });
      expect(events).toHaveLength(1);
      expect(events[0]?.status).toBe('PENDING');
    } finally {
      await em.rollback();
    }
  });
});
