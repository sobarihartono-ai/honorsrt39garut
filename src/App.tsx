import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  FileCheck2,
  FileSpreadsheet,
  FileText,
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
  DEFAULT_TRANSACTIONS,
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
  MasterEmployee,
  Officials,
  PrintJobMeta,
  TabType,
  Transaction,
} from './types';
import { clampStr, sanitizeFirestoreId } from './utils/formatters';

const STORAGE_KEY = 'srt39_honor_transpor_v4';

function loadLocalState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_STATE;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : DEFAULT_TRANSACTIONS,
      masterEmployees: Array.isArray(parsed.masterEmployees)
        ? parsed.masterEmployees
        : DEFAULT_MASTER_EMPLOYEES,
      officials: parsed.officials ? { ...DEFAULT_OFFICIALS, ...parsed.officials } : DEFAULT_OFFICIALS,
      customMainTitle:
        typeof parsed.customMainTitle === 'string' && parsed.customMainTitle.trim()
          ? parsed.customMainTitle
          : DEFAULT_CUSTOM_MAIN_TITLE,
      customActivityTitle:
        typeof parsed.customActivityTitle === 'string' && parsed.customActivityTitle.trim()
          ? parsed.customActivityTitle
          : DEFAULT_CUSTOM_ACTIVITY_TITLE,
      currentMonth: typeof parsed.currentMonth === 'string' ? parsed.currentMonth : 'November',
      currentCategory:
        parsed.currentCategory === 'ekskul' ||
        parsed.currentCategory === 'gurutamu' ||
        parsed.currentCategory === 'lainnya'
          ? parsed.currentCategory
          : 'gurutamu',
    };
  } catch {
    return DEFAULT_APP_STATE;
  }
}

function saveLocalState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Gagal menulis localStorage:', err);
  }
}

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

