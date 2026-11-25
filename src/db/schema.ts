import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().default(''),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  ppkName: text('ppk_name').notNull(),
  ppkNip: text('ppk_nip').notNull(),
  bendName: text('bend_name').notNull(),
  bendNip: text('bend_nip').notNull(),
  kepsekName: text('kepsek_name').notNull(),
  kepsekNip: text('kepsek_nip').notNull(),
  customMainTitle: text('custom_main_title').notNull(),
  customActivityTitle: text('custom_activity_title').notNull(),
  currentMonth: text('current_month').notNull().default('November'),
  currentCategory: text('current_category').notNull().default('gurutamu'),
  seeded: boolean('seeded').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    category: text('category').notNull(),
    bulan: text('bulan').notNull(),
    noBukti: text('no_bukti').notNull(),
    tanggal: text('tanggal').notNull(),
    nama: text('nama').notNull(),
    jenjang: text('jenjang').notNull(),
    jenis: text('jenis').notNull(),
    status: text('status').notNull(),
    jabatan: text('jabatan').notNull(),
    tarif: doublePrecision('tarif').notNull(),
    jamlat: integer('jamlat').notNull(),
    pajakRate: doublePrecision('pajak_rate').notNull(),
    customRangka: text('custom_rangka').notNull().default(''),
    createdByUid: text('created_by_uid').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })]
);

export const masterEmployees = pgTable(
  'master_employees',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    category: text('category').notNull(),
    nama: text('nama').notNull(),
    jenis: text('jenis').notNull(),
    jenjang: text('jenjang').notNull(),
    status: text('status').notNull(),
    jabatan: text('jabatan').notNull(),
    tarif: doublePrecision('tarif').notNull(),
    pajakRate: doublePrecision('pajak_rate').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })]
);

export const historyEntries = pgTable(
  'history_entries',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    action: text('action').notNull(),
    detail: text('detail').notNull(),
    timestampMs: bigint('timestamp_ms', { mode: 'number' }).notNull(),
    createdByUid: text('created_by_uid').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })]
);

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  transactions: many(transactions),
  masterEmployees: many(masterEmployees),
  historyEntries: many(historyEntries),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [transactions.workspaceId],
    references: [workspaces.id],
  }),
}));

export const masterEmployeesRelations = relations(masterEmployees, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [masterEmployees.workspaceId],
    references: [workspaces.id],
  }),
}));

export const historyEntriesRelations = relations(historyEntries, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [historyEntries.workspaceId],
    references: [workspaces.id],
  }),
}));
