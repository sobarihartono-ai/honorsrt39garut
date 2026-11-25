import { and, desc, eq } from 'drizzle-orm';
import {
  DEFAULT_CUSTOM_ACTIVITY_TITLE,
  DEFAULT_CUSTOM_MAIN_TITLE,
  DEFAULT_MASTER_EMPLOYEES,
  DEFAULT_OFFICIALS,
  DEFAULT_TRANSACTIONS,
} from '../data/seedData.ts';
import type {
  AppState,
  CategoryType,
  HistoryEntry,
  MasterEmployee,
  Officials,
  Transaction,
} from '../types.ts';
import { db } from './index.ts';
import {
  historyEntries,
  masterEmployees,
  transactions,
  users,
  workspaces,
} from './schema.ts';

export const DEFAULT_WORKSPACE_ID = 'srt39-garut-2026';

export interface WorkspaceSnapshot {
  state: AppState;
  historyLog: HistoryEntry[];
}

export interface PendingMutationsSyncPayload {
  upsertTransactions?: Transaction[];
  deleteTxIds?: string[];
  upsertEmployees?: MasterEmployee[];
  deleteEmpIds?: string[];
  historyEntries?: HistoryEntry[];
  settings?: {
    officials: Officials;
    customMainTitle: string;
    customActivityTitle: string;
    currentMonth: string;
    currentCategory: CategoryType;
  };
}

function sanitizeId(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : `id-${Date.now()}`;
}