export default function App() {
  const [appState, setAppState] = useState<AppState>(() => loadLocalState());
  const [activeTab, setActiveTab] = useState<TabType>('kelola');
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [dhFilterId, setDhFilterId] = useState<string>('ALL');
  const [ttFilterId, setTtFilterId] = useState<string>('ALL');

  const [printJob, setPrintJob] = useState<PrintJobMeta | null>(null);
  const [lastPrintSnapshot, setLastPrintSnapshot] = useState<PrintJobMeta | null>(null);
  const [toastMsg, setToastMsg] = useState<string>('');

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced' | 'offline'>('local');

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
    const t = setTimeout(() => setToastMsg(''), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Auto-save to localStorage immediately on every state change
  useEffect(() => {
    saveLocalState(appState);
  }, [appState]);

  // Verify Firestore connection on startup
  useEffect(() => {
    testConnection().then((ok) => {
      if (!ok) setSyncState('offline');
    });
  }, []);

  const ensureUserProfile = useCallback(async (u: User) => {
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
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
    }
  }, []);

  const syncSettingsToCloud = useCallback(
    async (nextState: AppState) => {
      if (!user || !user.emailVerified) return;
      setSyncState('syncing');
      try {
        await ensureUserProfile(user);
        const configRef = doc(db, 'users', user.uid, 'settings', 'config');
        const snap = await getDoc(configRef);
        if (snap.exists()) {
          await updateDoc(configRef, buildSettingsPayload(nextState, user.uid, false));
        } else {
          await setDoc(configRef, buildSettingsPayload(nextState, user.uid, true));
        }
        setSyncState('synced');
      } catch (error) {
        setSyncState('offline');
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/settings/config`);
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

      setUser(currentUser);
      setAuthReady(true);

      if (!currentUser || !currentUser.emailVerified) {
        setSyncState('local');
        return;
      }

      setSyncState('syncing');
      try {
        await ensureUserProfile(currentUser);

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

        if (txSnap.empty && empSnap.empty && !cfgSnap.exists()) {
          const snapshotLocal = loadLocalState();
          const batch = writeBatch(db);
          snapshotLocal.transactions.forEach((tx) => {
            const safeId = sanitizeFirestoreId(tx.id);
            batch.set(
              doc(db, 'users', currentUser.uid, 'transactions', safeId),
              buildTxPayload(tx, currentUser.uid, true)
            );
          });
          snapshotLocal.masterEmployees.forEach((emp) => {
            const safeId = sanitizeFirestoreId(emp.id);
            batch.set(
              doc(db, 'users', currentUser.uid, 'employees', safeId),
              buildEmployeePayload(emp, currentUser.uid, true)
            );
          });
          batch.set(configRef, buildSettingsPayload(snapshotLocal, currentUser.uid, true));
          await batch.commit();
        }

        unsubTx = onSnapshot(
          txQuery,
          (snap) => {
            const remoteTx: Transaction[] = snap.docs.map((d) => {
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
            setAppState((prev) => ({ ...prev, transactions: remoteTx }));
            setSyncState('synced');
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/transactions`);
          }
        );

        unsubEmp = onSnapshot(
          empQuery,
          (snap) => {
            const remoteEmp: MasterEmployee[] = snap.docs.map((d) => {
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
            setAppState((prev) => ({ ...prev, masterEmployees: remoteEmp }));
            setSyncState('synced');
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/employees`);
          }
        );

        unsubSettings = onSnapshot(
          configRef,
          (snap) => {
            if (!snap.exists()) return;
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
            setSyncState('synced');
          },
          (error) => {
            handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}/settings/config`);
          }
        );
      } catch (error) {
        setSyncState('offline');
        handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
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
      showToast('Berhasil masuk dengan Google. Sinkronisasi Cloud aktif.');
    } catch (err) {
      console.error('Login Google gagal:', err);
      showToast('Login Google dibatalkan atau gagal. Data tetap tersimpan otomatis di perangkat.');
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

  // Filtered transactions for active category & month
  const filteredTransactions = useMemo(() => {
    return appState.transactions.filter((t) => {
      const catMatch = t.category === appState.currentCategory;
      const monthMatch = appState.currentMonth === 'ALL' || t.bulan === appState.currentMonth;
      return catMatch && monthMatch;
    });
  }, [appState.transactions, appState.currentCategory, appState.currentMonth]);

  // Keep DH & TT filter selection valid
  useEffect(() => {
    if (dhFilterId !== 'ALL' && !filteredTransactions.some((t) => t.id === dhFilterId)) {
      setDhFilterId('ALL');
    }
    if (ttFilterId !== 'ALL' && !filteredTransactions.some((t) => t.id === ttFilterId)) {
      setTtFilterId('ALL');
    }
  }, [filteredTransactions, dhFilterId, ttFilterId]);

  const handleCategoryChange = (cat: CategoryType): void => {
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentCategory: cat };
    setAppState(nextState);
    if (user && user.emailVerified) {
      void syncSettingsToCloud(nextState);
    }
  };

  const handleMonthChange = (month: string): void => {
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentMonth: month };
    setAppState(nextState);
    if (user && user.emailVerified) {
      void syncSettingsToCloud(nextState);
    }
  };

  const handleSubmitTx = async (tx: Transaction, isEdit: boolean): Promise<void> => {
    const safeId = sanitizeFirestoreId(tx.id);
    const normalizedTx: Transaction = { ...tx, id: safeId };

    setAppState((prev) => {
      const nextList = isEdit
        ? prev.transactions.map((item) => (item.id === normalizedTx.id ? normalizedTx : item))
        : [...prev.transactions, normalizedTx];
      return { ...prev, transactions: nextList };
    });
    setEditingTx(null);
    showToast(isEdit ? 'Perubahan entri SPJ disimpan otomatis.' : 'Entri SPJ baru disimpan otomatis.');

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        await ensureUserProfile(user);
        const txRef = doc(db, 'users', user.uid, 'transactions', safeId);
        const existing = await getDoc(txRef);
        if (existing.exists()) {
          await updateDoc(txRef, buildTxPayload(normalizedTx, user.uid, false));
        } else {
          await setDoc(txRef, buildTxPayload(normalizedTx, user.uid, true));
        }
        setSyncState('synced');
      } catch (error) {
        setSyncState('offline');
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/transactions/${safeId}`);
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
        setAppState((prev) => ({
          ...prev,
          transactions: prev.transactions.filter((item) => item.id !== tx.id),
        }));
        if (editingTx?.id === tx.id) setEditingTx(null);
        showToast('Entri SPJ berhasil dihapus.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          const safeId = sanitizeFirestoreId(tx.id);
          try {
            await deleteDoc(doc(db, 'users', user.uid, 'transactions', safeId));
            setSyncState('synced');
          } catch (error) {
            setSyncState('offline');
            handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/transactions/${safeId}`);
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

    setAppState((prev) => ({
      ...prev,
      transactions: [...prev.transactions, ...clonedList],
    }));
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
        });
        await batch.commit();
        setSyncState('synced');
      } catch (error) {
        setSyncState('offline');
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/transactions`);
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
    setAppState(nextState);
    showToast('Data Pejabat Penandatangan & Judul berhasil disimpan otomatis.');
    if (user && user.emailVerified) {
      await syncSettingsToCloud(nextState);
    }
  };

  const handleAddEmployee = async (emp: MasterEmployee): Promise<void> => {
    const safeId = sanitizeFirestoreId(emp.id);
    const normalizedEmp: MasterEmployee = { ...emp, id: safeId };
    setAppState((prev) => ({
      ...prev,
      masterEmployees: [...prev.masterEmployees, normalizedEmp],
    }));
    showToast('Pegawai master ditambahkan dan tersimpan otomatis.');

    if (user && user.emailVerified) {
      setSyncState('syncing');
      try {
        await ensureUserProfile(user);
        await setDoc(
          doc(db, 'users', user.uid, 'employees', safeId),
          buildEmployeePayload(normalizedEmp, user.uid, true)
        );
        setSyncState('synced');
      } catch (error) {
        setSyncState('offline');
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/employees/${safeId}`);
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
        setAppState((prev) => ({
          ...prev,
          masterEmployees: prev.masterEmployees.filter((item) => item.id !== emp.id),
        }));
        showToast('Pegawai master dihapus.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          const safeId = sanitizeFirestoreId(emp.id);
          try {
            await deleteDoc(doc(db, 'users', user.uid, 'employees', safeId));
            setSyncState('synced');
          } catch (error) {
            setSyncState('offline');
            handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/employees/${safeId}`);
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
        const nextState: AppState = {
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : appState.transactions,
          masterEmployees: Array.isArray(parsed.masterEmployees)
            ? parsed.masterEmployees
            : appState.masterEmployees,
          officials: parsed.officials ? { ...DEFAULT_OFFICIALS, ...parsed.officials } : appState.officials,
          customMainTitle:
            typeof parsed.customMainTitle === 'string' && parsed.customMainTitle.trim()
              ? parsed.customMainTitle
              : appState.customMainTitle,
          customActivityTitle:
            typeof parsed.customActivityTitle === 'string' && parsed.customActivityTitle.trim()
              ? parsed.customActivityTitle
              : appState.customActivityTitle,
          currentMonth:
            typeof parsed.currentMonth === 'string' ? parsed.currentMonth : appState.currentMonth,
          currentCategory:
            parsed.currentCategory === 'ekskul' ||
            parsed.currentCategory === 'gurutamu' ||
            parsed.currentCategory === 'lainnya'
              ? parsed.currentCategory
              : appState.currentCategory,
        };
        setAppState(nextState);
        showToast('Data berhasil dipulihkan dari file JSON.');

        if (user && user.emailVerified) {
          setSyncState('syncing');
          await ensureUserProfile(user);
          const batch = writeBatch(db);
          nextState.transactions.forEach((tx) => {
            const sid = sanitizeFirestoreId(tx.id);
            batch.set(
              doc(db, 'users', user.uid, 'transactions', sid),
              buildTxPayload(tx, user.uid, true)
            );
          });
          nextState.masterEmployees.forEach((emp) => {
            const sid = sanitizeFirestoreId(emp.id);
            batch.set(
              doc(db, 'users', user.uid, 'employees', sid),
              buildEmployeePayload(emp, user.uid, true)
            );
          });
          batch.set(
            doc(db, 'users', user.uid, 'settings', 'config'),
            buildSettingsPayload(nextState, user.uid, true)
          );
          await batch.commit();
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
        setAppState(fresh);
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
            fresh.transactions.forEach((tx) => {
              const sid = sanitizeFirestoreId(tx.id);
              batch.set(
                doc(db, 'users', user.uid, 'transactions', sid),
                buildTxPayload(tx, user.uid, true)
              );
            });
            fresh.masterEmployees.forEach((emp) => {
              const sid = sanitizeFirestoreId(emp.id);
              batch.set(
                doc(db, 'users', user.uid, 'employees', sid),
                buildEmployeePayload(emp, user.uid, true)
              );
            });
            batch.set(
              doc(db, 'users', user.uid, 'settings', 'config'),
              buildSettingsPayload(fresh, user.uid, true)
            );
            await batch.commit();
            setSyncState('synced');
          } catch (error) {
            setSyncState('offline');
            handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
          }
        }
      },
    });
  };

  const openPrintPreview = (job: PrintJobMeta): void => {
    setPrintJob(job);
    setLastPrintSnapshot(job);
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar (3-zone compact header: Brand | Desktop Tabs | Primary Cloud Auth CTA) */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 no-print">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Left: Brand */}
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

          {/* Center: Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Menu utama">
            {navItems.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
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

          {/* Right: Cloud Auth CTA */}
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

        {/* Tablet secondary tab bar (md only; lg uses top bar, mobile uses bottom bar) */}
        <div className="hidden md:flex lg:hidden border-t border-slate-800 px-4 py-2 gap-1.5 overflow-x-auto">
          {navItems.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
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
          {/* Category Switcher */}
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

          {/* Month Filter + Clone + Auto-save Status */}
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

            {/* Clean inline auto-save status (no pills, no pulsing dots) */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              {syncState === 'synced' ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Tersimpan otomatis di Cloud · Perangkat</span>
                </>
              ) : syncState === 'syncing' ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>Menyinkronkan data...</span>
                </>
              ) : syncState === 'offline' ? (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Mode luring · Tersimpan otomatis di perangkat</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Tersimpan otomatis di perangkat</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

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
          </div>
        )}

        {activeTab === 'rekap' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  Rekapitulasi Bulanan ({filteredTransactions.length} Entri)
                </h2>
                <p className="text-xs text-slate-500">
                  Format Resmi A4 Landscape · Siap unduh PDF atau cetak langsung
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  openPrintPreview({
                    docName: `Rekapitulasi_Honor_${appState.currentMonth}_2026`,
                    type: 'rekap',
                    items: filteredTransactions,
                  })
                }
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
              >
                <Printer className="w-4 h-4" />
                Cetak / Unduh PDF Rekap
              </button>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 shrink-0 transition"
              >
                <Printer className="w-4 h-4" />
                Cetak / Unduh PDF Daftar Hadir
              </button>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 shrink-0 transition"
              >
                <Printer className="w-4 h-4" />
                Cetak / Unduh PDF Tanda Terima
              </button>
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

      {/* Mobile Bottom Navigation Bar (Thumb-zone ergonomic tabs) */}
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
                onClick={() => setActiveTab(tab.id)}
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
