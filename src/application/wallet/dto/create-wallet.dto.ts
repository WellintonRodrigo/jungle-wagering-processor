
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class InitialBalanceDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Amount must be a non-negative decimal with up to 2 places',
  })
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'Currency must be a three-letter uppercase code',
  })
  currency!: string;
}

export class CreateWalletDto {
  @IsUUID()
  playerId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => InitialBalanceDto)
  initialBalance!: InitialBalanceDto;
}
