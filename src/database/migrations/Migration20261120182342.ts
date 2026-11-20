
import { Migration } from '@mikro-orm/migrations';

export class Migration20261120182342 extends Migration {
  override async up(): Promise<void> {
    // Armazena data e hora das operações da carteira.
    this.addSql(`
      alter table "wallets"
      add column "created_at" timestamptz not null,
      add column "updated_at" timestamptz not null;
    `);
  }

  override async down(): Promise<void> {
    // Reverte somente as colunas criadas nesta migration.
    this.addSql(`
      alter table "wallets"
      drop column "created_at",
      drop column "updated_at";
    `);
  }
}
