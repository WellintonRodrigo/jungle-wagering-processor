import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { CreateWalletUseCase } from './wallet.use-case.js';
import { GetWalletUseCase } from './get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from './get-wallet-ledger.use-case.js';
import{CreateWalletDto} from './dto/create-wallet.dto.js';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getWalletLedger: GetWalletLedgerUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateWalletDto) {
    return this.createWallet.execute(body);
  }
  @Get('/:walletId')
  async findById(@Param('walletId', new ParseUUIDPipe()) walletId: string) {
    return this.getWallet.execute(walletId);
  }
  @Get(':walletId/ledger')
  async getLedger(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.getWalletLedger.execute({
      walletId,
      // Query params chegam como string, mesmo quando representam números.
      limit: limit === undefined ? 20 : Number(limit),
      cursor,
    });
  }
 
}
