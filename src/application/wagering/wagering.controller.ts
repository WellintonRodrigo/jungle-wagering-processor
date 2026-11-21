import { Body, Controller, Headers, HttpCode, Post, BadRequestException, ConflictException, UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';
import { WageringDispatcher } from './wagering.dispatcher.js';
import type { SubmitTransactionBody } from './wagering.types.js';

@Controller('wagering')
export class WageringController {
  constructor(private readonly dispatcher: WageringDispatcher) {}

  @Post('transactions')
  @HttpCode(200)
  async submit(@Body() body: unknown, @Headers('idempotency-key') key?: string) {
    if (!key || !key.trim() || key.length > 200) throw new BadRequestException('Idempotency-Key header is required (max 200 characters)');
    const input = validateBody(body);
    try {
      return await this.dispatcher.execute(input, key);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      if (/Idempotency conflict|already compensated/i.test(message)) throw new ConflictException(message);
      if (/not found|mismatch|insufficient|requires|not processed|must not reference|amount/i.test(message)) throw new UnprocessableEntityException(message);
      if (/Unsupported|not implemented/i.test(message)) throw new UnprocessableEntityException(message);
      // Não revelar detalhes internos da infraestrutura ao cliente.
      throw new ServiceUnavailableException('Transaction processing temporarily unavailable');
    }
  }
}

function validateBody(value: unknown): SubmitTransactionBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Body must be an object');
  const obj = value as Record<string, unknown>;
  const required = ['providerId','externalTransactionId','playerId','walletId','roundId','gameId'];
  for (const field of required) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string).trim()) throw new BadRequestException(`${field} is required`);
  }
  if (!['BET','WIN','LOSS','REFUND','ROLLBACK'].includes(String(obj.kind))) throw new BadRequestException('Invalid kind');
  if (!obj.money || typeof obj.money !== 'object' || Array.isArray(obj.money)) throw new BadRequestException('money is required');
  const money = obj.money as Record<string, unknown>;
  if (typeof money.amount !== 'string' || !/^(?:0|[1-9]\d*)\.\d{2}$/.test(money.amount) || money.amount === '0.00') throw new BadRequestException('money.amount must be a positive decimal string with two places');
  if (typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency)) throw new BadRequestException('Invalid money.currency');
  if (obj.referenceExternalTransactionId !== undefined && (typeof obj.referenceExternalTransactionId !== 'string' || !obj.referenceExternalTransactionId.trim())) throw new BadRequestException('Invalid referenceExternalTransactionId');
  if (['REFUND','ROLLBACK'].includes(String(obj.kind)) && !obj.referenceExternalTransactionId) throw new BadRequestException('referenceExternalTransactionId is required');
  return obj as unknown as SubmitTransactionBody;
}
