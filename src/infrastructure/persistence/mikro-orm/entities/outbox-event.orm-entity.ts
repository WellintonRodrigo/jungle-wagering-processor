
import { EntitySchema } from '@mikro-orm/core';

export class OutboxEventOrmEntity {
  id!: string;
  aggregateId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  status: string = 'PENDING';
  attempts: number = 0;
  createdAt: Date = new Date();
  publishedAt?: Date | null;
}

export const OutboxEventSchema = new EntitySchema({
  class: OutboxEventOrmEntity,
  tableName: 'outbox_events',

  properties: {
    id: {
      type: 'uuid',
      primary: true,
    },

    aggregateId: {
      type: 'uuid',
      fieldName: 'aggregate_id',
    },

    eventType: {
      type: 'string',
      length: 100,
      fieldName: 'event_type',
    },

    // Evento persistido antes da publicação no SQS.
    payload: {
      type: 'json',
      columnType: 'jsonb',
    },

    status: {
      type: 'string',
      length: 20,
      default: 'PENDING',
    },

    attempts: {
      type: 'integer',
      default: 0,
    },

    createdAt: {
      type: 'datetime',
      fieldName: 'created_at',
      defaultRaw: 'now()',
    },

    publishedAt: {
      type: 'datetime',
      fieldName: 'published_at',
      nullable: true,
    },
  },

  indexes: [
    {
      name: 'idx_outbox_status_created',
      properties: ['status', 'createdAt'],
    },
  ],

  checks: [
    {
      name: 'chk_outbox_status',
      expression: "status in ('PENDING', 'PUBLISHED', 'FAILED')",
    },
    {
      name: 'chk_outbox_attempts',
      expression: 'attempts >= 0',
    },
  ],
});
