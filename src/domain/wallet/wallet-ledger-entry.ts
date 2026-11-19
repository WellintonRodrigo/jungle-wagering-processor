
import { Money } from '../shared/money.js';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type LedgerEntryState = CreateLedgerEntryProps;

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  // Cria um lançamento novo e valida sua consistência.
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.id || !props.walletId || !props.transactionId) {
      throw new Error('Ledger identifiers are required');
    }

    if (!Object.values(LedgerDirection).includes(props.direction)) {
      throw new Error('Invalid ledger direction');
    }

    // Zero não representa uma movimentação financeira.
    if (!props.money.isPositive()) {
      throw new Error('Ledger amount must be positive');
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      new Date(props.createdAt),
    );

    if (!entry.isBalanced()) {
      throw new Error('Ledger entry is not balanced');
    }

    return entry;
  }

  // Reconstrói um lançamento persistido sem revalidar a transição.
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      new Date(state.createdAt),
    );
  }

  isBalanced(): boolean {
    const { money, balanceBefore, balanceAfter } = this;

    // Todas as quantias precisam usar a mesma moeda.
    if (
      money.currency !== balanceBefore.currency ||
      money.currency !== balanceAfter.currency
    ) {
      return false;
    }

    // Crédito soma; débito subtrai.
    const expectedBalance =
      this.direction === LedgerDirection.Credit
        ? balanceBefore.add(money)
        : balanceBefore.subtract(money);

    return expectedBalance.equals(balanceAfter);
  }
}
