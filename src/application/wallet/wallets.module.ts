
import { Module } from '@nestjs/common';

import { CreateWalletUseCase } from './wallet.use-case.js';
import { WalletsController } from './wallets.controller.js';
import { GetWalletUseCase } from './get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from './get-wallet-ledger.use-case.js';

@Module({
  controllers: 
  [
    WalletsController,
  ],
  providers: 
  [
    CreateWalletUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
  ],
})
export class WalletsModule {}
