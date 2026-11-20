
import { EntitySchema } from '@mikro-orm/core';

// Representa exclusivamente a estrutura da tabela PostgreSQL.
// Não contém regras de negócio da Wallet.
export class WalletOrmEntity {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
}

export const WalletSchema = new EntitySchema({
  class: WalletOrmEntity,
  tableName: 'wallets',

  properties: {
    id: {
      type: 'uuid',
      primary: true,
    },

    playerId: {
      type: 'uuid',
      fieldName: 'player_id',
    },

    currency: {
      type: 'string',
      length: 3,
    },

    // String no TypeScript evita conversão para float.
    balance: {
      type: 'decimal',
      precision: 18,
      scale: 2,
    },

    version: {
      type: 'integer',
      default: 1,
    },
  },

  uniques: [
    {
      name: 'uq_wallet_player_currency',
      properties: ['playerId', 'currency'],
    },
  ],

  checks: [
    {
      name: 'chk_wallet_balance_nonnegative',
      expression: 'balance >= 0',
    },
  ],
});
