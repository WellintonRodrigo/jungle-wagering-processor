
import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money.js';
import { Wallet } from './wallet.js';

describe('Wallet', () => {
  const createWallet = () =>
    Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
    });

  it('deve abrir uma carteira na versão 1', () => {
    const wallet = createWallet();

    expect(wallet.balance.toString()).toBe('100.00 BRL');
    expect(wallet.version).toBe(1);
    expect(wallet.currency).toBe('BRL');
  });

  it('deve creditar dinheiro e incrementar a versão', () => {
    const wallet = createWallet();

    const movement = wallet.credit(
      Money.from({ amount: '50.00', currency: 'BRL' }),
    );

    expect(wallet.balance.toString()).toBe('150.00 BRL');
    expect(wallet.version).toBe(2);
    expect(movement.direction).toBe('CREDIT');
    expect(movement.balanceBefore.toString()).toBe('100.00 BRL');
    expect(movement.balanceAfter.toString()).toBe('150.00 BRL');
  });

  it('deve debitar dinheiro e incrementar a versão', () => {
    const wallet = createWallet();

    wallet.debit(
      Money.from({ amount: '30.00', currency: 'BRL' }),
    );

    expect(wallet.balance.toString()).toBe('70.00 BRL');
    expect(wallet.version).toBe(2);
  });

  it('deve impedir saldo negativo', () => {
    const wallet = createWallet();

    expect(() =>
      wallet.debit(
        Money.from({ amount: '150.00', currency: 'BRL' }),
      ),
    ).toThrow('Insufficient balance');

    // Uma operação rejeitada não altera o estado.
    expect(wallet.balance.toString()).toBe('100.00 BRL');
    expect(wallet.version).toBe(1);
  });

  it('deve rejeitar moedas diferentes', () => {
    const wallet = createWallet();

    expect(() =>
      wallet.credit(
        Money.from({ amount: '10.00', currency: 'USD' }),
      ),
    ).toThrow('Wallet currency mismatch');
  });

  it('deve rejeitar movimentações de valor zero', () => {
    const wallet = createWallet();

    expect(() =>
      wallet.credit(Money.zero('BRL')),
    ).toThrow('Transaction amount must be positive');

    expect(wallet.version).toBe(1);
  });

  it('deve reconstruir uma carteira persistida', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      version: 4,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    expect(wallet.balance.toString()).toBe('75.00 BRL');
    expect(wallet.version).toBe(4);
  });

  it('deve rejeitar saldo inicial negativo', () => {
    expect(() =>
      Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.zero('BRL').subtract(
          Money.from({ amount: '10.00', currency: 'BRL' }),
        ),
      }),
    ).toThrow('Initial balance cannot be negative');
  });
});
