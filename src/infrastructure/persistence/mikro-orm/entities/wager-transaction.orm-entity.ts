
import { EntitySchema } from '@mikro-orm/core';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../../domain/wager/wager-transaction.js';

import { WalletOrmEntity } from './wallet.orm-entity.js';

export class WagerTransactionOrmEntity {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  wallet!: WalletOrmEntity;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: WagerTransactionKind;
  amount!: string;
  currency!: string;
  status!: WagerTransactionStatus;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  failureCode?: string;
  createdAt!: Date;
  processedAt?: Date;
}

export const WagerTransactionSchema =
  new EntitySchema<WagerTransactionOrmEntity>({
    class: WagerTransactionOrmEntity,
    tableName: 'wager_transactions',

    properties: {
      id: {
        type: 'uuid',
        primary: true,
      },

      providerId: {
        type: 'string',
        fieldName: 'provider_id',
        length: 100,
      },

      externalTransactionId: {
        type: 'string',
        fieldName: 'external_transaction_id',
        length: 150,
      },

      idempotencyKey: {
        type: 'string',
        fieldName: 'idempotency_key',
        length: 200,
        unique: true,
      },

      payloadHash: {
        type: 'string',
        fieldName: 'payload_hash',
        length: 64,
      },

      wallet: {
        kind: 'm:1',
        entity: () => WalletOrmEntity,
        fieldName: 'wallet_id',
        deleteRule: 'restrict',
      },

      playerId: {
        type: 'uuid',
        fieldName: 'player_id',
      },

      roundId: {
        type: 'string',
        fieldName: 'round_id',
        length: 150,
      },

      gameId: {
        type: 'string',
        fieldName: 'game_id',
        length: 150,
      },

      kind: {
        type: 'string',
        length: 20,
      },

      amount: {
        type: 'decimal',
        precision: 18,
        scale: 2,
      },

      currency: {
        type: 'string',
        length: 3,
      },

      status: {
        type: 'string',
        length: 30,
      },

      referenceExternalTransactionId: {
        type: 'string',
        fieldName: 'reference_external_transaction_id',
        length: 150,
        nullable: true,
      },

      referenceTransactionId: {
        type: 'uuid',
        fieldName: 'reference_transaction_id',
        nullable: true,
      },

      failureCode: {
        type: 'string',
        fieldName: 'failure_code',
        length: 100,
        nullable: true,
      },

      createdAt: {
        type: 'Date',
        fieldName: 'created_at',
      },

      processedAt: {
        type: 'Date',
        fieldName: 'processed_at',
        nullable: true,
      },
    },

    indexes: [
      {
        name: 'idx_wager_transactions_wallet_created',
        properties: ['wallet', 'createdAt'],
      },
      {
        name: 'idx_wager_transactions_reference',
        properties: ['providerId', 'referenceExternalTransactionId'],
      },
    ],

    uniques: [
      {
        name: 'uq_wager_provider_external_transaction',
        properties: ['providerId', 'externalTransactionId'],
      },
    ],
  });
