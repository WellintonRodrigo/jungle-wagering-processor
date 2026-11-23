import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { OutboxEventOrmEntity } from '../persistence/mikro-orm/entities/outbox-event.orm-entity.js';
import { SqsClientService } from './sqs-client.service.js';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private running = false;
  private worker?: Promise<void>;
  private readonly queueUrl = process.env.SQS_EVENTS_QUEUE_URL;

  constructor(private readonly em: EntityManager, private readonly sqs: SqsClientService) {}

  onModuleInit() {
    if (!this.queueUrl) {
      this.logger.warn('SQS_EVENTS_QUEUE_URL ausente; publisher desativado');
      return;
    }
    this.running = true;
    this.worker = this.run();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.worker;
  }

  private async run() {
    while (this.running) {
      try {
        await this.publishOne();
      } catch (error) {
        this.logger.error(error instanceof Error ? error.message : String(error));
      }
      if (this.running) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  private async publishOne() {
    const em = this.em.fork();
    // Lock por linha: publishers concorrentes não escolhem o mesmo evento.
    await em.transactional(async (tx) => {
      const rows = await tx.getConnection().execute<{ id: string }[]>(
        `select id from outbox_events where status = 'PENDING'
         order by created_at, id for update skip locked limit 1`,
      );
      if (!rows.length) return;
      const event = await tx.findOneOrFail(OutboxEventOrmEntity, { id: rows[0]!.id });
      try {
        await this.sqs.client.send(new SendMessageCommand({
          QueueUrl: this.queueUrl!,
          MessageBody: JSON.stringify({ eventId: event.id, eventType: event.eventType, ...event.payload }),
          MessageGroupId: event.aggregateId,
          MessageDeduplicationId: event.id,
        }));
        event.status = 'PUBLISHED';
        event.publishedAt = new Date();
      } catch (error) {
        // Mantém pendente: envio poderá ser repetido; consumidor deve deduplicar eventId.
        event.attempts += 1;
        this.logger.warn(`Outbox ${event.id}: tentativa ${event.attempts}`);
      }
      await tx.flush();
    });
  }
}
