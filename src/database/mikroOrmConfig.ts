
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import 'dotenv/config';
import { WalletSchema } 
from '../infrastructure/persistence/mikro-orm/entities/wallet.orm-entity.js';

import { WalletLedgerEntrySchema } 
from '../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.orm-entity.js';

import { WagerTransactionSchema,} 
from '../infrastructure/persistence/mikro-orm/entities/wager-transaction.orm-entity.js';

import { InboxMessageSchema } from
  '../infrastructure/persistence/mikro-orm/entities/inbox-message.orm-entity.js';

import { OutboxEventSchema } from
  '../infrastructure/persistence/mikro-orm/entities/outbox-event.orm-entity.js';

export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  user: process.env.DB_USER ?? 'jungle',
  password: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME ?? 'jungle_wagering',

  
  entities: 
  [
    WalletSchema,
    WalletLedgerEntrySchema,
    WagerTransactionSchema,
    InboxMessageSchema,
    OutboxEventSchema,
  ],


  extensions: [Migrator],

  migrations: {
    path: './dist/database/migrations',
    pathTs: './src/database/migrations',
    emit: 'ts',
  },

  debug: process.env.NODE_ENV === 'development',
});
