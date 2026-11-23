
import { EntitySchema } from '@mikro-orm/core';

export class InboxMessageOrmEntity {
  id!: string;
  messageId!: string;
  source!: string;
  payload!: Record<string, unknown>;
  status: string = 'PENDING';
  receivedAt: Date = new Date();
  processedAt?: Date | null;
}

export const InboxMessageSchema = new EntitySchema({
  class: InboxMessageOrmEntity,
  tableName: 'inbox_messages',

  properties: {
    id: {
      type: 'uuid',
      primary: true,
    },

    messageId: {
      type: 'string',
      length: 255,
      fieldName: 'message_id',
    },

    source: {
      type: 'string',
      length: 100,
    },

    // JSONB preserva o conteúdo original da mensagem.
    payload: {
      type: 'json',
      columnType: 'jsonb',
    },

    status: {
      type: 'string',
      length: 20,
      default: 'PENDING',
    },

    receivedAt: {
      type: 'datetime',
      fieldName: 'received_at',
      defaultRaw: 'now()',
    },

    processedAt: {
      type: 'datetime',
      fieldName: 'processed_at',
      nullable: true,
    },
  },

  // Uma mensagem de uma fonte só pode ser registrada uma vez.
  uniques: [
    {
      name: 'uq_inbox_source_message',
      properties: ['source', 'messageId'],
    },
  ],

  indexes: [
    {
      name: 'idx_inbox_status_received',
      properties: ['status', 'receivedAt'],
    },
  ],

  checks: [
    {
      name: 'chk_inbox_status',
      expression: "status in ('PENDING', 'PROCESSED', 'FAILED')",
    },
  ],
});