function clampStr(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

function sanitizeCategory(cat: unknown): CategoryType {
  return cat === 'ekskul' || cat === 'gurutamu' || cat === 'lainnya' ? cat : 'ekskul';
}

function safeFiniteNumber(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeTxRecord(tx: Transaction, uid: string, workspaceId: string) {
  return {
    id: sanitizeId(tx.id),
    workspaceId,
    category: sanitizeCategory(tx.category),
    bulan: clampStr(tx.bulan || 'November', 30) || 'November',
    noBukti: clampStr(tx.noBukti || 'REG/001/2026', 80) || 'REG/001/2026',
    tanggal: clampStr(tx.tanggal || '1 November 2026', 60) || '1 November 2026',
    nama: clampStr(tx.nama || '-', 120) || '-',
    jenjang: clampStr(tx.jenjang || 'SRMP', 40) || 'SRMP',
    jenis: clampStr(tx.jenis || '-', 100) || '-',
    status: clampStr(tx.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(tx.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: safeFiniteNumber(tx.tarif, 0, 0, 100_000_000),
    jamlat: Math.round(safeFiniteNumber(tx.jamlat, 1, 1, 1000)),
    pajakRate: safeFiniteNumber(tx.pajakRate, 0, 0, 1),
    customRangka: clampStr(tx.customRangka ?? '', 250),
    createdByUid: clampStr(uid, 128),
    updatedAt: new Date(),
  };
}

function normalizeEmpRecord(emp: MasterEmployee, workspaceId: string) {
  return {
    id: sanitizeId(emp.id),
    workspaceId,
    category: sanitizeCategory(emp.category),
    nama: clampStr(emp.nama || '-', 120) || '-',
    jenis: clampStr(emp.jenis || '-', 100) || '-',
    jenjang: clampStr(emp.jenjang || 'SRMP', 40) || 'SRMP',
    status: clampStr(emp.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(emp.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: safeFiniteNumber(emp.tarif, 0, 0, 100_000_000),
    pajakRate: safeFiniteNumber(emp.pajakRate, 0, 0, 1),
    updatedAt: new Date(),
  };
}

function normalizeHistoryRecord(entry: HistoryEntry, uid: string, workspaceId: string) {
  return {
    id: sanitizeId(entry.id),
    workspaceId,
    action: clampStr(entry.action || 'Aktivitas', 80) || 'Aktivitas',
    detail: clampStr(entry.detail ?? '', 300),
    timestampMs: Math.round(
      safeFiniteNumber(entry.timestamp, Date.now(), 0, Number.MAX_SAFE_INTEGER)
    ),
    createdByUid: clampStr(uid, 128),
  };
}

export async function getOrCreateUser(uid: string, email: string, isAnonymous: boolean) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid: clampStr(uid, 128),
        email: clampStr(email, 200),
        isAnonymous,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: clampStr(email, 200),
          isAnonymous,
          lastSeenAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Operasi profil pengguna gagal.', { cause: error });
  }
}

export async function ensureWorkspaceSeeded(workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
  try {
    await db
      .insert(workspaces)
      .values({
        id: workspaceId,
        ppkName: DEFAULT_OFFICIALS.ppkName,
        ppkNip: DEFAULT_OFFICIALS.ppkNip,
        bendName: DEFAULT_OFFICIALS.bendName,
        bendNip: DEFAULT_OFFICIALS.bendNip,
        kepsekName: DEFAULT_OFFICIALS.kepsekName,
        kepsekNip: DEFAULT_OFFICIALS.kepsekNip,
        customMainTitle: DEFAULT_CUSTOM_MAIN_TITLE,
        customActivityTitle: DEFAULT_CUSTOM_ACTIVITY_TITLE,
        currentMonth: 'November',
        currentCategory: 'gurutamu',
        seeded: false,
      })
      .onConflictDoNothing();

    const existingWs = await db
      .select({ seeded: workspaces.seeded })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (existingWs[0]?.seeded) {
      return;
    }

    await db.transaction(async (trx) => {
      const wsRows = await trx
        .select({ seeded: workspaces.seeded })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      if (wsRows[0]?.seeded) {
        return;
      }

      const existingTx = await trx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.workspaceId, workspaceId))
        .limit(1);

      if (existingTx.length === 0) {
        await trx
          .insert(transactions)
          .values(DEFAULT_TRANSACTIONS.map((tx) => normalizeTxRecord(tx, 'system-seed', workspaceId)))
          .onConflictDoNothing();
      }

      const existingEmp = await trx
        .select({ id: masterEmployees.id })
        .from(masterEmployees)
        .where(eq(masterEmployees.workspaceId, workspaceId))
        .limit(1);

      if (existingEmp.length === 0) {
        await trx
          .insert(masterEmployees)
          .values(DEFAULT_MASTER_EMPLOYEES.map((emp) => normalizeEmpRecord(emp, workspaceId)))
          .onConflictDoNothing();
      }

      await trx
        .update(workspaces)
        .set({ seeded: true, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));
    });
  } catch (error) {
    console.error('Database query failed in ensureWorkspaceSeeded:', error);
    throw new Error('Gagal menyiapkan ruang kerja bersama.', { cause: error });
  }
}

export async function getWorkspaceSnapshot(
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<WorkspaceSnapshot> {
  try {
    await ensureWorkspaceSeeded(workspaceId);

    const [wsRows, txRows, empRows, histRows] = await Promise.all([
      db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.workspaceId, workspaceId))
        .orderBy(transactions.createdAt, transactions.id),
      db
        .select()
        .from(masterEmployees)
        .where(eq(masterEmployees.workspaceId, workspaceId))
        .orderBy(masterEmployees.createdAt, masterEmployees.id),
      db
        .select()
        .from(historyEntries)
        .where(eq(historyEntries.workspaceId, workspaceId))
        .orderBy(desc(historyEntries.timestampMs))
        .limit(50),
    ]);

    const ws = wsRows[0];

    return {
      state: {
        transactions: txRows.map((row) => ({
          id: row.id,
          category: sanitizeCategory(row.category),
          bulan: row.bulan,
          noBukti: row.noBukti,
          tanggal: row.tanggal,
          nama: row.nama,
          jenjang: row.jenjang,
          jenis: row.jenis,
          status: row.status,
          jabatan: row.jabatan,
          tarif: Number(row.tarif) || 0,
          jamlat: Number(row.jamlat) || 1,
          pajakRate: Number(row.pajakRate) || 0,
          customRangka: row.customRangka || '',
        })),
        masterEmployees: empRows.map((row) => ({
          id: row.id,
          category: sanitizeCategory(row.category),
          nama: row.nama,
          jenis: row.jenis,
          jenjang: row.jenjang,
          status: row.status,
          jabatan: row.jabatan,
          tarif: Number(row.tarif) || 0,
          pajakRate: Number(row.pajakRate) || 0,
        })),
        officials: {
          ppkName: ws?.ppkName || DEFAULT_OFFICIALS.ppkName,
          ppkNip: ws?.ppkNip ?? DEFAULT_OFFICIALS.ppkNip,
          bendName: ws?.bendName || DEFAULT_OFFICIALS.bendName,
          bendNip: ws?.bendNip ?? DEFAULT_OFFICIALS.bendNip,
          kepsekName: ws?.kepsekName || DEFAULT_OFFICIALS.kepsekName,
          kepsekNip: ws?.kepsekNip ?? DEFAULT_OFFICIALS.kepsekNip,
        },
        customMainTitle: ws?.customMainTitle || DEFAULT_CUSTOM_MAIN_TITLE,
        customActivityTitle: ws?.customActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE,
        currentMonth: ws?.currentMonth || 'November',
        currentCategory: sanitizeCategory(ws?.currentCategory || 'gurutamu'),
      },
      historyLog: histRows.map((h) => ({
        id: h.id,
        timestamp: Number(h.timestampMs) || Date.now(),
        action: h.action,
        detail: h.detail,
      })),
    };
  } catch (error) {
    console.error('Database query failed in getWorkspaceSnapshot:', error);
    throw new Error('Gagal memuat data ruang kerja dari server.', { cause: error });
  }
}

export async function upsertTransaction(
  tx: Transaction,
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);
    const record = normalizeTxRecord(tx, uid, workspaceId);

    await db.transaction(async (trx) => {
      await trx
        .insert(transactions)
        .values(record)
        .onConflictDoUpdate({
          target: [transactions.workspaceId, transactions.id],
          set: {
            category: record.category,
            bulan: record.bulan,
            noBukti: record.noBukti,
            tanggal: record.tanggal,
            nama: record.nama,
            jenjang: record.jenjang,
            jenis: record.jenis,
            status: record.status,
            jabatan: record.jabatan,
            tarif: record.tarif,
            jamlat: record.jamlat,
            pajakRate: record.pajakRate,
            customRangka: record.customRangka,
            updatedAt: new Date(),
          },
        });

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in upsertTransaction:', error);
    throw new Error('Gagal menyimpan entri SPJ ke server.', { cause: error });
  }
}

export async function batchCreateTransactions(
  txList: Transaction[],
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);
    if (txList.length === 0 && !historyEntry) return;

    await db.transaction(async (trx) => {
      for (const tx of txList) {
        const record = normalizeTxRecord(tx, uid, workspaceId);
        await trx
          .insert(transactions)
          .values(record)
          .onConflictDoUpdate({
            target: [transactions.workspaceId, transactions.id],
            set: {
              category: record.category,
              bulan: record.bulan,
              noBukti: record.noBukti,
              tanggal: record.tanggal,
              nama: record.nama,
              jenjang: record.jenjang,
              jenis: record.jenis,
              status: record.status,
              jabatan: record.jabatan,
              tarif: record.tarif,
              jamlat: record.jamlat,
              pajakRate: record.pajakRate,
              customRangka: record.customRangka,
              updatedAt: new Date(),
            },
          });
      }

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in batchCreateTransactions:', error);
    throw new Error('Gagal menyalin entri SPJ ke server.', { cause: error });
  }
}

export async function deleteTransaction(
  id: string,
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);
    const safeId = sanitizeId(id);

    await db.transaction(async (trx) => {
      await trx
        .delete(transactions)
        .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, safeId)));

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in deleteTransaction:', error);
    throw new Error('Gagal menghapus entri SPJ di server.', { cause: error });
  }
}

