
import { Decimal } from 'decimal.js';

// Contrato utilizado para receber e serializar dinheiro.
export interface MoneyProps {
  amount: string;
  currency: string;
}

const SUPPORTED_CURRENCIES = ['BRL', 'USD', 'EUR'] as const;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  // Factory: valida os dados recebidos externamente.
  static from(props: MoneyProps): Money {
    const { amount, currency } = props;

    // Aceita somente decimais não negativos com duas casas.
    if (
      typeof amount !== 'string' ||
      !/^(0|[1-9]\d*)\.\d{2}$/.test(amount)
    ) {
      throw new Error('Invalid monetary amount');
    }

    // Verifica se a moeda é suportada pelo sistema.
    if (
      typeof currency !== 'string' ||
      !SUPPORTED_CURRENCIES.some(code=> code===currency)
    ) {
      throw new Error('Unsupported currency');
    }

    return new Money(new Decimal(amount), currency);
  }

  static zero(currency: string): Money {
    return Money.from({
      amount: '0.00',
      currency,
    });
  }

  // Retorna uma nova instância, preservando a original.
  add(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(
      this.value.plus(other.value),
      this.currency,
    );
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(
      this.value.minus(other.value),
      this.currency,
    );
  }

  negate(): Money {
    return new Money(
      this.value.negated(),
      this.currency,
    );
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency &&
      this.value.equals(other.value)
    );
  }

  // Serializa o valor com exatamente duas casas decimais.
  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error('Currency mismatch');
    }
  }
}
