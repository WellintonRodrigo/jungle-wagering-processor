
import { EntitySchema } from '@mikro-orm/core';
import { WalletOrmEntity } from './wallet.orm-entity.js';

export class WalletLedgerEntryOrmEntity {
  id!: string;
  wallet!: WalletOrmEntity;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const WalletLedgerEntrySchema = new EntitySchema({
  class: WalletLedgerEntryOrmEntity,
  tableName: 'wallet_ledger_entries',

  properties: {
    id: {
      type: 'uuid',
      primary: true,
    },

    wallet: {
      kind: 'm:1',
      entity: () => WalletOrmEntity,
      fieldName: 'wallet_id',
      deleteRule: 'restrict',
    },

    transactionId: {
      type: 'uuid',
      fieldName: 'transaction_id',
    },

    direction: {
      type: 'string',
      length: 6,
    },

    // NUMERIC evita perda de precisão com valores financeiros.
    amount: {
      type: 'decimal',
      precision: 18,
      scale: 2,
    },

    currency: {
      type: 'string',
      length: 3,
    },

    balanceBefore: {
      type: 'decimal',
      precision: 18,
      scale: 2,
      fieldName: 'balance_before',
    },

    balanceAfter: {
      type: 'decimal',
      precision: 18,
      scale: 2,
      fieldName: 'balance_after',
    },

    createdAt: {
      type: 'datetime',
      fieldName: 'created_at',
    },
  },

  // Uma transação não pode gerar dois lançamentos
  // com a mesma carteira e direção.
  uniques: [
    {
      name: 'uq_ledger_transaction_wallet',
      properties: ['transactionId', 'wallet'],
    },
  ],

  checks: [
    {
      name: 'chk_ledger_amount_positive',
      expression: 'amount > 0',
    },
    {
      name: 'chk_ledger_direction',
      expression: "direction IN ('CREDIT', 'DEBIT')",
    },
  ],
});
