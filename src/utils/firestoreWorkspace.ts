import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_CUSTOM_ACTIVITY_TITLE,
  DEFAULT_CUSTOM_MAIN_TITLE,
  DEFAULT_MASTER_EMPLOYEES,
  DEFAULT_OFFICIALS,
  DEFAULT_TRANSACTIONS,
} from '../data/seedData';
import { auth, db } from '../firebase';
import type {
  AppState,
  CategoryType,
  HistoryEntry,
  MasterEmployee,
  Officials,
  Transaction,
} from '../types';
import { sanitizeFirestoreId } from './formatters';

export const FIRESTORE_WORKSPACE_ID = 'srt39-garut-2026';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;
export async function testFirestoreConnection(): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
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

function toTimestampMs(val: unknown): number {
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function buildTxPayload(tx: Transaction, uid: string) {
  return {
    workspaceId: FIRESTORE_WORKSPACE_ID,
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
    updatedByUid: clampStr(uid, 128) || 'anon',
  };
}

function buildEmpPayload(emp: MasterEmployee, uid: string) {
  return {
    workspaceId: FIRESTORE_WORKSPACE_ID,
    category: sanitizeCategory(emp.category),
    nama: clampStr(emp.nama || '-', 120) || '-',
    jenis: clampStr(emp.jenis || '-', 100) || '-',
    jenjang: clampStr(emp.jenjang || 'SRMP', 40) || 'SRMP',
    status: clampStr(emp.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(emp.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: safeFiniteNumber(emp.tarif, 0, 0, 100_000_000),
    pajakRate: safeFiniteNumber(emp.pajakRate, 0, 0, 1),
    updatedByUid: clampStr(uid, 128) || 'anon',
  };
}

function buildSettingsPayload(
  settings: {
    officials: Officials;
    customMainTitle: string;
    customActivityTitle: string;
    currentMonth: string;
    currentCategory: CategoryType;
  },
  uid: string
) {
  return {
    ppkName: clampStr(settings.officials?.ppkName || DEFAULT_OFFICIALS.ppkName, 120),
    ppkNip: clampStr(settings.officials?.ppkNip ?? DEFAULT_OFFICIALS.ppkNip, 60),
    bendName: clampStr(settings.officials?.bendName || DEFAULT_OFFICIALS.bendName, 120),
    bendNip: clampStr(settings.officials?.bendNip ?? DEFAULT_OFFICIALS.bendNip, 60),
    kepsekName: clampStr(settings.officials?.kepsekName || DEFAULT_OFFICIALS.kepsekName, 120),
    kepsekNip: clampStr(settings.officials?.kepsekNip ?? DEFAULT_OFFICIALS.kepsekNip, 60),
    customMainTitle: clampStr(settings.customMainTitle || DEFAULT_CUSTOM_MAIN_TITLE, 200),
    customActivityTitle: clampStr(
      settings.customActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE,
      250
    ),
    currentMonth: clampStr(settings.currentMonth || 'November', 30) || 'November',
    currentCategory: sanitizeCategory(settings.currentCategory),
    updatedByUid: clampStr(uid, 128) || 'anon',
  };
}

export async function ensureWorkspaceSeededFirestore(uid: string): Promise<void> {
  void testFirestoreConnection();
  const safeUid = clampStr(uid, 128) || 'anon';
  const wsPath = `workspaces/${FIRESTORE_WORKSPACE_ID}`;
  const wsRef = doc(db, 'workspaces', FIRESTORE_WORKSPACE_ID);

  let wsSnap;
  try {
    wsSnap = await getDoc(wsRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  if (!wsSnap.exists()) {
    try {
      await setDoc(wsRef, {
        workspaceId: FIRESTORE_WORKSPACE_ID,
        ...buildSettingsPayload(
          {
            officials: DEFAULT_OFFICIALS,
            customMainTitle: DEFAULT_CUSTOM_MAIN_TITLE,
            customActivityTitle: DEFAULT_CUSTOM_ACTIVITY_TITLE,
            currentMonth: 'November',
            currentCategory: 'gurutamu',
          },
          safeUid
        ),
        seeded: false,
        createdByUid: safeUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, wsPath);
    }
  } else if (wsSnap.data()?.seeded === true) {
    return;
  }

  const txColPath = `${wsPath}/transactions`;
  const empColPath = `${wsPath}/employees`;
  let hasTx = false;
  let hasEmp = false;

  try {
    const existingTx = await getDocs(
      query(
        collection(db, txColPath),
        where('workspaceId', '==', FIRESTORE_WORKSPACE_ID),
        limit(1)
      )
    );
    hasTx = !existingTx.empty;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, txColPath);
  }

  try {
    const existingEmp = await getDocs(
      query(
        collection(db, empColPath),
        where('workspaceId', '==', FIRESTORE_WORKSPACE_ID),
        limit(1)
      )
    );
    hasEmp = !existingEmp.empty;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, empColPath);
  }

  if (!hasTx || !hasEmp) {
    const batch = writeBatch(db);
    if (!hasTx) {
      for (const tx of DEFAULT_TRANSACTIONS) {
        const sid = sanitizeFirestoreId(tx.id);
        batch.set(doc(db, txColPath, sid), {
          ...buildTxPayload(tx, safeUid),
          createdByUid: safeUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    if (!hasEmp) {
      for (const emp of DEFAULT_MASTER_EMPLOYEES) {
        const sid = sanitizeFirestoreId(emp.id);
        batch.set(doc(db, empColPath, sid), {
          ...buildEmpPayload(emp, safeUid),
          createdByUid: safeUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, txColPath);
    }
  }

  try {
    await updateDoc(wsRef, {
      seeded: true,
      updatedByUid: safeUid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, wsPath);
  }
}

function mapWorkspaceDocToSettings(data: Record<string, unknown> | undefined) {
  return {
    officials: {
      ppkName: String(data?.ppkName || DEFAULT_OFFICIALS.ppkName),
      ppkNip: String(data?.ppkNip ?? DEFAULT_OFFICIALS.ppkNip),
      bendName: String(data?.bendName || DEFAULT_OFFICIALS.bendName),
      bendNip: String(data?.bendNip ?? DEFAULT_OFFICIALS.bendNip),
      kepsekName: String(data?.kepsekName || DEFAULT_OFFICIALS.kepsekName),
      kepsekNip: String(data?.kepsekNip ?? DEFAULT_OFFICIALS.kepsekNip),
    },
    customMainTitle: String(data?.customMainTitle || DEFAULT_CUSTOM_MAIN_TITLE),
    customActivityTitle: String(data?.customActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE),
    currentMonth: String(data?.currentMonth || 'November'),
    currentCategory: sanitizeCategory(data?.currentCategory),
  };
}

function mapDocToTx(id: string, data: Record<string, unknown>): Transaction {
  return {
    id,
    category: sanitizeCategory(data.category),
    bulan: String(data.bulan || 'November'),
    noBukti: String(data.noBukti || ''),
    tanggal: String(data.tanggal || ''),
    nama: String(data.nama || ''),
    jenjang: String(data.jenjang || 'SRMP'),
    jenis: String(data.jenis || ''),
    status: String(data.status || 'NON ASN'),
    jabatan: String(data.jabatan || ''),
    tarif: Number(data.tarif) || 0,
    jamlat: Number(data.jamlat) || 1,
    pajakRate: Number(data.pajakRate) || 0,
    customRangka: String(data.customRangka || ''),
  };
}

function mapDocToEmp(id: string, data: Record<string, unknown>): MasterEmployee {
  return {
    id,
    category: sanitizeCategory(data.category),
    nama: String(data.nama || ''),
    jenis: String(data.jenis || ''),
    jenjang: String(data.jenjang || 'SRMP'),
    status: String(data.status || 'NON ASN'),
    jabatan: String(data.jabatan || ''),
    tarif: Number(data.tarif) || 0,
    pajakRate: Number(data.pajakRate) || 0,
  };
}

export async function getWorkspaceSnapshotFirestore(
  uid: string
): Promise<{ state: AppState; historyLog: HistoryEntry[] }> {
  await ensureWorkspaceSeededFirestore(uid);

  const wsPath = `workspaces/${FIRESTORE_WORKSPACE_ID}`;
  const txPath = `${wsPath}/transactions`;
  const empPath = `${wsPath}/employees`;
  const histPath = `${wsPath}/history`;

  let wsSnap;
  let txSnap;
  let empSnap;
  let histSnap;

  try {
    wsSnap = await getDoc(doc(db, 'workspaces', FIRESTORE_WORKSPACE_ID));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  try {
    txSnap = await getDocs(
      query(collection(db, txPath), where('workspaceId', '==', FIRESTORE_WORKSPACE_ID))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, txPath);
  }

  try {
    empSnap = await getDocs(
      query(collection(db, empPath), where('workspaceId', '==', FIRESTORE_WORKSPACE_ID))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, empPath);
  }

  try {
    histSnap = await getDocs(
      query(collection(db, histPath), where('workspaceId', '==', FIRESTORE_WORKSPACE_ID))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, histPath);
  }

  const settings = mapWorkspaceDocToSettings(wsSnap.data() as Record<string, unknown> | undefined);

  const transactions = txSnap.docs
    .map((d) => ({
      tx: mapDocToTx(d.id, d.data() as Record<string, unknown>),
      createdAtMs: toTimestampMs(d.data().createdAt),
    }))
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.tx.id.localeCompare(b.tx.id))
    .map((item) => item.tx);

  const masterEmployees = empSnap.docs
    .map((d) => ({
      emp: mapDocToEmp(d.id, d.data() as Record<string, unknown>),
      createdAtMs: toTimestampMs(d.data().createdAt),
    }))
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.emp.id.localeCompare(b.emp.id))
    .map((item) => item.emp);

  const historyLog: HistoryEntry[] = histSnap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        action: String(data.action || 'Aktivitas'),
        detail: String(data.detail || ''),
        timestamp: Number(data.timestamp) || 0,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  return {
    state: {
      transactions,
      masterEmployees,
      ...settings,
    },
    historyLog,
  };
}

async function createHistoryEntryFirestore(
  entry: HistoryEntry | undefined,
  uid: string
): Promise<void> {
  if (!entry) return;
  const sid = sanitizeFirestoreId(entry.id);
  const path = `workspaces/${FIRESTORE_WORKSPACE_ID}/history/${sid}`;
  const ref = doc(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/history`, sid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      workspaceId: FIRESTORE_WORKSPACE_ID,
      action: clampStr(entry.action || 'Aktivitas', 80) || 'Aktivitas',
      detail: clampStr(entry.detail ?? '', 300),
      timestamp: Math.round(
        safeFiniteNumber(entry.timestamp, Date.now(), 0, Number.MAX_SAFE_INTEGER)
      ),
      createdByUid: clampStr(uid, 128) || 'anon',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function upsertTransactionFirestore(
  tx: Transaction,
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const safeUid = clampStr(uid, 128) || 'anon';
  const sid = sanitizeFirestoreId(tx.id);
  const path = `workspaces/${FIRESTORE_WORKSPACE_ID}/transactions/${sid}`;
  const ref = doc(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/transactions`, sid);
  const payload = buildTxPayload(tx, safeUid);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const { workspaceId: _ws, ...updateFields } = payload;
      await updateDoc(ref, {
        ...updateFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdByUid: safeUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  await createHistoryEntryFirestore(historyEntry, safeUid);
}

export async function batchCreateTransactionsFirestore(
  txList: Transaction[],
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const safeUid = clampStr(uid, 128) || 'anon';
  const txCol = `workspaces/${FIRESTORE_WORKSPACE_ID}/transactions`;

  for (const tx of txList) {
    const sid = sanitizeFirestoreId(tx.id);
    const ref = doc(db, txCol, sid);
    const payload = buildTxPayload(tx, safeUid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const { workspaceId: _ws, ...updateFields } = payload;
        await updateDoc(ref, {
          ...updateFields,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...payload,
          createdByUid: safeUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${txCol}/${sid}`);
    }
  }

  await createHistoryEntryFirestore(historyEntry, safeUid);
}

export async function deleteTransactionFirestore(
  txId: string,
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const sid = sanitizeFirestoreId(txId);
  const path = `workspaces/${FIRESTORE_WORKSPACE_ID}/transactions/${sid}`;
  try {
    await deleteDoc(doc(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/transactions`, sid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
  await createHistoryEntryFirestore(historyEntry, uid);
}

export async function upsertEmployeeFirestore(
  emp: MasterEmployee,
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const safeUid = clampStr(uid, 128) || 'anon';
  const sid = sanitizeFirestoreId(emp.id);
  const path = `workspaces/${FIRESTORE_WORKSPACE_ID}/employees/${sid}`;
  const ref = doc(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/employees`, sid);
  const payload = buildEmpPayload(emp, safeUid);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const { workspaceId: _ws, ...updateFields } = payload;
      await updateDoc(ref, {
        ...updateFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdByUid: safeUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  await createHistoryEntryFirestore(historyEntry, safeUid);
}

export async function deleteEmployeeFirestore(
  empId: string,
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const sid = sanitizeFirestoreId(empId);
  const path = `workspaces/${FIRESTORE_WORKSPACE_ID}/employees/${sid}`;
  try {
    await deleteDoc(doc(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/employees`, sid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
  await createHistoryEntryFirestore(historyEntry, uid);
}

export async function updateWorkspaceSettingsFirestore(
  settings: {
    officials: Officials;
    customMainTitle: string;
    customActivityTitle: string;
    currentMonth: string;
    currentCategory: CategoryType;
  },
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const safeUid = clampStr(uid, 128) || 'anon';
  const wsPath = `workspaces/${FIRESTORE_WORKSPACE_ID}`;
  try {
    await updateDoc(doc(db, 'workspaces', FIRESTORE_WORKSPACE_ID), {
      ...buildSettingsPayload(settings, safeUid),
      seeded: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, wsPath);
  }
  await createHistoryEntryFirestore(historyEntry, safeUid);
}

export async function replaceWorkspaceDataFirestore(
  state: AppState,
  uid: string,
  historyEntry?: HistoryEntry
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const safeUid = clampStr(uid, 128) || 'anon';
  const wsPath = `workspaces/${FIRESTORE_WORKSPACE_ID}`;
  const txCol = `${wsPath}/transactions`;
  const empCol = `${wsPath}/employees`;

  try {
    const [existingTx, existingEmp] = await Promise.all([
      getDocs(query(collection(db, txCol), where('workspaceId', '==', FIRESTORE_WORKSPACE_ID))),
      getDocs(query(collection(db, empCol), where('workspaceId', '==', FIRESTORE_WORKSPACE_ID))),
    ]);

    const nextTxIds = new Set(state.transactions.map((t) => sanitizeFirestoreId(t.id)));
    const nextEmpIds = new Set(state.masterEmployees.map((e) => sanitizeFirestoreId(e.id)));

    for (const d of existingTx.docs) {
      if (!nextTxIds.has(d.id)) {
        await deleteDoc(d.ref);
      }
    }
    for (const d of existingEmp.docs) {
      if (!nextEmpIds.has(d.id)) {
        await deleteDoc(d.ref);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, wsPath);
  }

  await updateWorkspaceSettingsFirestore(
    {
      officials: state.officials,
      customMainTitle: state.customMainTitle,
      customActivityTitle: state.customActivityTitle,
      currentMonth: state.currentMonth,
      currentCategory: state.currentCategory,
    },
    safeUid
  );

  await batchCreateTransactionsFirestore(state.transactions, safeUid);
  for (const emp of state.masterEmployees) {
    await upsertEmployeeFirestore(emp, safeUid);
  }
  await createHistoryEntryFirestore(historyEntry, safeUid);
}

export async function syncPendingMutationsFirestore(
  payload: {
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
  },
  uid: string
): Promise<void> {
  await ensureWorkspaceSeededFirestore(uid);
  const safeUid = clampStr(uid, 128) || 'anon';

  if (payload.settings) {
    await updateWorkspaceSettingsFirestore(payload.settings, safeUid);
  }
  if (payload.deleteTxIds?.length) {
    for (const id of payload.deleteTxIds) {
      await deleteTransactionFirestore(id, safeUid);
    }
  }
  if (payload.upsertTransactions?.length) {
    await batchCreateTransactionsFirestore(payload.upsertTransactions, safeUid);
  }
  if (payload.deleteEmpIds?.length) {
    for (const id of payload.deleteEmpIds) {
      await deleteEmployeeFirestore(id, safeUid);
    }
  }
  if (payload.upsertEmployees?.length) {
    for (const emp of payload.upsertEmployees) {
      await upsertEmployeeFirestore(emp, safeUid);
    }
  }
  if (payload.historyEntries?.length) {
    for (const entry of payload.historyEntries) {
      await createHistoryEntryFirestore(entry, safeUid);
    }
  }
}

export async function seedFirestoreFromSnapshotIfMissing(
  state: AppState,
  uid: string
): Promise<void> {
  const wsRef = doc(db, 'workspaces', FIRESTORE_WORKSPACE_ID);
  const wsSnap = await getDoc(wsRef);
  if (wsSnap.exists()) {
    return;
  }
  await replaceWorkspaceDataFirestore(state, uid);
}

export function subscribeWorkspaceFirestore(
  onUpdate: () => void
): () => void {
  const wsRef = doc(db, 'workspaces', FIRESTORE_WORKSPACE_ID);
  const txQ = query(
    collection(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/transactions`),
    where('workspaceId', '==', FIRESTORE_WORKSPACE_ID)
  );
  const empQ = query(
    collection(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/employees`),
    where('workspaceId', '==', FIRESTORE_WORKSPACE_ID)
  );
  const histQ = query(
    collection(db, `workspaces/${FIRESTORE_WORKSPACE_ID}/history`),
    where('workspaceId', '==', FIRESTORE_WORKSPACE_ID)
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onUpdate();
    }, 250);
  };

  const unsubWs = onSnapshot(
    wsRef,
    () => trigger(),
    (err) => {
      console.warn('Firestore workspace listener error:', err);
    }
  );
  const unsubTx = onSnapshot(
    txQ,
    () => trigger(),
    (err) => {
      console.warn('Firestore tx listener error:', err);
    }
  );
  const unsubEmp = onSnapshot(
    empQ,
    () => trigger(),
    (err) => {
      console.warn('Firestore emp listener error:', err);
    }
  );
  const unsubHist = onSnapshot(
    histQ,
    () => trigger(),
    (err) => {
      console.warn('Firestore hist listener error:', err);
    }
  );

  return () => {
    if (timer) clearTimeout(timer);
    unsubWs();
    unsubTx();
    unsubEmp();
    unsubHist();
  };
}
