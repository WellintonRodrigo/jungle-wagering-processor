
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';

import { SqsClientService } from './sqs-client.service.js';
import { InboxMessageOrmEntity } from '../persistence/mikro-orm/entities/inbox-message.orm-entity.js';

@Injectable()
export class WagerSqsConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WagerSqsConsumer.name);
  private readonly queueUrl = process.env.SQS_WAGER_QUEUE_URL;
  private running = false;
  private polling?: Promise<void>;

  constructor(
    private readonly sqs: SqsClientService,
    private readonly em: EntityManager,
  ) {}

  onModuleInit() {
    if (!this.queueUrl) {
      this.logger.warn('SQS_WAGER_QUEUE_URL não configurada');
      return;
    }

    this.running = true;
    this.polling = this.poll();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.polling;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.sqs.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl!,
            MaxNumberOfMessages: 5,
            WaitTimeSeconds: 5,
          }),
        );

        for (const message of result.Messages ?? []) {
          await this.handleMessage(message);
        }
      } catch (error) {
        this.logger.error(
          'Erro ao consultar SQS',
          error instanceof Error ? error.stack : String(error),
        );

        // Evita um loop acelerado quando o SQS estiver indisponível.
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.MessageId || !message.ReceiptHandle || !message.Body) {
      this.logger.warn('Mensagem SQS incompleta; aguardando retry/DLQ');
      return;
    }

    try {
      const payload: unknown = JSON.parse(message.Body);

      // Cada mensagem usa seu próprio EntityManager.
      const em = this.em.fork();

      await em.transactional(async (tx) => {
        const existing = await tx.findOne(InboxMessageOrmEntity, {
          source: 'SQS_WAGER',
          messageId: message.MessageId!,
        });

        if (existing) {
          return;
        }

        const inbox = tx.create(InboxMessageOrmEntity, {
          id: crypto.randomUUID(),
          messageId: message.MessageId!,
          source: 'SQS_WAGER',
          payload: payload as Record<string, unknown>,
          status: 'PENDING',
          receivedAt: new Date(),
        });

        await tx.persistAndFlush(inbox);
      });

      // Confirma somente após persistir a Inbox.
      await this.sqs.client.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl!,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );

      this.logger.log(`Mensagem registrada: ${message.MessageId}`);
    } catch (error) {
      this.logger.error(
        `Falha ao registrar mensagem ${message.MessageId}`,
        error instanceof Error ? error.stack : String(error),
      );

      // Sem DeleteMessage: SQS disponibilizará a mensagem novamente.
    }
  }
}