export async function upsertEmployee(
  emp: MasterEmployee,
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);
    const record = normalizeEmpRecord(emp, workspaceId);

    await db.transaction(async (trx) => {
      await trx
        .insert(masterEmployees)
        .values(record)
        .onConflictDoUpdate({
          target: [masterEmployees.workspaceId, masterEmployees.id],
          set: {
            category: record.category,
            nama: record.nama,
            jenis: record.jenis,
            jenjang: record.jenjang,
            status: record.status,
            jabatan: record.jabatan,
            tarif: record.tarif,
            pajakRate: record.pajakRate,
            updatedAt: new Date(),
          },
        });

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in upsertEmployee:', error);
    throw new Error('Gagal menyimpan pegawai master ke server.', { cause: error });
  }
}

export async function deleteEmployee(
  id: string,
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);
    const safeId = sanitizeId(id);

    await db.transaction(async (trx) => {
      await trx
        .delete(masterEmployees)
        .where(and(eq(masterEmployees.workspaceId, workspaceId), eq(masterEmployees.id, safeId)));

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in deleteEmployee:', error);
    throw new Error('Gagal menghapus pegawai master di server.', { cause: error });
  }
}

export async function updateWorkspaceSettings(
  settings: {
    officials?: Officials;
    customMainTitle?: string;
    customActivityTitle?: string;
    currentMonth?: string;
    currentCategory?: CategoryType;
  },
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);

    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (settings.officials) {
      updateSet.ppkName = clampStr(settings.officials.ppkName, 120);
      updateSet.ppkNip = clampStr(settings.officials.ppkNip, 60);
      updateSet.bendName = clampStr(settings.officials.bendName, 120);
      updateSet.bendNip = clampStr(settings.officials.bendNip, 60);
      updateSet.kepsekName = clampStr(settings.officials.kepsekName, 120);
      updateSet.kepsekNip = clampStr(settings.officials.kepsekNip, 60);
    }
    if (typeof settings.customMainTitle === 'string') {
      updateSet.customMainTitle =
        clampStr(settings.customMainTitle, 200) || DEFAULT_CUSTOM_MAIN_TITLE;
    }
    if (typeof settings.customActivityTitle === 'string') {
      updateSet.customActivityTitle =
        clampStr(settings.customActivityTitle, 250) || DEFAULT_CUSTOM_ACTIVITY_TITLE;
    }
    if (typeof settings.currentMonth === 'string') {
      updateSet.currentMonth = clampStr(settings.currentMonth, 30) || 'November';
    }
    if (settings.currentCategory !== undefined) {
      updateSet.currentCategory = sanitizeCategory(settings.currentCategory);
    }

    await db.transaction(async (trx) => {
      await trx.update(workspaces).set(updateSet).where(eq(workspaces.id, workspaceId));

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in updateWorkspaceSettings:', error);
    throw new Error('Gagal menyimpan pengaturan pejabat & judul ke server.', { cause: error });
  }
}

