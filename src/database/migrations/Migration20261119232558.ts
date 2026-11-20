import { Migration } from '@mikro-orm/migrations';

export class Migration20261119232558 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on update cascade on delete restrict;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_wallet_id_foreign";`);
  }

}
