
import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
  type CreateLedgerEntryProps,
} from './wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
  const brl = (amount: string) =>
    Money.from({ amount, currency: 'BRL' });

  const validProps = (): CreateLedgerEntryProps => ({
    id: 'entry-1',
    walletId: 'wallet-1',
    transactionId: 'transaction-1',
    direction: LedgerDirection.Credit,
    money: brl('50.00'),
    balanceBefore: brl('100.00'),
    balanceAfter: brl('150.00'),
    createdAt: new Date('2026-11-19T12:00:00Z'),
  });

  it('deve criar um crédito consistente', () => {
    const entry = WalletLedgerEntry.create(validProps());

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  it('deve criar um débito consistente', () => {
    const entry = WalletLedgerEntry.create({
      ...validProps(),
      direction: LedgerDirection.Debit,
      balanceAfter: brl('50.00'),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it('deve rejeitar saldo posterior inconsistente', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...validProps(),
        balanceAfter: brl('200.00'),
      }),
    ).toThrow('Ledger entry is not balanced');
  });

  it('deve rejeitar movimentação de valor zero', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...validProps(),
        money: Money.zero('BRL'),
      }),
    ).toThrow('Ledger amount must be positive');
  });

  it('deve rejeitar moedas diferentes', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...validProps(),
        balanceAfter: Money.from({
          amount: '150.00',
          currency: 'USD',
        }),
      }),
    ).toThrow('Ledger entry is not balanced');
  });

  it('deve rejeitar identificadores vazios', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...validProps(),
        transactionId: '',
      }),
    ).toThrow('Ledger identifiers are required');
  });

  it('deve reconstruir um lançamento persistido', () => {
    const entry = WalletLedgerEntry.rehydrate(validProps());

    expect(entry.id).toBe('entry-1');
    expect(entry.isBalanced()).toBe(true);
  });
});
