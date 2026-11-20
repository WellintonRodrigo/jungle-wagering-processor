
import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from './wager-transaction.js';

// Factory de teste: evita repetir os mesmos dados.
function makeProps(
  overrides: Partial<CreateWagerTransactionProps> = {},
): CreateWagerTransactionProps {
  return {
    id: 'transaction-1',
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    ...overrides,
  };
}

describe('WagerTransaction', () => {
  it('deve criar uma aposta pendente', () => {
    const transaction = WagerTransaction.create(makeProps());

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.kind).toBe(WagerTransactionKind.Bet);
  });

  it('deve rejeitar OPENING como operação externa', () => {
    expect(() =>
      WagerTransaction.create(
        makeProps({ kind: WagerTransactionKind.Opening }),
      ),
    ).toThrow('OPENING is an internal operation');
  });

  it.each([
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ])('deve exigir referência para %s', (kind) => {
    expect(() =>
      WagerTransaction.create(makeProps({ kind })),
    ).toThrow('Reference transaction is required');
  });

  it('deve rejeitar transação de valor zero', () => {
    expect(() =>
      WagerTransaction.create(
        makeProps({ money: Money.zero('BRL') }),
      ),
    ).toThrow('Transaction amount must be positive');
  });

  it('deve marcar uma transação como processada', () => {
    const transaction = WagerTransaction.create(makeProps());
    const processedAt = new Date();

    transaction.markProcessed(undefined, processedAt);

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.processedAt).toEqual(processedAt);
    expect(transaction.isTerminal()).toBe(true);
  });

  it('deve impedir processar uma transação duas vezes', () => {
    const transaction = WagerTransaction.create(makeProps());

    transaction.markProcessed(undefined, new Date());

    expect(() =>
      transaction.markProcessed(undefined, new Date()),
    ).toThrow('Invalid transaction state transition');
  });

  it('deve permitir referência pendente para REFUND', () => {
    const transaction = WagerTransaction.create(
      makeProps({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'original-1',
      }),
    );

    transaction.markPendingReference();

    expect(transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );
  });

  it('deve rejeitar mudança para referência pendente em BET', () => {
    const transaction = WagerTransaction.create(makeProps());

    expect(() => transaction.markPendingReference()).toThrow(
      'Transaction does not require a reference',
    );
  });

  it('deve identificar payloads iguais e diferentes', () => {
    const transaction = WagerTransaction.create(makeProps());

    expect(transaction.matchesPayload('hash-1')).toBe(true);
    expect(transaction.matchesPayload('hash-different')).toBe(false);
  });

  it('deve marcar transação rejeitada com código de falha', () => {
    const transaction = WagerTransaction.create(makeProps());

    transaction.reject('INSUFFICIENT_FUNDS');

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('deve reconstruir uma transação persistida', () => {
    const original = WagerTransaction.create(makeProps());

    const restored = WagerTransaction.rehydrate({
      ...makeProps(),
      createdAt: original.createdAt,
      status: WagerTransactionStatus.Processed,
      processedAt: new Date(),
    });

    expect(restored.status).toBe(WagerTransactionStatus.Processed);
    expect(restored.isTerminal()).toBe(true);
  });
});
