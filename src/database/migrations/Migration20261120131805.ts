import { Migration } from '@mikro-orm/migrations';

export class Migration20261120131805 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(100) not null, "external_transaction_id" varchar(150) not null, "idempotency_key" varchar(200) not null, "payload_hash" varchar(64) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(150) not null, "game_id" varchar(150) not null, "kind" varchar(20) not null, "amount" numeric(18,2) not null, "currency" varchar(3) not null, "status" varchar(30) not null, "reference_external_transaction_id" varchar(150) null, "reference_transaction_id" uuid null, "failure_code" varchar(100) null, "created_at" timestamptz not null, "processed_at" timestamptz null, constraint "wager_transactions_pkey" primary key ("id"));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`create index "idx_wager_transactions_wallet_created" on "wager_transactions" ("wallet_id", "created_at");`);
    this.addSql(`create index "idx_wager_transactions_reference" on "wager_transactions" ("provider_id", "reference_external_transaction_id");`);
    this.addSql(`alter table "wager_transactions" add constraint "uq_wager_provider_external_transaction" unique ("provider_id", "external_transaction_id");`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on update cascade on delete restrict;`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "uq_ledger_transaction_wallet_direction";`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "uq_ledger_transaction_wallet" unique ("transaction_id", "wallet_id");`);
   
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "wager_transactions" cascade;`);

    this.addSql(`alter table "wallet_ledger_entries" drop constraint "uq_ledger_transaction_wallet";`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "uq_ledger_transaction_wallet_direction" unique ("transaction_id", "wallet_id", "direction");`);
  }

}