export async function replaceWorkspaceData(
  state: AppState,
  uid: string,
  historyEntry?: HistoryEntry,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);

    await db.transaction(async (trx) => {
      await trx.delete(transactions).where(eq(transactions.workspaceId, workspaceId));
      await trx.delete(masterEmployees).where(eq(masterEmployees.workspaceId, workspaceId));

      if (state.transactions.length > 0) {
        await trx
          .insert(transactions)
          .values(state.transactions.map((tx) => normalizeTxRecord(tx, uid, workspaceId)))
          .onConflictDoNothing();
      }

      if (state.masterEmployees.length > 0) {
        await trx
          .insert(masterEmployees)
          .values(state.masterEmployees.map((emp) => normalizeEmpRecord(emp, workspaceId)))
          .onConflictDoNothing();
      }

      await trx
        .update(workspaces)
        .set({
          ppkName: clampStr(state.officials.ppkName, 120) || DEFAULT_OFFICIALS.ppkName,
          ppkNip: clampStr(state.officials.ppkNip, 60),
          bendName: clampStr(state.officials.bendName, 120) || DEFAULT_OFFICIALS.bendName,
          bendNip: clampStr(state.officials.bendNip, 60),
          kepsekName: clampStr(state.officials.kepsekName, 120) || DEFAULT_OFFICIALS.kepsekName,
          kepsekNip: clampStr(state.officials.kepsekNip, 60),
          customMainTitle: clampStr(state.customMainTitle, 200) || DEFAULT_CUSTOM_MAIN_TITLE,
          customActivityTitle:
            clampStr(state.customActivityTitle, 250) || DEFAULT_CUSTOM_ACTIVITY_TITLE,
          currentMonth: clampStr(state.currentMonth || 'November', 30) || 'November',
          currentCategory: sanitizeCategory(state.currentCategory),
          seeded: true,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspaceId));

      if (historyEntry) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(historyEntry, uid, workspaceId))
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Database query failed in replaceWorkspaceData:', error);
    throw new Error('Gagal memperbarui seluruh data ruang kerja di server.', { cause: error });
  }
}

