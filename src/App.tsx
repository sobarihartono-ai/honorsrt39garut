import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  FileCheck2,
  FileSpreadsheet,
  FileText,
  History,
  LogIn,
  LogOut,
  Printer,
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
  PersistedEnvelope,
  loadInitialEnvelope,
  normalizeAppState,
  readIndexedDbEnvelope,
  saveEnvelopeSync,
  writeIndexedDbEnvelope,
} from './utils/localPersistence';
import { downloadExcelReport, downloadWordReport } from './utils/officeGenerator';

function buildTxPayload(tx: Transaction, uid: string, isCreate: boolean) {
  const base = {
    category: tx.category,
    bulan: clampStr(tx.bulan || 'November', 30) || 'November',
    noBukti: clampStr(tx.noBukti || 'REG/001/2026', 80) || 'REG/001/2026',
    tanggal: clampStr(tx.tanggal || '1 November 2026', 60) || '1 November 2026',
    nama: clampStr(tx.nama || '-', 120) || '-',
    jenjang: clampStr(tx.jenjang || 'SRMP', 40) || 'SRMP',
    jenis: clampStr(tx.jenis || '-', 100) || '-',
    status: clampStr(tx.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(tx.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: Math.min(100000000, Math.max(0, Number(tx.tarif) || 0)),
    jamlat: Math.min(1000, Math.max(1, Math.round(Number(tx.jamlat) || 1))),
    pajakRate: Math.min(1, Math.max(0, Number(tx.pajakRate) || 0)),
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
    category: emp.category,
    nama: clampStr(emp.nama || '-', 120) || '-',
    jenis: clampStr(emp.jenis || '-', 100) || '-',
    jenjang: clampStr(emp.jenjang || 'SRMP', 40) || 'SRMP',
    status: clampStr(emp.status || 'NON ASN', 60) || 'NON ASN',
    jabatan: clampStr(emp.jabatan || 'Pembina', 100) || 'Pembina',
    tarif: Math.min(100000000, Math.max(0, Number(emp.tarif) || 0)),
    pajakRate: Math.min(1, Math.max(0, Number(emp.pajakRate) || 0)),
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
    currentCategory: state.currentCategory,
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

function logAndCaptureFirestoreError(error: unknown, op: OperationType, path: string | null): void {
  try {
    handleFirestoreError(error, op, path);
  } catch {
    // Error sudah dicatat ke console dalam format FirestoreErrorInfo
  }
}

export default function App() {
  const initialBoot = useMemo(() => loadInitialEnvelope(), []);

  const [appState, setAppState] = useState<AppState>(initialBoot.envelope.state);
  const [activeTab, setActiveTab] = useState<TabType>(initialBoot.envelope.activeTab);
  const [historyLog, setHistoryLog] = useState<HistoryEntry[]>(initialBoot.envelope.historyLog);
  const [hasUnsyncedLocal, setHasUnsyncedLocal] = useState<boolean>(
    initialBoot.envelope.hasUnsyncedLocalChanges
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
  const [idbReady, setIdbReady] = useState(false);

  const envelopeRef = useRef<PersistedEnvelope>(initialBoot.envelope);
  const ensuredUidRef = useRef<string | null>(null);
  const cloudTxIdsRef = useRef<Set<string>>(new Set());
  const cloudEmpIdsRef = useRef<Set<string>>(new Set());
  const cloudConfigExistsRef = useRef<boolean>(false);

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
    const t = setTimeout(() => setToastMsg(''), 3400);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Hydrate from IndexedDB on startup if IndexedDB has a newer snapshot than localStorage/window.name
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
        setLastUpdatedAt(idbEnv.updatedAt);
        saveEnvelopeSync(idbEnv);
      }
      setIdbReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Multi-layer instant auto-save whenever state, activeTab, or historyLog changes
  const persistEnvelope = useCallback(
    (
      nextState: AppState,
      nextTab: TabType,
      nextHistory: HistoryEntry[],
      unsynced: boolean,
      stamp = Date.now()
    ) => {
      const env: PersistedEnvelope = {
        state: nextState,
        activeTab: nextTab,
        historyLog: nextHistory,
        hasUnsyncedLocalChanges: unsynced,
        updatedAt: stamp,
      };
      envelopeRef.current = env;
      setLastUpdatedAt(stamp);
      saveEnvelopeSync(env);
      void writeIndexedDbEnvelope(env);
    },
    []
  );

  useEffect(() => {
    if (!idbReady) return;
    const stamp = lastUpdatedAt || Date.now();
    persistEnvelope(appState, activeTab, historyLog, hasUnsyncedLocal, stamp);
  }, [appState, activeTab, historyLog, hasUnsyncedLocal, idbReady, lastUpdatedAt, persistEnvelope]);

  const appendHistory = useCallback(
    (action: string, detail: string): HistoryEntry[] => {
      const entry: HistoryEntry = {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        action,
        detail,
      };
      const next = [entry, ...envelopeRef.current.historyLog].slice(0, 50);
      setHistoryLog(next);
      return next;
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
    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: u.uid,
          email: clampStr(u.email || '', 200),
          displayName: clampStr(u.displayName || 'Admin SRT 39', 150),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, {
          email: clampStr(u.email || '', 200),
          displayName: clampStr(u.displayName || 'Admin SRT 39', 150),
          updatedAt: serverTimestamp(),
        });
      }
      ensuredUidRef.current = u.uid;
      return true;
    } catch (error) {
      logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
      return false;
    }
  }, []);

  const syncSettingsToCloud = useCallback(
    async (nextState: AppState) => {
      if (!user || !user.emailVerified) return;
      setSyncState('syncing');
      try {
        const ok = await ensureUserProfile(user);
        if (!ok) {
          setSyncState('offline');
          return;
        }
        const configRef = doc(db, 'users', user.uid, 'settings', 'config');
        if (cloudConfigExistsRef.current) {
          await updateDoc(configRef, buildSettingsPayload(nextState, user.uid, false));
        } else {
          const snap = await getDoc(configRef);
          if (snap.exists()) {
            cloudConfigExistsRef.current = true;
            await updateDoc(configRef, buildSettingsPayload(nextState, user.uid, false));
          } else {
            await setDoc(configRef, buildSettingsPayload(nextState, user.uid, true));
            cloudConfigExistsRef.current = true;
          }
        }
        setHasUnsyncedLocal(false);
        setSyncState('synced');
      } catch (error) {
        setSyncState('offline');
        logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${user.uid}/settings/config`);
      }
    },
    [user, ensureUserProfile]
  );

  // Firebase Auth & Real-time Firestore Subscriptions
  useEffect(() => {
    let unsubTx: (() => void) | null = null;
    let unsubEmp: (() => void) | null = null;
    let unsubSettings: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubTx) unsubTx();
      if (unsubEmp) unsubEmp();
      if (unsubSettings) unsubSettings();
      unsubTx = null;
      unsubEmp = null;
      unsubSettings = null;
      ensuredUidRef.current = null;
      cloudTxIdsRef.current.clear();
      cloudEmpIdsRef.current.clear();
      cloudConfigExistsRef.current = false;

      setUser(currentUser);
      setAuthReady(true);

      if (!currentUser || !currentUser.emailVerified) {
        setSyncState('local');
        return;
      }

      setSyncState('syncing');
      try {
        const profileOk = await ensureUserProfile(currentUser);
        if (!profileOk) {
          setSyncState('offline');
          return;
        }

        const txCol = collection(db, 'users', currentUser.uid, 'transactions');
        const empCol = collection(db, 'users', currentUser.uid, 'employees');
        const txQuery = query(txCol, where('ownerId', '==', currentUser.uid));
        const empQuery = query(empCol, where('ownerId', '==', currentUser.uid));
        const configRef = doc(db, 'users', currentUser.uid, 'settings', 'config');

        const [txSnap, empSnap, cfgSnap] = await Promise.all([
          getDocs(txQuery),
          getDocs(empQuery),
          getDoc(configRef),
        ]);

        const existingTxIds = new Set(txSnap.docs.map((d) => d.id));
        const existingEmpIds = new Set(empSnap.docs.map((d) => d.id));
        cloudTxIdsRef.current = existingTxIds;
        cloudEmpIdsRef.current = existingEmpIds;
        cloudConfigExistsRef.current = cfgSnap.exists();

        const localEnv = envelopeRef.current;

        // Upload initial data OR merge unsynced pre-login local edits safely
        if (
          (txSnap.empty && empSnap.empty && !cfgSnap.exists()) ||
          localEnv.hasUnsyncedLocalChanges
        ) {
          const batch = writeBatch(db);
          localEnv.state.transactions.forEach((tx) => {
            const safeId = sanitizeFirestoreId(tx.id);
            const ref = doc(db, 'users', currentUser.uid, 'transactions', safeId);
            if (existingTxIds.has(safeId)) {
              batch.update(ref, buildTxPayload(tx, currentUser.uid, false));
            } else {
              batch.set(ref, buildTxPayload(tx, currentUser.uid, true));
              existingTxIds.add(safeId);
            }
          });
          localEnv.state.masterEmployees.forEach((emp) => {
            const safeId = sanitizeFirestoreId(emp.id);
            const ref = doc(db, 'users', currentUser.uid, 'employees', safeId);
            if (existingEmpIds.has(safeId)) {
              batch.update(ref, buildEmployeePayload(emp, currentUser.uid, false));
            } else {
              batch.set(ref, buildEmployeePayload(emp, currentUser.uid, true));
              existingEmpIds.add(safeId);
            }
          });
          if (cfgSnap.exists()) {
            batch.update(configRef, buildSettingsPayload(localEnv.state, currentUser.uid, false));
          } else {
            batch.set(configRef, buildSettingsPayload(localEnv.state, currentUser.uid, true));
            cloudConfigExistsRef.current = true;
          }
          await batch.commit();
          setHasUnsyncedLocal(false);
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
                category: (data.category as CategoryType) || 'ekskul',
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
            setAppState((prev) => ({ ...prev, transactions: remoteTx }));
            setLastUpdatedAt(Date.now());
            setSyncState('synced');
          },
          (error) => {
            setSyncState('offline');
            logAndCaptureFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/transactions`);
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
                category: (data.category as CategoryType) || 'ekskul',
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
            setAppState((prev) => ({ ...prev, masterEmployees: remoteEmp }));
            setLastUpdatedAt(Date.now());
            setSyncState('synced');
          },
          (error) => {
            setSyncState('offline');
            logAndCaptureFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/employees`);
          }
        );

        unsubSettings = onSnapshot(
          configRef,
          (snap) => {
            if (!snap.exists()) return;
            cloudConfigExistsRef.current = true;
            const d = snap.data();
            setAppState((prev) => ({
              ...prev,
              officials: {
                ppkName: String(d.ppkName || DEFAULT_OFFICIALS.ppkName),
                ppkNip: String(d.ppkNip || DEFAULT_OFFICIALS.ppkNip),
                bendName: String(d.bendName || DEFAULT_OFFICIALS.bendName),
                bendNip: String(d.bendNip || DEFAULT_OFFICIALS.bendNip),
                kepsekName: String(d.kepsekName || DEFAULT_OFFICIALS.kepsekName),
                kepsekNip: String(d.kepsekNip || DEFAULT_OFFICIALS.kepsekNip),
              },
              customMainTitle: String(d.customMainTitle || DEFAULT_CUSTOM_MAIN_TITLE),
              customActivityTitle: String(d.customActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE),
              currentMonth: String(d.currentMonth || prev.currentMonth),
              currentCategory:
                d.currentCategory === 'ekskul' ||
                d.currentCategory === 'gurutamu' ||
                d.currentCategory === 'lainnya'
                  ? d.currentCategory
                  : prev.currentCategory,
            }));
            setLastUpdatedAt(Date.now());
            setSyncState('synced');
          },
          (error) => {
            setSyncState('offline');
            logAndCaptureFirestoreError(error, OperationType.GET, `users/${currentUser.uid}/settings/config`);
          }
        );
      } catch (error) {
        setSyncState('offline');
        logAndCaptureFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
      }
    });

    return () => {
      unsubAuth();
      if (unsubTx) unsubTx();
      if (unsubEmp) unsubEmp();
      if (unsubSettings) unsubSettings();
    };
  }, [ensureUserProfile]);

  const handleGoogleSignIn = async (): Promise<void> => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Berhasil masuk dengan Google. Riwayat disinkronkan ke Cloud.');
    } catch (err) {
      console.error('Login Google gagal:', err);
      showToast('Login Google dibatalkan atau pop-up diblokir. Data tetap tersimpan otomatis di perangkat.');
    }
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut(auth);
      setSyncState('local');
      showToast('Keluar dari akun Cloud. Mode simpan otomatis perangkat aktif.');
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
    persistEnvelope(appState, tab, historyLog, hasUnsyncedLocal, stamp);
  };

  const handleCategoryChange = (cat: CategoryType): void => {
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentCategory: cat };
    const stamp = Date.now();
    const nextUnsynced = !(user && user.emailVerified) ? true : hasUnsyncedLocal;
    setAppState(nextState);
    setHasUnsyncedLocal(nextUnsynced);
    persistEnvelope(nextState, activeTab, historyLog, nextUnsynced, stamp);
    if (user && user.emailVerified) {
      void syncSettingsToCloud(nextState);
    }
  };

  const handleMonthChange = (month: string): void => {
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentMonth: month };
    const stamp = Date.now();
    const nextUnsynced = !(user && user.emailVerified) ? true : hasUnsyncedLocal;
    setAppState(nextState);
    setHasUnsyncedLocal(nextUnsynced);
    persistEnvelope(nextState, activeTab, historyLog, nextUnsynced, stamp);
    if (user && user.emailVerified) {
      void syncSettingsToCloud(nextState);
    }
  };

  const handleSubmitTx = async (tx: Transaction, isEdit: boolean): Promise<void> => {
    const safeId = sanitizeFirestoreId(tx.id);
    const normalizedTx: Transaction = { ...tx, id: safeId };

    const nextList = isEdit
      ? appState.transactions.map((item) => (item.id === normalizedTx.id ? normalizedTx : item))
      : [...appState.transactions, normalizedTx];
    const nextState: AppState = { ...appState, transactions: nextList };
    const nextHist = appendHistory(
      isEdit ? 'Edit SPJ' : 'Tambah SPJ',
      `${normalizedTx.nama} · ${normalizedTx.jenis} (${normalizedTx.bulan} 2026)`
    );
    const isCloud = Boolean(user && user.emailVerified);
    const stamp = Date.now();

    setAppState(nextState);
    setHasUnsyncedLocal(!isCloud);
    setEditingTx(null);
    persistEnvelope(nextState, activeTab, nextHist, !isCloud, stamp);
    showToast(isEdit ? 'Perubahan SPJ tersimpan otomatis.' : 'Entri SPJ baru tersimpan otomatis.');

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        await ensureUserProfile(user);
        const txRef = doc(db, 'users', user.uid, 'transactions', safeId);
        if (cloudTxIdsRef.current.has(safeId)) {
          await updateDoc(txRef, buildTxPayload(normalizedTx, user.uid, false));
        } else {
          await setDoc(txRef, buildTxPayload(normalizedTx, user.uid, true));
          cloudTxIdsRef.current.add(safeId);
        }
        setSyncState('synced');
      } catch (error) {
        setHasUnsyncedLocal(true);
        setSyncState('offline');
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
        const nextState: AppState = {
          ...appState,
          transactions: appState.transactions.filter((item) => item.id !== tx.id),
        };
        const nextHist = appendHistory('Hapus SPJ', `${tx.nama} · ${tx.noBukti}`);
        const isCloud = Boolean(user && user.emailVerified);
        persistEnvelope(nextState, activeTab, nextHist, !isCloud, Date.now());

        setAppState(nextState);
        setHasUnsyncedLocal(!isCloud);
        if (editingTx?.id === tx.id) setEditingTx(null);
        showToast('Entri SPJ berhasil dihapus.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          const safeId = sanitizeFirestoreId(tx.id);
          try {
            await deleteDoc(doc(db, 'users', user.uid, 'transactions', safeId));
            cloudTxIdsRef.current.delete(safeId);
            setSyncState('synced');
          } catch (error) {
            setSyncState('offline');
            logAndCaptureFirestoreError(error, OperationType.DELETE, `users/${user.uid}/transactions/${safeId}`);
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
      id: sanitizeFirestoreId(`tx-${Date.now()}-${i}`),
      bulan: targetMonth,
      tanggal: src.tanggal.replace(/Oktober/gi, targetMonth),
      noBukti: src.noBukti.replace(/\/X\//g, `/${targetRoman}/`),
    }));

    const nextState: AppState = {
      ...appState,
      transactions: [...appState.transactions, ...clonedList],
    };
    const nextHist = appendHistory(
      'Salin Bulan Oktober',
      `${clonedList.length} entri disalin ke ${targetMonth} 2026`
    );
    const isCloud = Boolean(user && user.emailVerified);
    persistEnvelope(nextState, activeTab, nextHist, !isCloud, Date.now());

    setAppState(nextState);
    setHasUnsyncedLocal(!isCloud);
    showToast(`${clonedList.length} entri disalin dari Oktober ke ${targetMonth} 2026.`);

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        await ensureUserProfile(user);
        const batch = writeBatch(db);
        clonedList.forEach((tx) => {
          batch.set(
            doc(db, 'users', user.uid, 'transactions', tx.id),
            buildTxPayload(tx, user.uid, true)
          );
          cloudTxIdsRef.current.add(tx.id);
        });
        await batch.commit();
        setSyncState('synced');
      } catch (error) {
        setHasUnsyncedLocal(true);
        setSyncState('offline');
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
    const nextHist = appendHistory('Simpan Pejabat', `Kepala Sekolah: ${nextOfficials.kepsekName}`);
    const isCloud = Boolean(user && user.emailVerified);
    persistEnvelope(nextState, activeTab, nextHist, !isCloud, Date.now());
    setAppState(nextState);
    setHasUnsyncedLocal(!isCloud);
    showToast('Data Pejabat Penandatangan & Judul berhasil disimpan otomatis.');
    if (user && user.emailVerified) {
      await syncSettingsToCloud(nextState);
    }
  };

  const handleAddEmployee = async (emp: MasterEmployee): Promise<void> => {
    const safeId = sanitizeFirestoreId(emp.id);
    const normalizedEmp: MasterEmployee = { ...emp, id: safeId };
    const nextState: AppState = {
      ...appState,
      masterEmployees: [...appState.masterEmployees, normalizedEmp],
    };
    const nextHist = appendHistory('Tambah Pegawai Master', `${normalizedEmp.nama} (${normalizedEmp.jenis})`);
    const isCloud = Boolean(user && user.emailVerified);
    persistEnvelope(nextState, activeTab, nextHist, !isCloud, Date.now());
    setAppState(nextState);
    setHasUnsyncedLocal(!isCloud);
    showToast('Pegawai master ditambahkan dan tersimpan otomatis.');

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        await ensureUserProfile(user);
        await setDoc(
          doc(db, 'users', user.uid, 'employees', safeId),
          buildEmployeePayload(normalizedEmp, user.uid, true)
        );
        cloudEmpIdsRef.current.add(safeId);
        setSyncState('synced');
      } catch (error) {
        setHasUnsyncedLocal(true);
        setSyncState('offline');
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
        const nextState: AppState = {
          ...appState,
          masterEmployees: appState.masterEmployees.filter((item) => item.id !== emp.id),
        };
        const nextHist = appendHistory('Hapus Pegawai Master', emp.nama);
        const isCloud = Boolean(user && user.emailVerified);
        persistEnvelope(nextState, activeTab, nextHist, !isCloud, Date.now());
        setAppState(nextState);
        setHasUnsyncedLocal(!isCloud);
        showToast('Pegawai master dihapus.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          const safeId = sanitizeFirestoreId(emp.id);
          try {
            await deleteDoc(doc(db, 'users', user.uid, 'employees', safeId));
            cloudEmpIdsRef.current.delete(safeId);
            setSyncState('synced');
          } catch (error) {
            setSyncState('offline');
            logAndCaptureFirestoreError(error, OperationType.DELETE, `users/${user.uid}/employees/${safeId}`);
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
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}')) as Partial<AppState>;
        const nextState = normalizeAppState({
          ...appState,
          ...parsed,
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : appState.transactions,
          masterEmployees: Array.isArray(parsed.masterEmployees)
            ? parsed.masterEmployees
            : appState.masterEmployees,
          officials: parsed.officials ? { ...DEFAULT_OFFICIALS, ...parsed.officials } : appState.officials,
        });
        const nextHist = appendHistory(
          'Pulihkan JSON',
          `${nextState.transactions.length} entri SPJ & ${nextState.masterEmployees.length} pegawai`
        );
        const isCloud = Boolean(user && user.emailVerified);
        persistEnvelope(nextState, activeTab, nextHist, !isCloud, Date.now());
        setAppState(nextState);
        setHasUnsyncedLocal(!isCloud);
        showToast('Data berhasil dipulihkan dari file JSON.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          await ensureUserProfile(user);
          const batch = writeBatch(db);
          nextState.transactions.forEach((tx) => {
            const sid = sanitizeFirestoreId(tx.id);
            const ref = doc(db, 'users', user.uid, 'transactions', sid);
            if (cloudTxIdsRef.current.has(sid)) {
              batch.update(ref, buildTxPayload(tx, user.uid, false));
            } else {
              batch.set(ref, buildTxPayload(tx, user.uid, true));
              cloudTxIdsRef.current.add(sid);
            }
          });
          nextState.masterEmployees.forEach((emp) => {
            const sid = sanitizeFirestoreId(emp.id);
            const ref = doc(db, 'users', user.uid, 'employees', sid);
            if (cloudEmpIdsRef.current.has(sid)) {
              batch.update(ref, buildEmployeePayload(emp, user.uid, false));
            } else {
              batch.set(ref, buildEmployeePayload(emp, user.uid, true));
              cloudEmpIdsRef.current.add(sid);
            }
          });
          const cfgRef = doc(db, 'users', user.uid, 'settings', 'config');
          if (cloudConfigExistsRef.current) {
            batch.update(cfgRef, buildSettingsPayload(nextState, user.uid, false));
          } else {
            batch.set(cfgRef, buildSettingsPayload(nextState, user.uid, true));
            cloudConfigExistsRef.current = true;
          }
          await batch.commit();
          setHasUnsyncedLocal(false);
          setSyncState('synced');
        }
      } catch (err) {
        console.error('Impor JSON gagal:', err);
        showToast('Format file JSON tidak valid.');
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
        const nextHist = appendHistory('Reset Data Awal', 'Dikembalikan ke data default TA 2026');
        const isCloud = Boolean(user && user.emailVerified);
        persistEnvelope(fresh, activeTab, nextHist, !isCloud, Date.now());
        setAppState(fresh);
        setHasUnsyncedLocal(!isCloud);
        setEditingTx(null);
        showToast('Seluruh data dikembalikan ke pengaturan awal 2026.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          try {
            await ensureUserProfile(user);
            const [curTx, curEmp] = await Promise.all([
              getDocs(query(collection(db, 'users', user.uid, 'transactions'), where('ownerId', '==', user.uid))),
              getDocs(query(collection(db, 'users', user.uid, 'employees'), where('ownerId', '==', user.uid))),
            ]);
            const batch = writeBatch(db);
            curTx.docs.forEach((d) => batch.delete(d.ref));
            curEmp.docs.forEach((d) => batch.delete(d.ref));
            const nextTxIds = new Set<string>();
            const nextEmpIds = new Set<string>();
            fresh.transactions.forEach((tx) => {
              const sid = sanitizeFirestoreId(tx.id);
              batch.set(
                doc(db, 'users', user.uid, 'transactions', sid),
                buildTxPayload(tx, user.uid, true)
              );
              nextTxIds.add(sid);
            });
            fresh.masterEmployees.forEach((emp) => {
              const sid = sanitizeFirestoreId(emp.id);
              batch.set(
                doc(db, 'users', user.uid, 'employees', sid),
                buildEmployeePayload(emp, user.uid, true)
              );
              nextEmpIds.add(sid);
            });
            const cfgRef = doc(db, 'users', user.uid, 'settings', 'config');
            if (cloudConfigExistsRef.current) {
              batch.update(cfgRef, buildSettingsPayload(fresh, user.uid, false));
            } else {
              batch.set(cfgRef, buildSettingsPayload(fresh, user.uid, true));
              cloudConfigExistsRef.current = true;
            }
            await batch.commit();
            cloudTxIdsRef.current = nextTxIds;
            cloudEmpIdsRef.current = nextEmpIds;
            setHasUnsyncedLocal(false);
            setSyncState('synced');
          } catch (error) {
            setSyncState('offline');
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

            <div className="flex items-center gap-2 text-xs text-slate-600">
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
                    Tersimpan di perangkat (Cloud luring)
                    {lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Tersimpan di perangkat{lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Warning Banner if browser iframe restricts localStorage and user hasn't signed in to Cloud */}
      {!initialBoot.localStorageWritable && !user && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-6 py-2.5 no-print">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Browser ini membatasi penyimpanan lokal. Masuk dengan Google agar riwayat tersimpan permanen di Cloud saat halaman dimuat ulang.
              </span>
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap self-start sm:self-auto"
            >
              Aktifkan Sinkron Cloud
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
