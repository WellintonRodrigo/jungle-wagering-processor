import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionKind } from '../../domain/wager/wager-transaction.js';
import {
  ProcessWalletOperationUseCase,
  type ProcessWalletOperationInput,
  type ProcessWalletOperationResult,
} from './process-wallet-operation.use-case.js';

@Injectable()
export class ProcessWinUseCase {
  constructor(private readonly em: EntityManager) {}

  execute(input: ProcessWalletOperationInput): Promise<ProcessWalletOperationResult> {
    return new ProcessWalletOperationUseCase(this.em).execute(WagerTransactionKind.Win, input);
  }
}
