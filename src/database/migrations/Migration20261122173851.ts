import { Migration } from '@mikro-orm/migrations';

export class Migration20261122173851 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "inbox_messages" ("id" uuid not null, "message_id" varchar(255) not null, "source" varchar(100) not null, "payload" jsonb not null, "status" varchar(20) not null default 'PENDING', "received_at" timestamptz not null default now(), "processed_at" timestamptz null, constraint "inbox_messages_pkey" primary key ("id"), constraint chk_inbox_status check (status in ('PENDING', 'PROCESSED', 'FAILED')));`);
    this.addSql(`create index "idx_inbox_status_received" on "inbox_messages" ("status", "received_at");`);
    this.addSql(`alter table "inbox_messages" add constraint "uq_inbox_source_message" unique ("source", "message_id");`);

    this.addSql(`create table "outbox_events" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" varchar(100) not null, "payload" jsonb not null, "status" varchar(20) not null default 'PENDING', "attempts" int not null default 0, "created_at" timestamptz not null default now(), "published_at" timestamptz null, constraint "outbox_events_pkey" primary key ("id"), constraint chk_outbox_status check (status in ('PENDING', 'PUBLISHED', 'FAILED')), constraint chk_outbox_attempts check (attempts >= 0));`);
    this.addSql(`create index "idx_outbox_status_created" on "outbox_events" ("status", "created_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "outbox_events" cascade;`);
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
  }

}
