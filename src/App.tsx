import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FirebaseError } from 'firebase/app';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  DocumentData,
  DocumentReference,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  ExternalLink,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  History,
  LogIn,
  LogOut,
  Printer,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { ConfirmModal } from './components/ConfirmModal';
import {
  DaftarHadirSheet,
  RekapSheet,
  ResponsiveSheetFrame,
  TandaTerimaSheet,
} from './components/DocumentSheets';
import { MasterView } from './components/MasterView';
import { PrintModal } from './components/PrintModal';
import { TransactionForm } from './components/TransactionForm';
import { TransactionsList } from './components/TransactionsList';
import {
  DEFAULT_APP_STATE,
  DEFAULT_CUSTOM_ACTIVITY_TITLE,
  DEFAULT_CUSTOM_MAIN_TITLE,
  DEFAULT_MASTER_EMPLOYEES,
  DEFAULT_OFFICIALS,
  MONTHS,
  MONTH_ROMAN,
} from './data/seedData';
import {
  OperationType,
  auth,
  authPersistenceReady,
  db,
  googleProvider,
  handleFirestoreError,
  testConnection,
} from './firebase';
import {
  AppState,
  CategoryType,
  HistoryEntry,
  MasterEmployee,
  Officials,
  PrintJobMeta,
  TabType,
  Transaction,
} from './types';
import { clampStr, sanitizeFirestoreId } from './utils/formatters';
import {
  EMPTY_PENDING_MUTATIONS,
  PendingCloudMutations,
  PersistedEnvelope,
  hasAnyPendingMutation,
  loadInitialEnvelope,
  normalizeAppState,
  readIndexedDbEnvelope,
  saveEnvelopeSync,
  writeIndexedDbEnvelope,
} from './utils/localPersistence';
import { downloadExcelReport, downloadWordReport } from './utils/officeGenerator';

function sanitizeCategory(cat: unknown): CategoryType {
  return cat === 'ekskul' || cat === 'gurutamu' || cat === 'lainnya' ? cat : 'ekskul';
}

