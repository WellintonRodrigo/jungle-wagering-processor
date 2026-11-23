
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { InboxMessageOrmEntity } from '../persistence/mikro-orm/entities/inbox-message.orm-entity.js';
import { WageringDispatcher } from '../../application/wagering/wagering.dispatcher.js';
import type { SubmitTransactionBody } from '../../application/wagering/wagering.types.js';

@Injectable()
export class InboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxProcessor.name);
  private readonly intervalMs = 2000;
  private running = false;
  private worker?: Promise<void>;

  constructor(
    private readonly em: EntityManager,
    private readonly dispatcher: WageringDispatcher,
  ) {}

  onModuleInit() {
    this.running = true;
    this.worker = this.run();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.worker;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.processNext();
      } catch (error) {
        this.logger.error(
          'Erro no processamento da Inbox',
          error instanceof Error ? error.stack : String(error),
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.intervalMs),
      );
    }
  }

  private async processNext(): Promise<void> {
    const em = this.em.fork();
    // SKIP LOCKED permite múltiplas instâncias sem disputar a mesma mensagem.
    await em.transactional(async (tx) => {
      const rows = await tx.getConnection().execute<{ id: string }[]>(
        `select id from inbox_messages where status = 'PENDING' and source = 'SQS_WAGER'
         order by received_at, id for update skip locked limit 1`,
      );
      if (!rows.length) return;
      const message = await tx.findOneOrFail(InboxMessageOrmEntity, { id: rows[0]!.id });
      const payload = message.payload;
      const valid = payload && typeof payload === 'object' && !Array.isArray(payload) &&
        typeof payload.providerId === 'string' && !!payload.providerId.trim() &&
        typeof payload.externalTransactionId === 'string' && !!payload.externalTransactionId.trim() &&
        typeof payload.kind === 'string' &&
        ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(payload.kind) &&
        typeof payload.money === 'object' && payload.money !== null && !Array.isArray(payload.money) &&
        typeof (payload.money as Record<string, unknown>).amount === 'string' &&
        typeof (payload.money as Record<string, unknown>).currency === 'string' &&
        ['playerId', 'walletId', 'roundId', 'gameId'].every(
          (field) => typeof payload[field] === 'string' && !!(payload[field] as string).trim(),
        );
      if (!valid) {
        message.status = 'FAILED';
        message.processedAt = new Date();
        await tx.flush();
        this.logger.warn(`Inbox ${message.messageId}: payload inválido`);
        return;
      }
      const body = payload as unknown as SubmitTransactionBody;
      const key = `${body.providerId}:${body.externalTransactionId}`;
      try {
        // Savepoint: falhas do dispatcher não invalidam a transação externa.
        const result = await tx.transactional((inner) => this.dispatcher.execute(body, key, inner));
        message.status = 'PROCESSED';
        message.processedAt = new Date();
        await tx.flush();
        this.logger.log(`Inbox ${message.messageId}: ${result.status}`);
      } catch (error) {
        // Erro transitório: rollback completo deixa PENDING para nova tentativa.
        // Erros permanentes são auditados como FAILED.
        const reason = error instanceof Error ? error.message : String(error);
        if (/Idempotency conflict|Wallet not found|ownership mismatch|Currency mismatch|Reference transaction already compensated|must not reference|Reference amount mismatch|Reference transaction mismatch|Transaction amount must be positive|Invalid/i.test(reason)) {
          message.status = 'FAILED';
          message.processedAt = new Date();
          await tx.flush();
          this.logger.warn(`Inbox ${message.messageId}: ${reason}`);
          return;
        }
        throw error;
      }
    });
  }
}
