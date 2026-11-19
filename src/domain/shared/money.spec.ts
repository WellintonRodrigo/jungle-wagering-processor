
import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('deve criar um valor monetário válido', () => {
    const money = Money.from({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
  });

  it('deve somar valores sem alterar o original', () => {
    const original = Money.from({
      amount: '100.00',
      currency: 'BRL',
    });

    const resultado = original.add(
      Money.from({
        amount: '50.00',
        currency: 'BRL',
      }),
    );

    expect(resultado.toString()).toBe('150.00 BRL');
    expect(original.toString()).toBe('100.00 BRL');
  });

  it('deve preservar a precisão decimal', () => {
    const resultado = Money.from({
      amount: '0.10',
      currency: 'BRL',
    }).add(
      Money.from({
        amount: '0.20',
        currency: 'BRL',
      }),
    );

    expect(resultado.toJSON().amount).toBe('0.30');
  });

  it('deve rejeitar moedas diferentes', () => {
    const brl = Money.from({
      amount: '10.00',
      currency: 'BRL',
    });

    const usd = Money.from({
      amount: '5.00',
      currency: 'USD',
    });

    expect(() => brl.add(usd)).toThrow('Currency mismatch');
  });

  it.each([
    'NaN',
    'Infinity',
    '1e3',
    '',
    '-10.00',
    '10.123',
    '10',
  ])('deve rejeitar o valor inválido %s', (amount) => {
    expect(() =>
      Money.from({ amount, currency: 'BRL' }),
    ).toThrow('Invalid monetary amount');
  });
});