function safeFiniteNumber(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function buildTxPayload(tx: Transaction, uid: string, isCreate: boolean) {
  const base = {
    category: sanitizeCategory(tx.category),
    bulan: clampStr(tx.bulan || 'November', 30) || 'November',
    noBukti: clampStr(tx.noBukti || 'REG/001/2026', 80) || 'REG/001/2026',
    tanggal: clampStr(tx.tanggal || '1 November 2026', 60) || '1 November 2026',
    nama: clampStr(tx.nama || '-', 120) || '-',
    jenjang: clampStr(tx.jenjang || 'SRMP', 40) || 'SRMP',
    jenis: clampStr(tx.jenis || '-', 100) || '-',
    status: clampStr(tx.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(tx.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: safeFiniteNumber(tx.tarif, 0, 0, 100000000),
    jamlat: Math.round(safeFiniteNumber(tx.jamlat, 1, 1, 1000)),
    pajakRate: safeFiniteNumber(tx.pajakRate, 0, 0, 1),
    customRangka: clampStr(tx.customRangka ?? '', 250),
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    return {
      ...base,
      ownerId: uid,
      createdAt: serverTimestamp(),
    };
  }
  return base;
}

function buildEmployeePayload(emp: MasterEmployee, uid: string, isCreate: boolean) {
  const base = {
    category: sanitizeCategory(emp.category),
    nama: clampStr(emp.nama || '-', 120) || '-',
    jenis: clampStr(emp.jenis || '-', 100) || '-',
    jenjang: clampStr(emp.jenjang || 'SRMP', 40) || 'SRMP',
    status: clampStr(emp.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(emp.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: safeFiniteNumber(emp.tarif, 0, 0, 100000000),
    pajakRate: safeFiniteNumber(emp.pajakRate, 0, 0, 1),
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    return {
      ...base,
      ownerId: uid,
      createdAt: serverTimestamp(),
    };
  }
  return base;
}

function buildSettingsPayload(state: AppState, uid: string, isCreate: boolean) {
  const base = {
    ppkName: clampStr(state.officials.ppkName, 120),
    ppkNip: clampStr(state.officials.ppkNip, 60),
    bendName: clampStr(state.officials.bendName, 120),
    bendNip: clampStr(state.officials.bendNip, 60),
    kepsekName: clampStr(state.officials.kepsekName, 120),
    kepsekNip: clampStr(state.officials.kepsekNip, 60),
    customMainTitle: clampStr(state.customMainTitle, 200),
    customActivityTitle: clampStr(state.customActivityTitle, 250),
    currentMonth: clampStr(state.currentMonth || 'November', 30) || 'November',
    currentCategory: sanitizeCategory(state.currentCategory),
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    return {
      ...base,
      ownerId: uid,
    };
  }
  return base;
}

function buildHistoryPayload(entry: HistoryEntry, uid: string) {
  return {
    ownerId: uid,
    action: clampStr(entry.action || 'Aktivitas', 80) || 'Aktivitas',
    detail: clampStr(entry.detail ?? '', 300),
    timestamp: safeFiniteNumber(entry.timestamp, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    createdAt: serverTimestamp(),
  };
}

function mergeRemoteTransactions(
  remoteTx: Transaction[],
  prevTx: Transaction[],
  pending: PendingCloudMutations
): Transaction[] {
  const dirtySet = new Set(pending.dirtyTxIds.map(sanitizeFirestoreId));
  const deletedSet = new Set(pending.deletedTxIds.map(sanitizeFirestoreId));
  if (dirtySet.size === 0 && deletedSet.size === 0) {
    return remoteTx;
  }
  const prevMap = new Map(prevTx.map((t) => [sanitizeFirestoreId(t.id), t]));
  const merged = new Map<string, Transaction>();
  remoteTx.forEach((tx) => {
    const sid = sanitizeFirestoreId(tx.id);
    if (deletedSet.has(sid)) return;
    if (dirtySet.has(sid) && prevMap.has(sid)) {
      merged.set(sid, prevMap.get(sid)!);
    } else {
      merged.set(sid, tx);
    }
  });
  prevTx.forEach((tx) => {
    const sid = sanitizeFirestoreId(tx.id);
    if (dirtySet.has(sid) && !deletedSet.has(sid) && !merged.has(sid)) {
      merged.set(sid, tx);
    }
  });
  return Array.from(merged.values());
}

function mergeRemoteEmployees(
  remoteEmp: MasterEmployee[],
  prevEmp: MasterEmployee[],
  pending: PendingCloudMutations
): MasterEmployee[] {
  const dirtySet = new Set(pending.dirtyEmpIds.map(sanitizeFirestoreId));
  const deletedSet = new Set(pending.deletedEmpIds.map(sanitizeFirestoreId));
  if (dirtySet.size === 0 && deletedSet.size === 0) {
    return remoteEmp;
  }
  const prevMap = new Map(prevEmp.map((e) => [sanitizeFirestoreId(e.id), e]));
  const merged = new Map<string, MasterEmployee>();
  remoteEmp.forEach((emp) => {
    const sid = sanitizeFirestoreId(emp.id);
    if (deletedSet.has(sid)) return;
    if (dirtySet.has(sid) && prevMap.has(sid)) {
      merged.set(sid, prevMap.get(sid)!);
    } else {
      merged.set(sid, emp);
    }
  });
  prevEmp.forEach((emp) => {
    const sid = sanitizeFirestoreId(emp.id);
    if (dirtySet.has(sid) && !deletedSet.has(sid) && !merged.has(sid)) {
      merged.set(sid, emp);
    }
  });
  return Array.from(merged.values());
}

function mergeHistoryLists(
  remoteHist: HistoryEntry[],
  prevHist: HistoryEntry[],
  dirtyHistIds: string[]
): HistoryEntry[] {
  const dirtySet = new Set(dirtyHistIds.map(sanitizeFirestoreId));
  const merged = new Map<string, HistoryEntry>();
  remoteHist.forEach((h) => {
    merged.set(sanitizeFirestoreId(h.id), h);
  });
  prevHist.forEach((h) => {
    const sid = sanitizeFirestoreId(h.id);
    if (dirtySet.has(sid) && !merged.has(sid)) {
      merged.set(sid, h);
    }
  });
  return Array.from(merged.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

function logAndCaptureFirestoreError(error: unknown, op: OperationType, path: string | null): void {
  try {
    handleFirestoreError(error, op, path);
  } catch {
    // Error sudah dicatat ke console dalam format FirestoreErrorInfo
  }
}

type BatchOp =
  | { kind: 'set'; ref: DocumentReference<DocumentData>; data: DocumentData }
  | { kind: 'update'; ref: DocumentReference<DocumentData>; data: DocumentData }
  | { kind: 'delete'; ref: DocumentReference<DocumentData> };

async function commitBatchChunks(ops: BatchOp[]): Promise<void> {
  const CHUNK_SIZE = 350;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((op) => {
      if (op.kind === 'set') batch.set(op.ref, op.data);
      else if (op.kind === 'update') batch.update(op.ref, op.data);
      else batch.delete(op.ref);
    });
    await batch.commit();
  }
}

async function upsertDocSafe(
  ref: DocumentReference<DocumentData>,
  createData: DocumentData,
  updateData: DocumentData,
  knownExists: boolean
): Promise<void> {
  if (knownExists) {
    try {
      await updateDoc(ref, updateData);
      return;
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : '';
      if (code === 'not-found' || (err instanceof Error && err.message.includes('No document to update'))) {
        await setDoc(ref, createData);
        return;
      }
      throw err;
    }
  } else {
    try {
      await setDoc(ref, createData);
      return;
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : '';
      if (code === 'permission-denied') {
        const snap = await getDocFromServer(ref).catch(() => getDoc(ref));
        if (snap.exists()) {
          await updateDoc(ref, updateData);
          return;
        }
      }
      throw err;
    }
  }
}

function formatFirebaseAuthError(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : '';
  if (code === 'auth/popup-blocked') {
    return 'Pop-up login Google diblokir oleh browser di komputer ini. Izinkan pop-up di bilah alamat browser lalu klik Masuk Google lagi.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Jendela login Google ditutup sebelum selesai. Klik Sinkron Cloud untuk mencoba lagi.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Domain URL ini belum terdaftar untuk login Google pada proyek Firebase.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Koneksi internet bermasalah saat mencoba login Google. Periksa jaringan komputer ini.';
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return 'Browser atau mode iframe ini membatasi login pop-up. Coba buka aplikasi di tab baru penuh.';
  }
  return 'Login Google gagal di browser ini. Periksa izin pop-up dan koneksi internet lalu coba lagi.';
}

export default function App() {
  const initialBoot = useMemo(() => loadInitialEnvelope(), []);

  const [appState, setAppState] = useState<AppState>(initialBoot.envelope.state);
  const [activeTab, setActiveTab] = useState<TabType>(initialBoot.envelope.activeTab);
  const [historyLog, setHistoryLog] = useState<HistoryEntry[]>(initialBoot.envelope.historyLog);
  const [hasUnsyncedLocal, setHasUnsyncedLocal] = useState<boolean>(
    initialBoot.envelope.hasUnsyncedLocalChanges
  );
  const [pendingMutations, setPendingMutations] = useState<PendingCloudMutations>(
    initialBoot.envelope.pendingMutations
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(initialBoot.envelope.updatedAt);

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [dhFilterId, setDhFilterId] = useState<string>('ALL');
  const [ttFilterId, setTtFilterId] = useState<string>('ALL');

  const [printJob, setPrintJob] = useState<PrintJobMeta | null>(null);
  const [lastPrintSnapshot, setLastPrintSnapshot] = useState<PrintJobMeta | null>(null);
  const [toastMsg, setToastMsg] = useState<string>('');
  const [busyExport, setBusyExport] = useState<string | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced' | 'offline'>('local');
  const [syncErrorMsg, setSyncErrorMsg] = useState<string>('');
  const [idbReady, setIdbReady] = useState(false);
  const [idbWritable, setIdbWritable] = useState<boolean | null>(null);

  const envelopeRef = useRef<PersistedEnvelope>(initialBoot.envelope);
  const ensuredUidRef = useRef<string | null>(null);
  const cloudTxIdsRef = useRef<Set<string>>(new Set());
  const cloudEmpIdsRef = useRef<Set<string>>(new Set());
  const cloudHistoryIdsRef = useRef<Set<string>>(new Set());
  const cloudConfigExistsRef = useRef<boolean>(false);
  const hasUserChangedFilterRef = useRef<boolean>(false);
  const appliedInitialCloudSettingsRef = useRef<boolean>(false);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Ya, Hapus',
    onConfirm: () => {},
  });

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(''), 3800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Hydrate from IndexedDB on startup if IndexedDB has a newer snapshot than localStorage/sessionStorage/window.name
  useEffect(() => {
    let active = true;
    readIndexedDbEnvelope().then((idbEnv) => {
      if (!active) return;
      if (idbEnv && idbEnv.updatedAt > envelopeRef.current.updatedAt) {
        envelopeRef.current = idbEnv;
        setAppState(idbEnv.state);
        setActiveTab(idbEnv.activeTab);
        setHistoryLog(idbEnv.historyLog);
        setHasUnsyncedLocal(idbEnv.hasUnsyncedLocalChanges);
        setPendingMutations(idbEnv.pendingMutations);
        setLastUpdatedAt(idbEnv.updatedAt);
        saveEnvelopeSync(idbEnv);
      }
      setIdbReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Multi-layer instant auto-save whenever state, activeTab, historyLog, or pendingMutations change
  const persistEnvelope = useCallback(
    (
      nextState: AppState,
      nextTab: TabType,
      nextHistory: HistoryEntry[],
      unsynced: boolean,
      nextPending: PendingCloudMutations,
      stamp = Date.now()
    ) => {
      const env: PersistedEnvelope = {
        state: nextState,
        activeTab: nextTab,
        historyLog: nextHistory,
        hasUnsyncedLocalChanges: unsynced || hasAnyPendingMutation(nextPending),
        pendingMutations: nextPending,
        updatedAt: stamp,
      };
      envelopeRef.current = env;
      setLastUpdatedAt(stamp);
      saveEnvelopeSync(env);
      void writeIndexedDbEnvelope(env).then((ok) => {
        setIdbWritable(ok);
      });
    },
    []
  );

  useEffect(() => {
    if (!idbReady) return;
    const stamp = lastUpdatedAt || Date.now();
    persistEnvelope(appState, activeTab, historyLog, hasUnsyncedLocal, pendingMutations, stamp);
  }, [
    appState,
    activeTab,
    historyLog,
    hasUnsyncedLocal,
    pendingMutations,
    idbReady,
    lastUpdatedAt,
    persistEnvelope,
  ]);

  // Flush synchronously when page hides or unloads
  useEffect(() => {
    const flush = () => {
      saveEnvelopeSync(envelopeRef.current);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  const appendHistory = useCallback(
    (action: string, detail: string): { nextHistory: HistoryEntry[]; newEntry: HistoryEntry } => {
      const newEntry: HistoryEntry = {
        id: sanitizeFirestoreId(`hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        timestamp: Date.now(),
        action,
        detail,
      };
      const nextHistory = [newEntry, ...envelopeRef.current.historyLog].slice(0, 50);
      setHistoryLog(nextHistory);
      return { nextHistory, newEntry };
    },
    []
  );

  // Verify Firestore connection on startup
  useEffect(() => {
    testConnection().then((ok) => {
      if (!ok) setSyncState('offline');
    });
  }, []);

  const ensureUserProfile = useCallback(async (u: User): Promise<boolean> => {
    if (ensuredUidRef.current === u.uid) return true;
    const userRef = doc(db, 'users', u.uid);
    const createPayload = {
      uid: u.uid,
      email: clampStr(u.email || '', 200),
      displayName: clampStr(u.displayName || 'Admin SRT 39', 150),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const updatePayload = {
      email: clampStr(u.email || '', 200),
      displayName: clampStr(u.displayName || 'Admin SRT 39', 150),
      updatedAt: serverTimestamp(),
    };
    try {
      const snap = await getDocFromServer(userRef).catch(() => getDoc(userRef));
      if (!snap.exists()) {
        await upsertDocSafe(userRef, createPayload, updatePayload, false);
      } else {
        await upsertDocSafe(userRef, createPayload, updatePayload, true);
      }
      ensuredUidRef.current = u.uid;
      return true;
    } catch (error) {
      logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
      return false;
    }
  }, []);

  const buildOpsForPendingMutations = useCallback(
    (
      uid: string,
      state: AppState,
      historyLogList: HistoryEntry[],
      pending: PendingCloudMutations,
      existingTxIds: Set<string>,
      existingEmpIds: Set<string>,
      existingHistoryIds: Set<string>,
      configExists: boolean
    ): BatchOp[] => {
      const ops: BatchOp[] = [];
      const txMap = new Map(state.transactions.map((t) => [sanitizeFirestoreId(t.id), t]));
      const empMap = new Map(state.masterEmployees.map((e) => [sanitizeFirestoreId(e.id), e]));
      const histMap = new Map(historyLogList.map((h) => [sanitizeFirestoreId(h.id), h]));

      const dirtyTxSet = new Set(pending.dirtyTxIds.map(sanitizeFirestoreId));
      const deletedTxSet = new Set(pending.deletedTxIds.map(sanitizeFirestoreId));
      dirtyTxSet.forEach((sid) => {
        if (deletedTxSet.has(sid)) return;
        const tx = txMap.get(sid);
        if (!tx) return;
        const ref = doc(db, 'users', uid, 'transactions', sid);
        if (existingTxIds.has(sid)) {
          ops.push({ kind: 'update', ref, data: buildTxPayload(tx, uid, false) });
        } else {
          ops.push({ kind: 'set', ref, data: buildTxPayload(tx, uid, true) });
          existingTxIds.add(sid);
        }
      });
      deletedTxSet.forEach((sid) => {
        if (!existingTxIds.has(sid) && !dirtyTxSet.has(sid)) return;
        ops.push({ kind: 'delete', ref: doc(db, 'users', uid, 'transactions', sid) });
        existingTxIds.delete(sid);
      });

      const dirtyEmpSet = new Set(pending.dirtyEmpIds.map(sanitizeFirestoreId));
      const deletedEmpSet = new Set(pending.deletedEmpIds.map(sanitizeFirestoreId));
      dirtyEmpSet.forEach((sid) => {
        if (deletedEmpSet.has(sid)) return;
        const emp = empMap.get(sid);
        if (!emp) return;
        const ref = doc(db, 'users', uid, 'employees', sid);
        if (existingEmpIds.has(sid)) {
          ops.push({ kind: 'update', ref, data: buildEmployeePayload(emp, uid, false) });
        } else {
          ops.push({ kind: 'set', ref, data: buildEmployeePayload(emp, uid, true) });
          existingEmpIds.add(sid);
        }
      });
      deletedEmpSet.forEach((sid) => {
        if (!existingEmpIds.has(sid) && !dirtyEmpSet.has(sid)) return;
        ops.push({ kind: 'delete', ref: doc(db, 'users', uid, 'employees', sid) });
        existingEmpIds.delete(sid);
      });

      const dirtyHistSet = new Set(pending.dirtyHistoryIds.map(sanitizeFirestoreId));
      dirtyHistSet.forEach((sid) => {
        if (existingHistoryIds.has(sid)) return;
        const entry = histMap.get(sid);
        if (!entry) return;
        ops.push({
          kind: 'set',
          ref: doc(db, 'users', uid, 'history', sid),
          data: buildHistoryPayload(entry, uid),
        });
        existingHistoryIds.add(sid);
      });

      if (pending.dirtySettings) {
        const cfgRef = doc(db, 'users', uid, 'settings', 'config');
        if (configExists) {
          ops.push({ kind: 'update', ref: cfgRef, data: buildSettingsPayload(state, uid, false) });
        } else {
          ops.push({ kind: 'set', ref: cfgRef, data: buildSettingsPayload(state, uid, true) });
        }
      }

      return ops;
    },
    []
  );

  const flushPendingMutations = useCallback(
    async (targetUser?: User | null): Promise<boolean> => {
      const u = targetUser ?? user;
      if (!u || !u.emailVerified) return false;
      const currentEnv = envelopeRef.current;
      if (!hasAnyPendingMutation(currentEnv.pendingMutations)) {
        setHasUnsyncedLocal(false);
        setSyncErrorMsg('');
        setSyncState('synced');
        return true;
      }

      setSyncState('syncing');
      try {
        const ok = await ensureUserProfile(u);
        if (!ok) {
          setSyncState('offline');
          setSyncErrorMsg('Profil pengguna Cloud gagal dibuat. Coba sinkronkan ulang.');
          return false;
        }
        const txCol = collection(db, 'users', u.uid, 'transactions');
        const empCol = collection(db, 'users', u.uid, 'employees');
        const histCol = collection(db, 'users', u.uid, 'history');
        const cfgRef = doc(db, 'users', u.uid, 'settings', 'config');
        const txQuery = query(txCol, where('ownerId', '==', u.uid));
        const empQuery = query(empCol, where('ownerId', '==', u.uid));
        const histQuery = query(histCol, where('ownerId', '==', u.uid));
        const [txSnap, empSnap, histSnap, cfgSnap] = await Promise.all([
          getDocsFromServer(txQuery).catch(() => getDocs(txQuery)),
          getDocsFromServer(empQuery).catch(() => getDocs(empQuery)),
          getDocsFromServer(histQuery).catch(() => getDocs(histQuery)),
          getDocFromServer(cfgRef).catch(() => getDoc(cfgRef)),
        ]);

        const existingTxIds = new Set(txSnap.docs.map((d) => d.id));
        const existingEmpIds = new Set(empSnap.docs.map((d) => d.id));
        const existingHistoryIds = new Set(histSnap.docs.map((d) => d.id));
        cloudTxIdsRef.current = existingTxIds;
        cloudEmpIdsRef.current = existingEmpIds;
        cloudHistoryIdsRef.current = existingHistoryIds;
        cloudConfigExistsRef.current = cfgSnap.exists();

        const ops = buildOpsForPendingMutations(
          u.uid,
          currentEnv.state,
          currentEnv.historyLog,
          currentEnv.pendingMutations,
          existingTxIds,
          existingEmpIds,
          existingHistoryIds,
          cfgSnap.exists()
        );
        if (ops.length > 0) {
          await commitBatchChunks(ops);
        }
        if (currentEnv.pendingMutations.dirtySettings) {
          cloudConfigExistsRef.current = true;
        }
        const cleared: PendingCloudMutations = { ...EMPTY_PENDING_MUTATIONS };
        setPendingMutations(cleared);
        setHasUnsyncedLocal(false);
        setSyncErrorMsg('');
        setSyncState('synced');
        persistEnvelope(
          envelopeRef.current.state,
          envelopeRef.current.activeTab,
          envelopeRef.current.historyLog,
          false,
          cleared
        );
        return true;
      } catch (error) {
        setSyncState('offline');
        setSyncErrorMsg('Sebagian perubahan belum tersinkron ke Cloud. Periksa koneksi lalu coba lagi.');
        logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
        return false;
      }
    },
    [user, ensureUserProfile, buildOpsForPendingMutations, persistEnvelope]
  );

  // Auto-retry pending Cloud mutations when browser reconnects
  useEffect(() => {
    const handleOnline = () => {
      if (user && user.emailVerified && hasAnyPendingMutation(envelopeRef.current.pendingMutations)) {
        void flushPendingMutations(user);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user, flushPendingMutations]);

  const syncSettingsToCloud = useCallback(
    async (nextState: AppState, markDirtyOnFail = true, newHistoryEntry?: HistoryEntry) => {
      if (!user || !user.emailVerified) return;
      setSyncState('syncing');
      try {
        const ok = await ensureUserProfile(user);
        if (!ok) {
          throw new Error('Gagal memverifikasi profil akun Cloud');
        }
        const configRef = doc(db, 'users', user.uid, 'settings', 'config');
        await upsertDocSafe(
          configRef,
          buildSettingsPayload(nextState, user.uid, true),
          buildSettingsPayload(nextState, user.uid, false),
          cloudConfigExistsRef.current
        );
        cloudConfigExistsRef.current = true;
        if (newHistoryEntry) {
          const histSid = sanitizeFirestoreId(newHistoryEntry.id);
          if (!cloudHistoryIdsRef.current.has(histSid)) {
            await setDoc(
              doc(db, 'users', user.uid, 'history', histSid),
              buildHistoryPayload(newHistoryEntry, user.uid)
            );
            cloudHistoryIdsRef.current.add(histSid);
          }
        }
        const nextPending: PendingCloudMutations = {
          ...envelopeRef.current.pendingMutations,
          dirtySettings: false,
          dirtyHistoryIds: newHistoryEntry
            ? envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
                (id) => id !== newHistoryEntry.id
              )
            : envelopeRef.current.pendingMutations.dirtyHistoryIds,
        };
        const stillPending = hasAnyPendingMutation(nextPending);
        setPendingMutations(nextPending);
        setHasUnsyncedLocal(stillPending);
        setSyncErrorMsg('');
        setSyncState('synced');
        persistEnvelope(
          envelopeRef.current.state,
          envelopeRef.current.activeTab,
          envelopeRef.current.historyLog,
          stillPending,
          nextPending
        );
      } catch (error) {
        if (markDirtyOnFail) {
          const nextPending: PendingCloudMutations = {
            ...envelopeRef.current.pendingMutations,
            dirtySettings: true,
            dirtyHistoryIds: newHistoryEntry
              ? Array.from(
                  new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newHistoryEntry.id])
                )
              : envelopeRef.current.pendingMutations.dirtyHistoryIds,
          };
          setPendingMutations(nextPending);
          setHasUnsyncedLocal(true);
          persistEnvelope(
            envelopeRef.current.state,
            envelopeRef.current.activeTab,
            envelopeRef.current.historyLog,
            true,
            nextPending
          );
        }
        setSyncState('offline');
        setSyncErrorMsg('Pengaturan belum tersinkron ke Cloud. Klik Sinkronkan Ulang saat terhubung.');
        logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${user.uid}/settings/config`);
      }
    },
    [user, ensureUserProfile, persistEnvelope]
  );

  // Firebase Auth & Real-time Firestore Subscriptions
  useEffect(() => {
    let unsubTx: (() => void) | null = null;
    let unsubEmp: (() => void) | null = null;
    let unsubHistory: (() => void) | null = null;
    let unsubSettings: (() => void) | null = null;
    let unsubAuth: (() => void) | null = null;
    let mounted = true;

    void authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
        if (unsubTx) unsubTx();
        if (unsubEmp) unsubEmp();
        if (unsubHistory) unsubHistory();
        if (unsubSettings) unsubSettings();
        unsubTx = null;
        unsubEmp = null;
        unsubHistory = null;
        unsubSettings = null;
        ensuredUidRef.current = null;
        cloudTxIdsRef.current.clear();
        cloudEmpIdsRef.current.clear();
        cloudHistoryIdsRef.current.clear();
        cloudConfigExistsRef.current = false;
        appliedInitialCloudSettingsRef.current = false;

        setUser(currentUser);
        setAuthReady(true);

        if (!currentUser) {
          setSyncState('local');
          setSyncErrorMsg('');
          return;
        }

        if (!currentUser.emailVerified) {
          setSyncState('local');
          setSyncErrorMsg('Email akun Google belum terverifikasi sehingga sinkron Cloud belum aktif.');
          return;
        }

        setSyncState('syncing');
        setSyncErrorMsg('');
        const txCol = collection(db, 'users', currentUser.uid, 'transactions');
        const empCol = collection(db, 'users', currentUser.uid, 'employees');
        const histCol = collection(db, 'users', currentUser.uid, 'history');
        const txQuery = query(txCol, where('ownerId', '==', currentUser.uid));
        const empQuery = query(empCol, where('ownerId', '==', currentUser.uid));
        const histQuery = query(histCol, where('ownerId', '==', currentUser.uid));
        const configRef = doc(db, 'users', currentUser.uid, 'settings', 'config');

        try {
          const profileOk = await ensureUserProfile(currentUser);
          if (!profileOk) {
            setSyncState('offline');
            setSyncErrorMsg('Gagal mengakses profil Cloud. Periksa koneksi lalu klik Sinkronkan Ulang.');
            return;
          }

          const [txSnap, empSnap, histSnap, cfgSnap] = await Promise.all([
            getDocsFromServer(txQuery).catch(() => getDocs(txQuery)),
            getDocsFromServer(empQuery).catch(() => getDocs(empQuery)),
            getDocsFromServer(histQuery).catch(() => getDocs(histQuery)),
            getDocFromServer(configRef).catch(() => getDoc(configRef)),
          ]);

          const existingTxIds = new Set(txSnap.docs.map((d) => d.id));
          const existingEmpIds = new Set(empSnap.docs.map((d) => d.id));
          const existingHistoryIds = new Set(histSnap.docs.map((d) => d.id));
          cloudTxIdsRef.current = existingTxIds;
          cloudEmpIdsRef.current = existingEmpIds;
          cloudHistoryIdsRef.current = existingHistoryIds;
          cloudConfigExistsRef.current = cfgSnap.exists();

          const localEnv = envelopeRef.current;
          const cloudIsEmpty = txSnap.empty && empSnap.empty && !cfgSnap.exists();

          try {
            if (cloudIsEmpty) {
              const ops: BatchOp[] = [];
              localEnv.state.transactions.forEach((tx) => {
                const sid = sanitizeFirestoreId(tx.id);
                ops.push({
                  kind: 'set',
                  ref: doc(db, 'users', currentUser.uid, 'transactions', sid),
                  data: buildTxPayload(tx, currentUser.uid, true),
                });
                existingTxIds.add(sid);
              });
              localEnv.state.masterEmployees.forEach((emp) => {
                const sid = sanitizeFirestoreId(emp.id);
                ops.push({
                  kind: 'set',
                  ref: doc(db, 'users', currentUser.uid, 'employees', sid),
                  data: buildEmployeePayload(emp, currentUser.uid, true),
                });
                existingEmpIds.add(sid);
              });
              localEnv.historyLog.forEach((entry) => {
                const sid = sanitizeFirestoreId(entry.id);
                if (existingHistoryIds.has(sid)) return;
                ops.push({
                  kind: 'set',
                  ref: doc(db, 'users', currentUser.uid, 'history', sid),
                  data: buildHistoryPayload(entry, currentUser.uid),
                });
                existingHistoryIds.add(sid);
              });
              ops.push({
                kind: 'set',
                ref: configRef,
                data: buildSettingsPayload(localEnv.state, currentUser.uid, true),
              });
              cloudConfigExistsRef.current = true;
              await commitBatchChunks(ops);
              const cleared = { ...EMPTY_PENDING_MUTATIONS };
              setPendingMutations(cleared);
              setHasUnsyncedLocal(false);
              persistEnvelope(localEnv.state, localEnv.activeTab, localEnv.historyLog, false, cleared);
            } else {
              const effectivePending: PendingCloudMutations =
                histSnap.empty && localEnv.historyLog.length > 0
                  ? {
                      ...localEnv.pendingMutations,
                      dirtyHistoryIds: Array.from(
                        new Set([
                          ...localEnv.pendingMutations.dirtyHistoryIds,
                          ...localEnv.historyLog.map((h) => sanitizeFirestoreId(h.id)),
                        ])
                      ),
                    }
                  : localEnv.pendingMutations;

              if (hasAnyPendingMutation(effectivePending)) {
                const ops = buildOpsForPendingMutations(
                  currentUser.uid,
                  localEnv.state,
                  localEnv.historyLog,
                  effectivePending,
                  existingTxIds,
                  existingEmpIds,
                  existingHistoryIds,
                  cfgSnap.exists()
                );
                if (ops.length > 0) {
                  await commitBatchChunks(ops);
                }
                if (effectivePending.dirtySettings) {
                  cloudConfigExistsRef.current = true;
                }
                const cleared = { ...EMPTY_PENDING_MUTATIONS };
                setPendingMutations(cleared);
                setHasUnsyncedLocal(false);
                persistEnvelope(localEnv.state, localEnv.activeTab, localEnv.historyLog, false, cleared);
              }
            }
          } catch (mergeErr) {
            setSyncState('offline');
            setSyncErrorMsg('Sinkronisasi awal tertunda. Klik Sinkronkan Ulang untuk mengirim perubahan.');
            logAndCaptureFirestoreError(mergeErr, OperationType.WRITE, `users/${currentUser.uid}`);
          }

          unsubTx = onSnapshot(
            txQuery,
            (snap) => {
              const nextIds = new Set<string>();
              const remoteTx: Transaction[] = snap.docs.map((d) => {
                nextIds.add(d.id);
                const data = d.data();
                return {
                  id: d.id,
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
                  customRangka: typeof data.customRangka === 'string' ? data.customRangka : '',
                };
              });
              cloudTxIdsRef.current = nextIds;
              setAppState((prev) => ({
                ...prev,
                transactions: mergeRemoteTransactions(
                  remoteTx,
                  prev.transactions,
                  envelopeRef.current.pendingMutations
                ),
              }));
              setLastUpdatedAt(Date.now());
              if (!hasAnyPendingMutation(envelopeRef.current.pendingMutations)) {
                setSyncState('synced');
              }
            },
            (error) => {
              setSyncState('offline');
              logAndCaptureFirestoreError(
                error,
                OperationType.LIST,
                `users/${currentUser.uid}/transactions`
              );
            }
          );

          unsubEmp = onSnapshot(
            empQuery,
            (snap) => {
              const nextIds = new Set<string>();
              const remoteEmp: MasterEmployee[] = snap.docs.map((d) => {
                nextIds.add(d.id);
                const data = d.data();
                return {
                  id: d.id,
                  category: sanitizeCategory(data.category),
                  nama: String(data.nama || ''),
                  jenis: String(data.jenis || ''),
                  jenjang: String(data.jenjang || 'SRMP'),
                  status: String(data.status || 'NON ASN'),
                  jabatan: String(data.jabatan || ''),
                  tarif: Number(data.tarif) || 0,
                  pajakRate: Number(data.pajakRate) || 0,
                };
              });
              cloudEmpIdsRef.current = nextIds;
              setAppState((prev) => ({
                ...prev,
                masterEmployees: mergeRemoteEmployees(
                  remoteEmp,
                  prev.masterEmployees,
                  envelopeRef.current.pendingMutations
                ),
              }));
              setLastUpdatedAt(Date.now());
              if (!hasAnyPendingMutation(envelopeRef.current.pendingMutations)) {
                setSyncState('synced');
              }
            },
            (error) => {
              setSyncState('offline');
              logAndCaptureFirestoreError(
                error,
                OperationType.LIST,
                `users/${currentUser.uid}/employees`
              );
            }
          );

          unsubHistory = onSnapshot(
            histQuery,
            (snap) => {
              const nextIds = new Set<string>();
              const remoteHist: HistoryEntry[] = snap.docs.map((d) => {
                nextIds.add(d.id);
                const data = d.data();
                return {
                  id: d.id,
                  timestamp: Number(data.timestamp) || Date.now(),
                  action: String(data.action || 'Aktivitas'),
                  detail: String(data.detail || ''),
                };
              });
              cloudHistoryIdsRef.current = nextIds;
              setHistoryLog((prev) =>
                mergeHistoryLists(
                  remoteHist,
                  prev,
                  envelopeRef.current.pendingMutations.dirtyHistoryIds
                )
              );
              setLastUpdatedAt(Date.now());
              if (!hasAnyPendingMutation(envelopeRef.current.pendingMutations)) {
                setSyncState('synced');
              }
            },
            (error) => {
              setSyncState('offline');
              logAndCaptureFirestoreError(
                error,
                OperationType.LIST,
                `users/${currentUser.uid}/history`
              );
            }
          );

          unsubSettings = onSnapshot(
            configRef,
            (snap) => {
              if (!snap.exists()) return;
              cloudConfigExistsRef.current = true;
              const d = snap.data();
              const shouldApplyFilterFromCloud =
                !appliedInitialCloudSettingsRef.current && !hasUserChangedFilterRef.current;
              if (shouldApplyFilterFromCloud) {
                appliedInitialCloudSettingsRef.current = true;
              }
              setAppState((prev) => {
                if (envelopeRef.current.pendingMutations.dirtySettings) {
                  return prev;
                }
                return {
                  ...prev,
                  officials: {
                    ppkName: String(d.ppkName || DEFAULT_OFFICIALS.ppkName),
                    ppkNip: String(d.ppkNip ?? DEFAULT_OFFICIALS.ppkNip),
                    bendName: String(d.bendName || DEFAULT_OFFICIALS.bendName),
                    bendNip: String(d.bendNip ?? DEFAULT_OFFICIALS.bendNip),
                    kepsekName: String(d.kepsekName || DEFAULT_OFFICIALS.kepsekName),
                    kepsekNip: String(d.kepsekNip ?? DEFAULT_OFFICIALS.kepsekNip),
                  },
                  customMainTitle: String(d.customMainTitle || DEFAULT_CUSTOM_MAIN_TITLE),
                  customActivityTitle: String(d.customActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE),
                  currentMonth: shouldApplyFilterFromCloud
                    ? String(d.currentMonth || prev.currentMonth)
                    : prev.currentMonth,
                  currentCategory: shouldApplyFilterFromCloud
                    ? d.currentCategory === 'ekskul' ||
                      d.currentCategory === 'gurutamu' ||
                      d.currentCategory === 'lainnya'
                      ? d.currentCategory
                      : prev.currentCategory
                    : prev.currentCategory,
                };
              });
              setLastUpdatedAt(Date.now());
              if (!hasAnyPendingMutation(envelopeRef.current.pendingMutations)) {
                setSyncState('synced');
              }
            },
            (error) => {
              setSyncState('offline');
              logAndCaptureFirestoreError(
                error,
                OperationType.GET,
                `users/${currentUser.uid}/settings/config`
              );
            }
          );
        } catch (error) {
          setSyncState('offline');
          setSyncErrorMsg('Koneksi ke database Cloud terganggu. Perubahan tetap disimpan di perangkat.');
          logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      });
    });

    return () => {
      mounted = false;
      if (unsubAuth) unsubAuth();
      if (unsubTx) unsubTx();
      if (unsubEmp) unsubEmp();
      if (unsubHistory) unsubHistory();
      if (unsubSettings) unsubSettings();
    };
  }, [ensureUserProfile, buildOpsForPendingMutations, persistEnvelope]);

  const handleGoogleSignIn = async (): Promise<void> => {
    setSyncErrorMsg('');
    try {
      await authPersistenceReady;
      await signInWithPopup(auth, googleProvider);
      showToast('Berhasil masuk dengan Google. Data disinkronkan ke Cloud.');
    } catch (err) {
      console.error('Login Google gagal:', err);
      const msg = formatFirebaseAuthError(err);
      setSyncErrorMsg(msg);
      showToast(msg);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut(auth);
      setSyncState('local');
      setSyncErrorMsg('');
      showToast('Keluar dari akun Cloud. Mode simpan perangkat aktif.');
    } catch (err) {
      console.error('Logout gagal:', err);
    }
  };

  const filteredTransactions = useMemo(() => {
    return appState.transactions.filter((t) => {
      const catMatch = t.category === appState.currentCategory;
      const monthMatch = appState.currentMonth === 'ALL' || t.bulan === appState.currentMonth;
      return catMatch && monthMatch;
    });
  }, [appState.transactions, appState.currentCategory, appState.currentMonth]);

  useEffect(() => {
    if (dhFilterId !== 'ALL' && !filteredTransactions.some((t) => t.id === dhFilterId)) {
      setDhFilterId('ALL');
    }
    if (ttFilterId !== 'ALL' && !filteredTransactions.some((t) => t.id === ttFilterId)) {
      setTtFilterId('ALL');
    }
  }, [filteredTransactions, dhFilterId, ttFilterId]);

  const handleTabChange = (tab: TabType): void => {
    setActiveTab(tab);
    const stamp = Date.now();
    persistEnvelope(appState, tab, historyLog, hasUnsyncedLocal, pendingMutations, stamp);
  };

  const handleCategoryChange = (cat: CategoryType): void => {
    hasUserChangedFilterRef.current = true;
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentCategory: cat };
    const stamp = Date.now();
    setAppState(nextState);
    persistEnvelope(nextState, activeTab, historyLog, hasUnsyncedLocal, pendingMutations, stamp);
    if (user && user.emailVerified) {
      void syncSettingsToCloud(nextState, false);
    }
  };

  const handleMonthChange = (month: string): void => {
    hasUserChangedFilterRef.current = true;
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentMonth: month };
    const stamp = Date.now();
    setAppState(nextState);
    persistEnvelope(nextState, activeTab, historyLog, hasUnsyncedLocal, pendingMutations, stamp);
    if (user && user.emailVerified) {
      void syncSettingsToCloud(nextState, false);
    }
  };

  const handleSubmitTx = async (tx: Transaction, isEdit: boolean): Promise<void> => {
    const safeId = sanitizeFirestoreId(tx.id);
    const normalizedTx: Transaction = { ...tx, id: safeId };

    const nextList = isEdit
      ? appState.transactions.map((item) => (item.id === normalizedTx.id ? normalizedTx : item))
      : [...appState.transactions, normalizedTx];
    const nextState: AppState = { ...appState, transactions: nextList };
    const { nextHistory, newEntry } = appendHistory(
      isEdit ? 'Edit SPJ' : 'Tambah SPJ',
      `${normalizedTx.nama} · ${normalizedTx.jenis} (${normalizedTx.bulan} 2026)`
    );
    const nextPending: PendingCloudMutations = {
      ...envelopeRef.current.pendingMutations,
      dirtyTxIds: Array.from(new Set([...envelopeRef.current.pendingMutations.dirtyTxIds, safeId])),
      deletedTxIds: envelopeRef.current.pendingMutations.deletedTxIds.filter((id) => id !== safeId),
      dirtyHistoryIds: Array.from(
        new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
      ),
    };
    const stamp = Date.now();

    setAppState(nextState);
    setPendingMutations(nextPending);
    setHasUnsyncedLocal(true);
    setEditingTx(null);
    persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, stamp);

    if (!user && !initialBoot.localStorageWritable && idbWritable === false) {
      showToast('Penyimpanan browser diblokir! Masuk Google (Sinkron Cloud) agar data tidak hilang.');
    } else {
      showToast(isEdit ? 'Perubahan SPJ tersimpan otomatis.' : 'Entri SPJ baru tersimpan otomatis.');
    }

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        const profileOk = await ensureUserProfile(user);
        if (!profileOk) {
          throw new Error('Profil pengguna Cloud tidak tersedia');
        }
        const txRef = doc(db, 'users', user.uid, 'transactions', safeId);
        await upsertDocSafe(
          txRef,
          buildTxPayload(normalizedTx, user.uid, true),
          buildTxPayload(normalizedTx, user.uid, false),
          cloudTxIdsRef.current.has(safeId)
        );
        cloudTxIdsRef.current.add(safeId);
        if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
          await setDoc(
            doc(db, 'users', user.uid, 'history', newEntry.id),
            buildHistoryPayload(newEntry, user.uid)
          );
          cloudHistoryIdsRef.current.add(newEntry.id);
        }
        const cleanedPending: PendingCloudMutations = {
          ...envelopeRef.current.pendingMutations,
          dirtyTxIds: envelopeRef.current.pendingMutations.dirtyTxIds.filter((id) => id !== safeId),
          dirtyHistoryIds: envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
            (id) => id !== newEntry.id
          ),
        };
        const stillPending = hasAnyPendingMutation(cleanedPending);
        setPendingMutations(cleanedPending);
        setHasUnsyncedLocal(stillPending);
        setSyncErrorMsg('');
        setSyncState('synced');
        persistEnvelope(
          envelopeRef.current.state,
          envelopeRef.current.activeTab,
          envelopeRef.current.historyLog,
          stillPending,
          cleanedPending
        );
      } catch (error) {
        setHasUnsyncedLocal(true);
        setSyncState('offline');
        setSyncErrorMsg('Gagal menyimpan ke Cloud. Data aman di perangkat dan bisa disinkronkan ulang.');
        logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${user.uid}/transactions/${safeId}`);
        showToast('Tersimpan di perangkat, tetapi sinkronisasi Cloud gagal. Periksa koneksi Anda.');
      }
    }
  };

  const handleDeleteTx = (tx: Transaction): void => {
    setConfirmState({
      open: true,
      title: 'Hapus Entri SPJ',
      message: `Hapus data SPJ atas nama ${tx.nama} (${tx.jenis} · ${tx.noBukti})?`,
      confirmLabel: 'Ya, Hapus',
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        const safeId = sanitizeFirestoreId(tx.id);
        const nextState: AppState = {
          ...appState,
          transactions: appState.transactions.filter((item) => item.id !== tx.id),
        };
        const { nextHistory, newEntry } = appendHistory('Hapus SPJ', `${tx.nama} · ${tx.noBukti}`);
        const nextPending: PendingCloudMutations = {
          ...envelopeRef.current.pendingMutations,
          dirtyTxIds: envelopeRef.current.pendingMutations.dirtyTxIds.filter((id) => id !== safeId),
          deletedTxIds: Array.from(
            new Set([...envelopeRef.current.pendingMutations.deletedTxIds, safeId])
          ),
          dirtyHistoryIds: Array.from(
            new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
          ),
        };
        persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, Date.now());

        setAppState(nextState);
        setPendingMutations(nextPending);
        setHasUnsyncedLocal(true);
        if (editingTx?.id === tx.id) setEditingTx(null);
        showToast('Entri SPJ berhasil dihapus.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          try {
            const profileOk = await ensureUserProfile(user);
            if (!profileOk) throw new Error('Profil pengguna Cloud tidak tersedia');
            await deleteDoc(doc(db, 'users', user.uid, 'transactions', safeId));
            cloudTxIdsRef.current.delete(safeId);
            if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
              await setDoc(
                doc(db, 'users', user.uid, 'history', newEntry.id),
                buildHistoryPayload(newEntry, user.uid)
              );
              cloudHistoryIdsRef.current.add(newEntry.id);
            }
            const cleanedPending: PendingCloudMutations = {
              ...envelopeRef.current.pendingMutations,
              deletedTxIds: envelopeRef.current.pendingMutations.deletedTxIds.filter(
                (id) => id !== safeId
              ),
              dirtyHistoryIds: envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
                (id) => id !== newEntry.id
              ),
            };
            const stillPending = hasAnyPendingMutation(cleanedPending);
            setPendingMutations(cleanedPending);
            setHasUnsyncedLocal(stillPending);
            setSyncErrorMsg('');
            setSyncState('synced');
            persistEnvelope(
              envelopeRef.current.state,
              envelopeRef.current.activeTab,
              envelopeRef.current.historyLog,
              stillPending,
              cleanedPending
            );
          } catch (error) {
            setSyncState('offline');
            setSyncErrorMsg('Penghapusan belum tersinkron ke Cloud. Klik Sinkronkan Ulang saat online.');
            logAndCaptureFirestoreError(
              error,
              OperationType.DELETE,
              `users/${user.uid}/transactions/${safeId}`
            );
          }
        }
      },
    });
  };

  const handleCloneOktoberToMonth = async (): Promise<void> => {
    const targetMonth = appState.currentMonth;
    if (targetMonth === 'ALL' || targetMonth === 'Oktober') {
      showToast('Pilih bulan selain Oktober terlebih dahulu untuk menyalin data Oktober.');
      return;
    }

    const sourceList = appState.transactions.filter(
      (t) => t.category === appState.currentCategory && t.bulan === 'Oktober'
    );
    if (sourceList.length === 0) {
      showToast('Tidak ditemukan data bulan Oktober pada kategori ini.');
      return;
    }

    const targetRoman = MONTH_ROMAN[targetMonth] || 'XI';
    const clonedList: Transaction[] = sourceList.map((src, i) => ({
      ...src,
      id: sanitizeFirestoreId(`tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`),
      bulan: targetMonth,
      tanggal: src.tanggal.replace(/Oktober/gi, targetMonth),
      noBukti: src.noBukti.replace(/\/X\//g, `/${targetRoman}/`),
    }));

    const nextState: AppState = {
      ...appState,
      transactions: [...appState.transactions, ...clonedList],
    };
    const { nextHistory, newEntry } = appendHistory(
      'Salin Bulan Oktober',
      `${clonedList.length} entri disalin ke ${targetMonth} 2026`
    );
    const newIds = clonedList.map((t) => t.id);
    const nextPending: PendingCloudMutations = {
      ...envelopeRef.current.pendingMutations,
      dirtyTxIds: Array.from(new Set([...envelopeRef.current.pendingMutations.dirtyTxIds, ...newIds])),
      dirtyHistoryIds: Array.from(
        new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
      ),
    };
    persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, Date.now());

    setAppState(nextState);
    setPendingMutations(nextPending);
    setHasUnsyncedLocal(true);
    showToast(`${clonedList.length} entri disalin dari Oktober ke ${targetMonth} 2026.`);

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        const profileOk = await ensureUserProfile(user);
        if (!profileOk) throw new Error('Profil pengguna Cloud tidak tersedia');
        const ops: BatchOp[] = clonedList.map((tx) => {
          cloudTxIdsRef.current.add(tx.id);
          return {
            kind: 'set',
            ref: doc(db, 'users', user.uid, 'transactions', tx.id),
            data: buildTxPayload(tx, user.uid, true),
          };
        });
        if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
          ops.push({
            kind: 'set',
            ref: doc(db, 'users', user.uid, 'history', newEntry.id),
            data: buildHistoryPayload(newEntry, user.uid),
          });
          cloudHistoryIdsRef.current.add(newEntry.id);
        }
        await commitBatchChunks(ops);
        const newIdSet = new Set(newIds);
        const cleanedPending: PendingCloudMutations = {
          ...envelopeRef.current.pendingMutations,
          dirtyTxIds: envelopeRef.current.pendingMutations.dirtyTxIds.filter(
            (id) => !newIdSet.has(id)
          ),
          dirtyHistoryIds: envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
            (id) => id !== newEntry.id
          ),
        };
        const stillPending = hasAnyPendingMutation(cleanedPending);
        setPendingMutations(cleanedPending);
        setHasUnsyncedLocal(stillPending);
        setSyncErrorMsg('');
        setSyncState('synced');
        persistEnvelope(
          envelopeRef.current.state,
          envelopeRef.current.activeTab,
          envelopeRef.current.historyLog,
          stillPending,
          cleanedPending
        );
      } catch (error) {
        setHasUnsyncedLocal(true);
        setSyncState('offline');
        setSyncErrorMsg('Hasil salin belum tersinkron ke Cloud. Klik Sinkronkan Ulang.');
        logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${user.uid}/transactions`);
      }
    }
  };

  const handleSaveOfficials = async (
    nextOfficials: Officials,
    nextMainTitle: string,
    nextActivityTitle: string
  ): Promise<void> => {
    const nextState: AppState = {
      ...appState,
      officials: nextOfficials,
      customMainTitle: nextMainTitle || DEFAULT_CUSTOM_MAIN_TITLE,
      customActivityTitle: nextActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE,
    };
    const { nextHistory, newEntry } = appendHistory(
      'Simpan Pejabat',
      `Kepala Sekolah: ${nextOfficials.kepsekName}`
    );
    const nextPending: PendingCloudMutations = {
      ...envelopeRef.current.pendingMutations,
      dirtySettings: true,
      dirtyHistoryIds: Array.from(
        new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
      ),
    };
    persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, Date.now());
    setAppState(nextState);
    setPendingMutations(nextPending);
    setHasUnsyncedLocal(true);
    showToast('Data Pejabat Penandatangan & Judul berhasil disimpan otomatis.');
    if (user && user.emailVerified) {
      await syncSettingsToCloud(nextState, true, newEntry);
    }
  };

  const handleAddEmployee = async (emp: MasterEmployee): Promise<void> => {
    const safeId = sanitizeFirestoreId(emp.id);
    const normalizedEmp: MasterEmployee = { ...emp, id: safeId };
    const nextState: AppState = {
      ...appState,
      masterEmployees: [...appState.masterEmployees, normalizedEmp],
    };
    const { nextHistory, newEntry } = appendHistory(
      'Tambah Pegawai Master',
      `${normalizedEmp.nama} (${normalizedEmp.jenis})`
    );
    const nextPending: PendingCloudMutations = {
      ...envelopeRef.current.pendingMutations,
      dirtyEmpIds: Array.from(new Set([...envelopeRef.current.pendingMutations.dirtyEmpIds, safeId])),
      deletedEmpIds: envelopeRef.current.pendingMutations.deletedEmpIds.filter((id) => id !== safeId),
      dirtyHistoryIds: Array.from(
        new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
      ),
    };
    persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, Date.now());
    setAppState(nextState);
    setPendingMutations(nextPending);
    setHasUnsyncedLocal(true);
    showToast('Pegawai master ditambahkan dan tersimpan otomatis.');

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        const profileOk = await ensureUserProfile(user);
        if (!profileOk) throw new Error('Profil pengguna Cloud tidak tersedia');
        const empRef = doc(db, 'users', user.uid, 'employees', safeId);
        await upsertDocSafe(
          empRef,
          buildEmployeePayload(normalizedEmp, user.uid, true),
          buildEmployeePayload(normalizedEmp, user.uid, false),
          cloudEmpIdsRef.current.has(safeId)
        );
        cloudEmpIdsRef.current.add(safeId);
        if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
          await setDoc(
            doc(db, 'users', user.uid, 'history', newEntry.id),
            buildHistoryPayload(newEntry, user.uid)
          );
          cloudHistoryIdsRef.current.add(newEntry.id);
        }
        const cleanedPending: PendingCloudMutations = {
          ...envelopeRef.current.pendingMutations,
          dirtyEmpIds: envelopeRef.current.pendingMutations.dirtyEmpIds.filter((id) => id !== safeId),
          dirtyHistoryIds: envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
            (id) => id !== newEntry.id
          ),
        };
        const stillPending = hasAnyPendingMutation(cleanedPending);
        setPendingMutations(cleanedPending);
        setHasUnsyncedLocal(stillPending);
        setSyncErrorMsg('');
        setSyncState('synced');
        persistEnvelope(
          envelopeRef.current.state,
          envelopeRef.current.activeTab,
          envelopeRef.current.historyLog,
          stillPending,
          cleanedPending
        );
      } catch (error) {
        setHasUnsyncedLocal(true);
        setSyncState('offline');
        setSyncErrorMsg('Pegawai master belum tersinkron ke Cloud. Klik Sinkronkan Ulang.');
        logAndCaptureFirestoreError(error, OperationType.CREATE, `users/${user.uid}/employees/${safeId}`);
      }
    }
  };

  const handleDeleteEmployee = (emp: MasterEmployee): void => {
    setConfirmState({
      open: true,
      title: 'Hapus Pegawai Master',
      message: `Hapus ${emp.nama} (${emp.jenis}) dari daftar pegawai master?`,
      confirmLabel: 'Ya, Hapus',
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        const safeId = sanitizeFirestoreId(emp.id);
        const nextState: AppState = {
          ...appState,
          masterEmployees: appState.masterEmployees.filter((item) => item.id !== emp.id),
        };
        const { nextHistory, newEntry } = appendHistory('Hapus Pegawai Master', emp.nama);
        const nextPending: PendingCloudMutations = {
          ...envelopeRef.current.pendingMutations,
          dirtyEmpIds: envelopeRef.current.pendingMutations.dirtyEmpIds.filter((id) => id !== safeId),
          deletedEmpIds: Array.from(
            new Set([...envelopeRef.current.pendingMutations.deletedEmpIds, safeId])
          ),
          dirtyHistoryIds: Array.from(
            new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
          ),
        };
        persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, Date.now());
        setAppState(nextState);
        setPendingMutations(nextPending);
        setHasUnsyncedLocal(true);
        showToast('Pegawai master dihapus.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          try {
            const profileOk = await ensureUserProfile(user);
            if (!profileOk) throw new Error('Profil pengguna Cloud tidak tersedia');
            await deleteDoc(doc(db, 'users', user.uid, 'employees', safeId));
            cloudEmpIdsRef.current.delete(safeId);
            if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
              await setDoc(
                doc(db, 'users', user.uid, 'history', newEntry.id),
                buildHistoryPayload(newEntry, user.uid)
              );
              cloudHistoryIdsRef.current.add(newEntry.id);
            }
            const cleanedPending: PendingCloudMutations = {
              ...envelopeRef.current.pendingMutations,
              deletedEmpIds: envelopeRef.current.pendingMutations.deletedEmpIds.filter(
                (id) => id !== safeId
              ),
              dirtyHistoryIds: envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
                (id) => id !== newEntry.id
              ),
            };
            const stillPending = hasAnyPendingMutation(cleanedPending);
            setPendingMutations(cleanedPending);
            setHasUnsyncedLocal(stillPending);
            setSyncErrorMsg('');
            setSyncState('synced');
            persistEnvelope(
              envelopeRef.current.state,
              envelopeRef.current.activeTab,
              envelopeRef.current.historyLog,
              stillPending,
              cleanedPending
            );
          } catch (error) {
            setSyncState('offline');
            setSyncErrorMsg('Penghapusan pegawai belum tersinkron ke Cloud. Klik Sinkronkan Ulang.');
            logAndCaptureFirestoreError(
              error,
              OperationType.DELETE,
              `users/${user.uid}/employees/${safeId}`
            );
          }
        }
      },
    });
  };

  const handleExportJSON = (): void => {
    const payload = JSON.stringify(appState, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_SPJ_SRT39Garut_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('File cadangan JSON berhasil diunduh.');
  };

  const handleImportJSON = (file: File): void => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let nextState: AppState;
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}')) as Partial<AppState>;
        nextState = normalizeAppState({
          ...appState,
          ...parsed,
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : appState.transactions,
          masterEmployees: Array.isArray(parsed.masterEmployees)
            ? parsed.masterEmployees
            : appState.masterEmployees,
          officials: parsed.officials ? { ...DEFAULT_OFFICIALS, ...parsed.officials } : appState.officials,
        });
      } catch (err) {
        console.error('Impor JSON gagal:', err);
        showToast('Format file JSON tidak valid.');
        return;
      }

      const { nextHistory, newEntry } = appendHistory(
        'Pulihkan JSON',
        `${nextState.transactions.length} entri SPJ & ${nextState.masterEmployees.length} pegawai`
      );
      const nextPending: PendingCloudMutations = {
        dirtyTxIds: nextState.transactions.map((t) => sanitizeFirestoreId(t.id)),
        deletedTxIds: [],
        dirtyEmpIds: nextState.masterEmployees.map((e) => sanitizeFirestoreId(e.id)),
        deletedEmpIds: [],
        dirtyHistoryIds: Array.from(
          new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
        ),
        dirtySettings: true,
      };
      persistEnvelope(nextState, activeTab, nextHistory, true, nextPending, Date.now());
      setAppState(nextState);
      setPendingMutations(nextPending);
      setHasUnsyncedLocal(true);
      showToast('Data berhasil dipulihkan dari file JSON.');

      if (user && user.emailVerified) {
        setSyncState('syncing');
        try {
          const profileOk = await ensureUserProfile(user);
          if (!profileOk) throw new Error('Profil pengguna Cloud tidak tersedia');
          const ops: BatchOp[] = [];
          nextState.transactions.forEach((tx) => {
            const sid = sanitizeFirestoreId(tx.id);
            const ref = doc(db, 'users', user.uid, 'transactions', sid);
            if (cloudTxIdsRef.current.has(sid)) {
              ops.push({ kind: 'update', ref, data: buildTxPayload(tx, user.uid, false) });
            } else {
              ops.push({ kind: 'set', ref, data: buildTxPayload(tx, user.uid, true) });
              cloudTxIdsRef.current.add(sid);
            }
          });
          nextState.masterEmployees.forEach((emp) => {
            const sid = sanitizeFirestoreId(emp.id);
            const ref = doc(db, 'users', user.uid, 'employees', sid);
            if (cloudEmpIdsRef.current.has(sid)) {
              ops.push({ kind: 'update', ref, data: buildEmployeePayload(emp, user.uid, false) });
            } else {
              ops.push({ kind: 'set', ref, data: buildEmployeePayload(emp, user.uid, true) });
              cloudEmpIdsRef.current.add(sid);
            }
          });
          if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
            ops.push({
              kind: 'set',
              ref: doc(db, 'users', user.uid, 'history', newEntry.id),
              data: buildHistoryPayload(newEntry, user.uid),
            });
            cloudHistoryIdsRef.current.add(newEntry.id);
          }
          const cfgRef = doc(db, 'users', user.uid, 'settings', 'config');
          if (cloudConfigExistsRef.current) {
            ops.push({ kind: 'update', ref: cfgRef, data: buildSettingsPayload(nextState, user.uid, false) });
          } else {
            ops.push({ kind: 'set', ref: cfgRef, data: buildSettingsPayload(nextState, user.uid, true) });
            cloudConfigExistsRef.current = true;
          }
          await commitBatchChunks(ops);
          const cleared = { ...EMPTY_PENDING_MUTATIONS };
          setPendingMutations(cleared);
          setHasUnsyncedLocal(false);
          setSyncErrorMsg('');
          setSyncState('synced');
          persistEnvelope(nextState, activeTab, nextHistory, false, cleared);
        } catch (err) {
          setSyncState('offline');
          setSyncErrorMsg('Data JSON tersimpan di perangkat, tetapi sinkronisasi ke Cloud gagal.');
          logAndCaptureFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
          showToast('Data dipulihkan di perangkat, tetapi sinkronisasi Cloud gagal.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleRequestResetDefaults = (): void => {
    setConfirmState({
      open: true,
      title: 'Reset Data Awal 2026',
      message:
        'Kembalikan seluruh data ke setelan awal Oktober & November 2026? Perubahan yang belum dicadangkan ke JSON akan diganti.',
      confirmLabel: 'Ya, Reset Data',
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        const fresh: AppState = { ...DEFAULT_APP_STATE };
        const { nextHistory, newEntry } = appendHistory(
          'Reset Data Awal',
          'Dikembalikan ke data default TA 2026'
        );
        const nextPending: PendingCloudMutations = {
          dirtyTxIds: fresh.transactions.map((t) => sanitizeFirestoreId(t.id)),
          deletedTxIds: [],
          dirtyEmpIds: fresh.masterEmployees.map((e) => sanitizeFirestoreId(e.id)),
          deletedEmpIds: [],
          dirtyHistoryIds: Array.from(
            new Set([...envelopeRef.current.pendingMutations.dirtyHistoryIds, newEntry.id])
          ),
          dirtySettings: true,
        };
        persistEnvelope(fresh, activeTab, nextHistory, true, nextPending, Date.now());
        setAppState(fresh);
        setPendingMutations(nextPending);
        setHasUnsyncedLocal(true);
        setEditingTx(null);
        showToast('Seluruh data dikembalikan ke pengaturan awal 2026.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          try {
            const profileOk = await ensureUserProfile(user);
            if (!profileOk) throw new Error('Profil pengguna Cloud tidak tersedia');
            const [curTx, curEmp] = await Promise.all([
              getDocs(query(collection(db, 'users', user.uid, 'transactions'), where('ownerId', '==', user.uid))),
              getDocs(query(collection(db, 'users', user.uid, 'employees'), where('ownerId', '==', user.uid))),
            ]);
            const ops: BatchOp[] = [];
            curTx.docs.forEach((d) => ops.push({ kind: 'delete', ref: d.ref }));
            curEmp.docs.forEach((d) => ops.push({ kind: 'delete', ref: d.ref }));
            const nextTxIds = new Set<string>();
            const nextEmpIds = new Set<string>();
            fresh.transactions.forEach((tx) => {
              const sid = sanitizeFirestoreId(tx.id);
              ops.push({
                kind: 'set',
                ref: doc(db, 'users', user.uid, 'transactions', sid),
                data: buildTxPayload(tx, user.uid, true),
              });
              nextTxIds.add(sid);
            });
            fresh.masterEmployees.forEach((emp) => {
              const sid = sanitizeFirestoreId(emp.id);
              ops.push({
                kind: 'set',
                ref: doc(db, 'users', user.uid, 'employees', sid),
                data: buildEmployeePayload(emp, user.uid, true),
              });
              nextEmpIds.add(sid);
            });
            if (!cloudHistoryIdsRef.current.has(newEntry.id)) {
              ops.push({
                kind: 'set',
                ref: doc(db, 'users', user.uid, 'history', newEntry.id),
                data: buildHistoryPayload(newEntry, user.uid),
              });
              cloudHistoryIdsRef.current.add(newEntry.id);
            }
            const cfgRef = doc(db, 'users', user.uid, 'settings', 'config');
            if (cloudConfigExistsRef.current) {
              ops.push({ kind: 'update', ref: cfgRef, data: buildSettingsPayload(fresh, user.uid, false) });
            } else {
              ops.push({ kind: 'set', ref: cfgRef, data: buildSettingsPayload(fresh, user.uid, true) });
              cloudConfigExistsRef.current = true;
            }
            await commitBatchChunks(ops);
            cloudTxIdsRef.current = nextTxIds;
            cloudEmpIdsRef.current = nextEmpIds;
            const cleared = { ...EMPTY_PENDING_MUTATIONS };
            setPendingMutations(cleared);
            setHasUnsyncedLocal(false);
            setSyncErrorMsg('');
            setSyncState('synced');
            persistEnvelope(fresh, activeTab, nextHistory, false, cleared);
          } catch (error) {
            setSyncState('offline');
            setSyncErrorMsg('Reset belum tersinkron ke Cloud. Klik Sinkronkan Ulang.');
            logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
          }
        }
      },
    });
  };

  const openPrintPreview = (job: PrintJobMeta): void => {
    setPrintJob(job);
    setLastPrintSnapshot(job);
  };

  const handleQuickOfficeDownload = async (
    format: 'excel' | 'word',
    job: PrintJobMeta
  ): Promise<void> => {
    if (!job.items.length) {
      showToast('Belum ada data pada periode ini untuk diekspor.');
      return;
    }
    const key = `${job.type}-${format}`;
    if (busyExport) return;
    setBusyExport(key);
    const ctx = {
      category: appState.currentCategory,
      month: appState.currentMonth,
      officials: appState.officials,
      customMainTitle: appState.customMainTitle,
      customActivityTitle: appState.customActivityTitle,
    };
    try {
      if (format === 'excel') {
        await downloadExcelReport(job, ctx);
        showToast('Laporan Excel (.xlsx) berhasil diunduh.');
      } else {
        await downloadWordReport(job, ctx);
        showToast('Laporan Word (.docx) berhasil diunduh.');
      }
    } catch (err) {
      console.error('Export gagal:', err);
      showToast(`Gagal membuat laporan ${format === 'excel' ? 'Excel' : 'Word'}.`);
    } finally {
      setBusyExport(null);
    }
  };

  const dhTargetList = useMemo(
    () =>
      dhFilterId === 'ALL'
        ? filteredTransactions
        : filteredTransactions.filter((t) => t.id === dhFilterId),
    [filteredTransactions, dhFilterId]
  );

  const ttTargetList = useMemo(
    () =>
      ttFilterId === 'ALL'
        ? filteredTransactions
        : filteredTransactions.filter((t) => t.id === ttFilterId),
    [filteredTransactions, ttFilterId]
  );

  const navItems: { id: TabType; label: string; mobileLabel: string; icon: React.ReactNode }[] = [
    { id: 'kelola', label: 'Kelola & Input', mobileLabel: 'Kelola', icon: <SlidersHorizontal className="w-4 h-4" /> },
    { id: 'rekap', label: 'Rekapitulasi', mobileLabel: 'Rekap', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'dh', label: 'Daftar Hadir', mobileLabel: 'Hadir', icon: <FileCheck2 className="w-4 h-4" /> },
    { id: 'tt', label: 'Tanda Terima SPJ', mobileLabel: 'SPJ', icon: <FileText className="w-4 h-4" /> },
    { id: 'master', label: 'Master & Pejabat', mobileLabel: 'Master', icon: <Settings2 className="w-4 h-4" /> },
  ];

  const activePrintTarget = printJob || lastPrintSnapshot;

  const lastSavedTimeStr =
    lastUpdatedAt > 0
      ? new Date(lastUpdatedAt).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 no-print">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-extrabold text-xs tracking-tight shrink-0">
              SRT39
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold leading-tight truncate">
                Honor & Transpor SRT 39
              </div>
              <div className="text-[11px] text-slate-400 truncate">Kemensos RI · Garut TA 2026</div>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-1" aria-label="Menu utama">
            {navItems.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {!authReady ? null : user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:block text-right">
                  <div className="text-xs font-semibold text-white truncate max-w-[140px]">
                    {user.displayName || 'Akun Cloud'}
                  </div>
                  <div className="text-[10px] text-emerald-400 truncate max-w-[140px]">{user.email}</div>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
                  title="Keluar dari akun Cloud"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Keluar</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sinkron Cloud</span>
              </button>
            )}
          </div>
        </div>

        {/* Tablet secondary tab bar */}
        <div className="hidden md:flex lg:hidden border-t border-slate-800 px-4 py-2 gap-1.5 overflow-x-auto">
          {navItems.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
                  active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Sub-header Workspace Filter Bar */}
      <div className="bg-white border-b border-slate-200 no-print">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 lg:pb-0">
            {(
              [
                { id: 'ekskul', label: 'Ekstrakurikuler' },
                { id: 'gurutamu', label: 'Guru Tamu' },
                { id: 'lainnya', label: 'Kegiatan Lainnya' },
              ] as { id: CategoryType; label: string }[]
            ).map((cat) => {
              const active = appState.currentCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5">
            <div className="flex items-center gap-2 flex-1 sm:flex-initial">
              <select
                value={appState.currentMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                aria-label="Filter bulan anggaran"
                className="flex-1 sm:flex-initial min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m} 2026
                  </option>
                ))}
                <option value="ALL">Semua Bulan 2026</option>
              </select>

              {appState.currentMonth !== 'Oktober' && appState.currentMonth !== 'ALL' && (
                <button
                  type="button"
                  onClick={handleCloneOktoberToMonth}
                  className="min-h-[42px] px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
                  title={`Salin semua entri bulan Oktober ke ${appState.currentMonth}`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Oktober</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {syncState === 'synced' ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Tersimpan otomatis di Cloud{lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
                  </span>
                </>
              ) : syncState === 'syncing' ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>Menyinkronkan data...</span>
                </>
              ) : syncState === 'offline' ? (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    {initialBoot.localStorageWritable || idbWritable
                      ? 'Tersimpan di perangkat (Cloud luring)'
                      : 'Cloud luring · Simpan lokal terbatas'}
                    {lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
                  </span>
                  {user && (
                    <button
                      type="button"
                      onClick={() => void flushPendingMutations()}
                      className="ml-1 px-2 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold flex items-center gap-1 transition"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Sinkronkan Ulang
                    </button>
                  )}
                </>
              ) : initialBoot.localStorageWritable || idbWritable ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Tersimpan di perangkat ini{lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-amber-800 font-medium">
                    Penyimpanan browser diblokir · Aktifkan Sinkron Cloud
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Warning Banner when browser restricts local persistence OR Cloud sync/login encounters an error */}
      {((!initialBoot.localStorageWritable && idbWritable === false && !user) || syncErrorMsg) && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-6 py-2.5 no-print">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {syncErrorMsg ||
                  'Browser di komputer ini membatasi penyimpanan lokal. Masuk dengan Google agar data tersimpan permanen di Cloud dan bisa dibuka dari komputer lain.'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
              {typeof window !== 'undefined' && (
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[36px] px-3 py-1.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 font-semibold whitespace-nowrap flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka di Tab Baru
                </a>
              )}
              {!user ? (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap"
                >
                  Aktifkan Sinkron Cloud
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void flushPendingMutations()}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sinkronkan Ulang
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subtle info strip when working locally without Cloud sign-in */}
      {authReady && !user && !syncErrorMsg && (initialBoot.localStorageWritable || idbWritable !== false) && (
        <div className="bg-blue-50/80 border-b border-blue-100 px-3 sm:px-6 py-2 no-print">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-blue-900">
            <span>
              Mode Simpan Perangkat: data tersimpan otomatis di browser komputer ini. Untuk membuka dan menyimpan data yang sama di komputer lain, masuk dengan Google.
            </span>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="min-h-[32px] px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap self-start sm:self-auto"
            >
              Masuk Google (Sinkron Cloud)
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-5 pb-24 md:pb-10 space-y-6 no-print">
        {activeTab === 'kelola' && (
          <div className="space-y-6">
            <TransactionForm
              currentCategory={appState.currentCategory}
              currentMonth={appState.currentMonth}
              customActivityTitle={appState.customActivityTitle}
              masterEmployees={appState.masterEmployees}
              transactions={appState.transactions}
              editingTx={editingTx}
              onCancelEdit={() => setEditingTx(null)}
              onSubmitTx={handleSubmitTx}
              onValidationError={showToast}
            />
            <TransactionsList
              items={filteredTransactions}
              currentMonth={appState.currentMonth}
              onEdit={(tx) => {
                setEditingTx(tx);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onDelete={handleDeleteTx}
              onOpenDH={(tx) =>
                openPrintPreview({
                  docName: `Daftar_Hadir_${tx.nama.replace(/\s+/g, '_')}`,
                  type: 'dh',
                  items: [tx],
                })
              }
              onOpenTT={(tx) =>
                openPrintPreview({
                  docName: `Tanda_Terima_${tx.nama.replace(/\s+/g, '_')}`,
                  type: 'tt',
                  items: [tx],
                })
              }
              onOpenAllDH={() => {
                if (!filteredTransactions.length) {
                  showToast('Belum ada data pada periode ini untuk dicetak.');
                  return;
                }
                openPrintPreview({
                  docName: `Semua_Daftar_Hadir_${appState.currentMonth}_2026`,
                  type: 'dh',
                  items: filteredTransactions,
                });
              }}
              onOpenAllTT={() => {
                if (!filteredTransactions.length) {
                  showToast('Belum ada data pada periode ini untuk dicetak.');
                  return;
                }
                openPrintPreview({
                  docName: `Semua_Tanda_Terima_${appState.currentMonth}_2026`,
                  type: 'tt',
                  items: filteredTransactions,
                });
              }}
            />

            {/* Riwayat Perubahan Tersimpan */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setShowHistoryPanel((v) => !v)}
                className="w-full px-4 sm:px-6 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition"
              >
                <div className="flex items-center gap-2.5">
                  <History className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="text-sm font-bold text-slate-900">
                    Riwayat Aktivitas Tersimpan ({historyLog.length})
                  </span>
                </div>
                <span className="text-xs font-semibold text-blue-600">
                  {showHistoryPanel ? 'Tutup' : 'Lihat Riwayat'}
                </span>
              </button>
              {showHistoryPanel && (
                <div className="border-t border-slate-100 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {historyLog.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 text-center">
                      Belum ada catatan perubahan baru. Setiap perubahan akan tercatat otomatis di sini.
                    </div>
                  ) : (
                    historyLog.map((h) => (
                      <div key={h.id} className="px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900">{h.action}</span>
                          <span className="text-slate-600"> · {h.detail}</span>
                        </div>
                        <span className="font-mono-num text-slate-400 shrink-0">
                          {new Date(h.timestamp).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'rekap' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  Rekapitulasi Bulanan ({filteredTransactions.length} Entri)
                </h2>
                <p className="text-xs text-slate-500">
                  Format Resmi A4 Landscape · Unduh PDF, Excel (.xlsx), Word (.docx), atau Cetak
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyExport !== null}
                  onClick={() =>
                    handleQuickOfficeDownload('excel', {
                      docName: `Rekapitulasi_Honor_${appState.currentMonth}_2026`,
                      type: 'rekap',
                      items: filteredTransactions,
                    })
                  }
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {busyExport === 'rekap-excel' ? 'Membuat...' : 'Excel (.xlsx)'}
                </button>
                <button
                  type="button"
                  disabled={busyExport !== null}
                  onClick={() =>
                    handleQuickOfficeDownload('word', {
                      docName: `Rekapitulasi_Honor_${appState.currentMonth}_2026`,
                      type: 'rekap',
                      items: filteredTransactions,
                    })
                  }
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
                >
                  <FileText className="w-4 h-4" />
                  {busyExport === 'rekap-word' ? 'Membuat...' : 'Word (.docx)'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openPrintPreview({
                      docName: `Rekapitulasi_Honor_${appState.currentMonth}_2026`,
                      type: 'rekap',
                      items: filteredTransactions,
                    })
                  }
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition"
                >
                  <Printer className="w-4 h-4" />
                  Cetak / PDF
                </button>
              </div>
            </div>
            <ResponsiveSheetFrame>
              <RekapSheet
                items={filteredTransactions}
                category={appState.currentCategory}
                month={appState.currentMonth}
                officials={appState.officials}
                customMainTitle={appState.customMainTitle}
                customActivityTitle={appState.customActivityTitle}
              />
            </ResponsiveSheetFrame>
          </div>
        )}

        {activeTab === 'dh' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Pilih Lembar Daftar Hadir
                </label>
                <select
                  value={dhFilterId}
                  onChange={(e) => setDhFilterId(e.target.value)}
                  className="w-full max-w-md min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
                >
                  <option value="ALL">Semua Lembar ({filteredTransactions.length} Dokumen)</option>
                  {filteredTransactions.map((tx, idx) => (
                    <option key={tx.id} value={tx.id}>
                      {idx + 1}. {tx.nama} - {tx.jenis} ({tx.jenjang})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyExport !== null}
                  onClick={() =>
                    handleQuickOfficeDownload('excel', {
                      docName:
                        dhFilterId === 'ALL'
                          ? `Semua_Daftar_Hadir_${appState.currentMonth}_2026`
                          : `Daftar_Hadir_${dhTargetList[0]?.nama.replace(/\s+/g, '_') || 'Dokumen'}`,
                      type: 'dh',
                      items: dhTargetList,
                    })
                  }
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {busyExport === 'dh-excel' ? 'Membuat...' : 'Excel (.xlsx)'}
                </button>
                <button
                  type="button"
                  disabled={busyExport !== null}
                  onClick={() =>
                    handleQuickOfficeDownload('word', {
                      docName:
                        dhFilterId === 'ALL'
                          ? `Semua_Daftar_Hadir_${appState.currentMonth}_2026`
                          : `Daftar_Hadir_${dhTargetList[0]?.nama.replace(/\s+/g, '_') || 'Dokumen'}`,
                      type: 'dh',
                      items: dhTargetList,
                    })
                  }
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
                >
                  <FileText className="w-4 h-4" />
                  {busyExport === 'dh-word' ? 'Membuat...' : 'Word (.docx)'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!dhTargetList.length) {
                      showToast('Tidak ada data Daftar Hadir pada filter ini.');
                      return;
                    }
                    openPrintPreview({
                      docName:
                        dhFilterId === 'ALL'
                          ? `Semua_Daftar_Hadir_${appState.currentMonth}_2026`
                          : `Daftar_Hadir_${dhTargetList[0].nama.replace(/\s+/g, '_')}`,
                      type: 'dh',
                      items: dhTargetList,
                    });
                  }}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition"
                >
                  <Printer className="w-4 h-4" />
                  Cetak / PDF
                </button>
              </div>
            </div>

            {dhTargetList.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center text-slate-500 border border-slate-200">
                Tidak ada data Daftar Hadir pada filter ini.
              </div>
            ) : (
              <ResponsiveSheetFrame>
                {dhTargetList.map((tx, i) => (
                  <div key={tx.id} className={i < dhTargetList.length - 1 ? 'page-break' : ''}>
                    <DaftarHadirSheet
                      tx={tx}
                      category={appState.currentCategory}
                      month={appState.currentMonth}
                      officials={appState.officials}
                      customMainTitle={appState.customMainTitle}
                      customActivityTitle={appState.customActivityTitle}
                    />
                  </div>
                ))}
              </ResponsiveSheetFrame>
            )}
          </div>
        )}

        {activeTab === 'tt' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Pilih Lembar Tanda Terima SPJ
                </label>
                <select
                  value={ttFilterId}
                  onChange={(e) => setTtFilterId(e.target.value)}
                  className="w-full max-w-md min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
                >
                  <option value="ALL">Semua Lembar ({filteredTransactions.length} Dokumen)</option>
                  {filteredTransactions.map((tx, idx) => (
                    <option key={tx.id} value={tx.id}>
                      {idx + 1}. {tx.nama} - {tx.jenis} ({tx.jenjang})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyExport !== null}
                  onClick={() =>
                    handleQuickOfficeDownload('excel', {
                      docName:
                        ttFilterId === 'ALL'
                          ? `Semua_Tanda_Terima_${appState.currentMonth}_2026`
                          : `Tanda_Terima_${ttTargetList[0]?.nama.replace(/\s+/g, '_') || 'Dokumen'}`,
                      type: 'tt',
                      items: ttTargetList,
                    })
                  }
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {busyExport === 'tt-excel' ? 'Membuat...' : 'Excel (.xlsx)'}
                </button>
                <button
                  type="button"
                  disabled={busyExport !== null}
                  onClick={() =>
                    handleQuickOfficeDownload('word', {
                      docName:
                        ttFilterId === 'ALL'
                          ? `Semua_Tanda_Terima_${appState.currentMonth}_2026`
                          : `Tanda_Terima_${ttTargetList[0]?.nama.replace(/\s+/g, '_') || 'Dokumen'}`,
                      type: 'tt',
                      items: ttTargetList,
                    })
                  }
                  className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
                >
                  <FileText className="w-4 h-4" />
                  {busyExport === 'tt-word' ? 'Membuat...' : 'Word (.docx)'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!ttTargetList.length) {
                      showToast('Tidak ada data Tanda Terima SPJ pada filter ini.');
                      return;
                    }
                    openPrintPreview({
                      docName:
                        ttFilterId === 'ALL'
                          ? `Semua_Tanda_Terima_${appState.currentMonth}_2026`
                          : `Tanda_Terima_${ttTargetList[0].nama.replace(/\s+/g, '_')}`,
                      type: 'tt',
                      items: ttTargetList,
                    });
                  }}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition"
                >
                  <Printer className="w-4 h-4" />
                  Cetak / PDF
                </button>
              </div>
            </div>

            {ttTargetList.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center text-slate-500 border border-slate-200">
                Tidak ada data Tanda Terima SPJ pada filter ini.
              </div>
            ) : (
              <ResponsiveSheetFrame>
                {ttTargetList.map((tx, i) => (
                  <div key={tx.id} className={i < ttTargetList.length - 1 ? 'page-break' : ''}>
                    <TandaTerimaSheet
                      tx={tx}
                      category={appState.currentCategory}
                      month={appState.currentMonth}
                      officials={appState.officials}
                      customMainTitle={appState.customMainTitle}
                      customActivityTitle={appState.customActivityTitle}
                    />
                  </div>
                ))}
              </ResponsiveSheetFrame>
            )}
          </div>
        )}

        {activeTab === 'master' && (
          <MasterView
            officials={appState.officials}
            customMainTitle={appState.customMainTitle}
            customActivityTitle={appState.customActivityTitle}
            masterEmployees={appState.masterEmployees}
            onSaveOfficials={handleSaveOfficials}
            onAddEmployee={handleAddEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            onExportJSON={handleExportJSON}
            onImportJSON={handleImportJSON}
            onRequestResetDefaults={handleRequestResetDefaults}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 pb-safe no-print"
        aria-label="Navigasi seluler"
      >
        <div className="grid grid-cols-5">
          {navItems.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`min-h-[56px] py-1.5 px-1 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                  active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.icon}
                <span className="truncate max-w-full">{tab.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      <PrintModal
        job={printJob}
        category={appState.currentCategory}
        month={appState.currentMonth}
        officials={appState.officials}
        customMainTitle={appState.customMainTitle}
        customActivityTitle={appState.customActivityTitle}
        onClose={() => setPrintJob(null)}
        onNotify={showToast}
      />

      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />

      {/* Toast Notification */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-5 right-4 left-4 md:left-auto z-[80] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 text-xs sm:text-sm font-medium flex items-center gap-2.5 max-w-sm md:ml-auto no-print"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Hidden Native Print Portal directly mounted onto document.body */}
      {activePrintTarget &&
        createPortal(
          <div id="print-portal-root" className="hidden print:block">
            {activePrintTarget.type === 'rekap' && (
              <RekapSheet
                items={activePrintTarget.items}
                category={appState.currentCategory}
                month={appState.currentMonth}
                officials={appState.officials}
                customMainTitle={appState.customMainTitle}
                customActivityTitle={appState.customActivityTitle}
              />
            )}
            {activePrintTarget.type === 'dh' &&
              activePrintTarget.items.map((tx, idx) => (
                <div
                  key={tx.id}
                  className={idx < activePrintTarget.items.length - 1 ? 'page-break' : ''}
                >
                  <DaftarHadirSheet
                    tx={tx}
                    category={appState.currentCategory}
                    month={appState.currentMonth}
                    officials={appState.officials}
                    customMainTitle={appState.customMainTitle}
                    customActivityTitle={appState.customActivityTitle}
                  />
                </div>
              ))}
            {activePrintTarget.type === 'tt' &&
              activePrintTarget.items.map((tx, idx) => (
                <div
                  key={tx.id}
                  className={idx < activePrintTarget.items.length - 1 ? 'page-break' : ''}
                >
                  <TandaTerimaSheet
                    tx={tx}
                    category={appState.currentCategory}
                    month={appState.currentMonth}
                    officials={appState.officials}
                    customMainTitle={appState.customMainTitle}
                    customActivityTitle={appState.customActivityTitle}
                  />
                </div>
              ))}
          </div>,
          document.body
        )}
    </div>
  );
}