export async function syncPendingMutationsBatch(
  payload: PendingMutationsSyncPayload,
  uid: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  try {
    await ensureWorkspaceSeeded(workspaceId);

    await db.transaction(async (trx) => {
      const txList = Array.isArray(payload.upsertTransactions) ? payload.upsertTransactions : [];
      for (const tx of txList) {
        const record = normalizeTxRecord(tx, uid, workspaceId);
        await trx
          .insert(transactions)
          .values(record)
          .onConflictDoUpdate({
            target: [transactions.workspaceId, transactions.id],
            set: {
              category: record.category,
              bulan: record.bulan,
              noBukti: record.noBukti,
              tanggal: record.tanggal,
              nama: record.nama,
              jenjang: record.jenjang,
              jenis: record.jenis,
              status: record.status,
              jabatan: record.jabatan,
              tarif: record.tarif,
              jamlat: record.jamlat,
              pajakRate: record.pajakRate,
              customRangka: record.customRangka,
              updatedAt: new Date(),
            },
          });
      }

      const deleteTxIds = Array.isArray(payload.deleteTxIds) ? payload.deleteTxIds : [];
      for (const id of deleteTxIds) {
        const safeId = sanitizeId(id);
        await trx
          .delete(transactions)
          .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, safeId)));
      }

      const empList = Array.isArray(payload.upsertEmployees) ? payload.upsertEmployees : [];
      for (const emp of empList) {
        const record = normalizeEmpRecord(emp, workspaceId);
        await trx
          .insert(masterEmployees)
          .values(record)
          .onConflictDoUpdate({
            target: [masterEmployees.workspaceId, masterEmployees.id],
            set: {
              category: record.category,
              nama: record.nama,
              jenis: record.jenis,
              jenjang: record.jenjang,
              status: record.status,
              jabatan: record.jabatan,
              tarif: record.tarif,
              pajakRate: record.pajakRate,
              updatedAt: new Date(),
            },
          });
      }

      const deleteEmpIds = Array.isArray(payload.deleteEmpIds) ? payload.deleteEmpIds : [];
      for (const id of deleteEmpIds) {
        const safeId = sanitizeId(id);
        await trx
          .delete(masterEmployees)
          .where(and(eq(masterEmployees.workspaceId, workspaceId), eq(masterEmployees.id, safeId)));
      }

      const histList = Array.isArray(payload.historyEntries) ? payload.historyEntries : [];
      for (const entry of histList) {
        await trx
          .insert(historyEntries)
          .values(normalizeHistoryRecord(entry, uid, workspaceId))
          .onConflictDoNothing();
      }

      if (payload.settings) {
        await trx
          .update(workspaces)
          .set({
            ppkName: clampStr(payload.settings.officials.ppkName, 120) || DEFAULT_OFFICIALS.ppkName,
            ppkNip: clampStr(payload.settings.officials.ppkNip, 60),
            bendName:
              clampStr(payload.settings.officials.bendName, 120) || DEFAULT_OFFICIALS.bendName,
            bendNip: clampStr(payload.settings.officials.bendNip, 60),
            kepsekName:
              clampStr(payload.settings.officials.kepsekName, 120) || DEFAULT_OFFICIALS.kepsekName,
            kepsekNip: clampStr(payload.settings.officials.kepsekNip, 60),
            customMainTitle:
              clampStr(payload.settings.customMainTitle, 200) || DEFAULT_CUSTOM_MAIN_TITLE,
            customActivityTitle:
              clampStr(payload.settings.customActivityTitle, 250) || DEFAULT_CUSTOM_ACTIVITY_TITLE,
            currentMonth: clampStr(payload.settings.currentMonth || 'November', 30) || 'November',
            currentCategory: sanitizeCategory(payload.settings.currentCategory),
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, workspaceId));
      }
    });
  } catch (error) {
    console.error('Database query failed in syncPendingMutationsBatch:', error);
    throw new Error('Gagal menyinkronkan antrean perubahan ke server.', { cause: error });
  }
}
