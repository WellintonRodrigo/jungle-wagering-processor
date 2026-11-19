
import { Money } from '../shared/money.js';

// Representa o estado de uma carteira já persistida.
export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

// Dados necessários para criar um lançamento no ledger.
export interface WalletMovement {
  direction: 'DEBIT' | 'CREDIT';
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // Factory para abrir uma carteira.
  static open(props: OpenWalletProps): Wallet {
    const { id, playerId, initialBalance } = props;

    if (!id.trim() || !playerId.trim()) {
      throw new Error('Invalid wallet identity');
    }

    if (initialBalance.isNegative()) {
      throw new Error('Initial balance cannot be negative');
    }

    const now = new Date();

    return new Wallet(
      id,
      playerId,
      initialBalance.currency,
      initialBalance,
      1, // Toda carteira nova começa na versão 1.
      now,
      now,
    );
  }

  // Reconstrói o estado persistido, sem executar transições.
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  // Aplica um débito e descreve a movimentação.
  debit(money: Money): WalletMovement {
    this.assertSameCurrency(money);
    this.assertPositiveAmount(money);

    if (this._balance.isLessThan(money)) {
      throw new Error('Insufficient balance');
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);

    this.applyBalance(balanceAfter);

    return {
      direction: 'DEBIT',
      money,
      balanceBefore,
      balanceAfter,
    };
  }

  // Aplica um crédito e descreve a movimentação.
  credit(money: Money): WalletMovement {
    this.assertSameCurrency(money);
    this.assertPositiveAmount(money);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);

    this.applyBalance(balanceAfter);

    return {
      direction: 'CREDIT',
      money,
      balanceBefore,
      balanceAfter,
    };
  }

  private applyBalance(newBalance: Money): void {
    this._balance = newBalance;
    this._version += 1;
    this._updatedAt = new Date();
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new Error('Wallet currency mismatch');
    }
  }

  private assertPositiveAmount(money: Money): void {
    // Zero não representa uma movimentação financeira efetiva.
    if (!money.isPositive()) {
      throw new Error('Transaction amount must be positive');
    }
  }
}
