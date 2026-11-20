import { Migration } from '@mikro-orm/migrations';

export class Migration20261119231014 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(6) not null, "amount" numeric(18,2) not null, "currency" varchar(3) not null, "balance_before" numeric(18,2) not null, "balance_after" numeric(18,2) not null, "created_at" timestamptz not null, constraint "wallet_ledger_entries_pkey" primary key ("id"), constraint chk_ledger_amount_positive check (amount > 0), constraint chk_ledger_direction check (direction IN ('CREDIT', 'DEBIT')));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "uq_ledger_transaction_wallet_direction" unique ("transaction_id", "wallet_id", "direction");`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" varchar(3) not null, "balance" numeric(18,2) not null, "version" int not null default 1, constraint "wallets_pkey" primary key ("id"), constraint chk_wallet_balance_nonnegative check (balance >= 0));`);
    this.addSql(`alter table "wallets" add constraint "uq_wallet_player_currency" unique ("player_id", "currency");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);

    this.addSql(`drop table if exists "wallets" cascade;`);
  }

}
