
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletOrmEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';

@Injectable()
export class GetWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string) {
    const wallet = await this.em.findOne(
      WalletOrmEntity,
      { id: walletId },
    );

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: {
        amount: wallet.balance,
        currency: wallet.currency,
      },
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
