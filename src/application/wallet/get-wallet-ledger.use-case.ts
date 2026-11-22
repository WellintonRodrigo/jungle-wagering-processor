import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';

interface LedgerCursor {
  createdAt: string;
  id: string;
}

interface GetWalletLedgerInput {
  walletId: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class GetWalletLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: GetWalletLedgerInput) {
    const limit = input.limit ?? 20;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Limit must be between 1 and 100');
    }

    const wallet = await this.em.findOne(WalletOrmEntity, {
      id: input.walletId,
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const cursor = input.cursor ? this.decodeCursor(input.cursor) : undefined;

    const qb = this.em
      .createQueryBuilder(WalletLedgerEntryOrmEntity, 'ledger')
      .where({ wallet: wallet.id });

    if (cursor) {
      // Busca somente registros anteriores ao último item da página.
      qb.andWhere(
        '(ledger.created_at < ? OR (ledger.created_at = ? AND ledger.id < ?))',
        [cursor.createdAt, cursor.createdAt, cursor.id],
      );
    }

    const entries = await qb
      .orderBy({
        createdAt: 'DESC',
        id: 'DESC',
      })
      .limit(limit + 1)
      .getResultList();

    // Um item extra indica se existe uma próxima página.
    const hasNextPage = entries.length > limit;
    const page = entries.slice(0, limit);

    const nextCursor =
      hasNextPage && page.length > 0
        ? this.encodeCursor({
            createdAt: page[page.length - 1]!.createdAt.toISOString(),
            id: page[page.length - 1]!.id,
          })
        : null;

    return {
      items: page.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: {
          amount: entry.amount,
          currency: entry.currency,
        },
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt,
      })),
      nextCursor,
    };
  }

  private encodeCursor(cursor: LedgerCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(value: string): LedgerCursor {
    try {
      // Rejeita caracteres que não pertencem ao Base64URL.
      if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 512) {
        throw new Error('Invalid encoding');
      }

      const json = Buffer.from(value, 'base64url').toString('utf8');

      // Exige codificação canônica, sem caracteres extras.
      if (Buffer.from(json, 'utf8').toString('base64url') !== value) {
        throw new Error('Invalid encoding');
      }

      const decoded: unknown = JSON.parse(json);

      if (
        typeof decoded !== 'object' ||
        decoded === null ||
        Array.isArray(decoded)
      ) {
        throw new Error('Invalid structure');
      }

      const data = decoded as Record<string, unknown>;

      const validDate =
        typeof data.createdAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.createdAt) &&
        !Number.isNaN(Date.parse(data.createdAt)) &&
        new Date(data.createdAt).toISOString() === data.createdAt;

      const validId =
        typeof data.id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          data.id,
        );

      if (!validDate || !validId) {
        throw new Error('Invalid cursor fields');
      }

      return {
        createdAt: data.createdAt as string,
        id: data.id as string,
      };
    } catch {
      throw new BadRequestException('Invalid ledger cursor');
    }
  }
}
