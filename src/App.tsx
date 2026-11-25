import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User, onAuthStateChanged } from 'firebase/auth';
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
  DEFAULT_OFFICIALS,
  MONTHS,
  MONTH_ROMAN,
} from './data/seedData';
import { auth, authPersistenceReady, ensureAnonymousSession } from './firebase';
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
import { sanitizeFirestoreId } from './utils/formatters';
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

interface WorkspaceApiResponse {
  state: AppState;
  historyLog: HistoryEntry[];
}

function formatSyncErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const msg = error instanceof Error ? error.message : String(error || '');

  if (code === 'auth/operation-not-allowed') {
    return 'Login anonim belum diaktifkan di Firebase Console.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Gagal terhubung ke layanan autentikasi. Periksa koneksi internet Anda.';
  }
  if (msg.includes('Sesi pratinjau')) {
    return msg;
  }
  if (
    error instanceof TypeError ||
    msg.toLowerCase().includes('failed to fetch') ||
    msg.toLowerCase().includes('networkerror')
  ) {
    return 'Tidak dapat menjangkau server. Periksa koneksi internet Anda lalu coba lagi.';
  }
  if (msg) {
    return msg;
  }
  return 'Gagal memuat pembaruan. Silakan coba sinkronkan ulang.';
}

async function apiRequest<T = { ok: boolean }>(
  path: string,
  options: RequestInit = {},
  targetUser?: User | null
): Promise<T> {
  let activeUser = targetUser || auth.currentUser || (await ensureAnonymousSession());
  if (!activeUser) {
    throw new Error('Sesi sinkronisasi otomatis belum siap.');
  }

  const doFetch = async (u: User, forceRefresh: boolean) => {
    const token = await u.getIdToken(forceRefresh);
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
    });
  };

  let res = await doFetch(activeUser, false);
  if (res.status === 401) {
    try {
      res = await doFetch(activeUser, true);
    } catch {
      // fallback to a fresh anonymous session below
    }
  }
  if (res.status === 401) {
    const freshAnon = await ensureAnonymousSession(true);
    if (freshAnon) {
      activeUser = freshAnon;
      res = await doFetch(freshAnon, false);
    }
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (res.redirected || contentType.includes('text/html')) {
      throw new Error(
        'Sesi pratinjau browser memblokir permintaan latar belakang. Coba buka aplikasi di tab baru.'
      );
    }
    throw new Error(`Server belum siap (kode ${res.status}). Silakan coba sinkronkan ulang.`);
  }

  if (!res.ok) {
    let errMsg = `Server mengembalikan kesalahan (${res.status}). Silakan coba sinkronkan ulang.`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed?.error) errMsg = parsed.error;
    } catch {
      // keep default error message
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as T;
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
  const hasUserChangedFilterRef = useRef<boolean>(false);
  const appliedInitialCloudSettingsRef = useRef<boolean>(false);
  const inFlightRefreshRef = useRef<Promise<boolean> | null>(null);
  const lastRefreshAtRef = useRef<number>(0);

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

  const flushPendingMutations = useCallback(
    async (targetUser?: User | null): Promise<boolean> => {
      const currentEnv = envelopeRef.current;
      if (!hasAnyPendingMutation(currentEnv.pendingMutations)) {
        setHasUnsyncedLocal(false);
        setSyncErrorMsg('');
        setSyncState('synced');
        return true;
      }

      setSyncState('syncing');
      try {
        const activeUser = targetUser || user || (await ensureAnonymousSession());
        if (!activeUser) {
          throw new Error('Koneksi sinkronisasi belum siap.');
        }

        const pending = currentEnv.pendingMutations;
        const txMap = new Map(
          currentEnv.state.transactions.map((t) => [sanitizeFirestoreId(t.id), t])
        );
        const empMap = new Map(
          currentEnv.state.masterEmployees.map((e) => [sanitizeFirestoreId(e.id), e])
        );
        const histMap = new Map(
          currentEnv.historyLog.map((h) => [sanitizeFirestoreId(h.id), h])
        );

        const deletedTxSet = new Set(pending.deletedTxIds.map(sanitizeFirestoreId));
        const deletedEmpSet = new Set(pending.deletedEmpIds.map(sanitizeFirestoreId));

        const upsertTransactions = pending.dirtyTxIds
          .map(sanitizeFirestoreId)
          .filter((id) => !deletedTxSet.has(id))
          .map((id) => txMap.get(id))
          .filter((tx): tx is Transaction => Boolean(tx));

        const upsertEmployees = pending.dirtyEmpIds
          .map(sanitizeFirestoreId)
          .filter((id) => !deletedEmpSet.has(id))
          .map((id) => empMap.get(id))
          .filter((emp): emp is MasterEmployee => Boolean(emp));

        const historyEntries = pending.dirtyHistoryIds
          .map(sanitizeFirestoreId)
          .map((id) => histMap.get(id))
          .filter((entry): entry is HistoryEntry => Boolean(entry));

        await apiRequest(
          '/api/workspace/sync-pending',
          {
            method: 'POST',
            body: JSON.stringify({
              upsertTransactions,
              deleteTxIds: Array.from(deletedTxSet),
              upsertEmployees,
              deleteEmpIds: Array.from(deletedEmpSet),
              historyEntries,
              settings: pending.dirtySettings
                ? {
                    officials: currentEnv.state.officials,
                    customMainTitle: currentEnv.state.customMainTitle,
                    customActivityTitle: currentEnv.state.customActivityTitle,
                    currentMonth: currentEnv.state.currentMonth,
                    currentCategory: currentEnv.state.currentCategory,
                  }
                : undefined,
            }),
          },
          activeUser
        );

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
        console.error('Flush pending mutations failed:', error);
        setSyncState('offline');
        setSyncErrorMsg('Sebagian perubahan belum tersinkron. Periksa koneksi internet lalu coba lagi.');
        return false;
      }
    },
    [user, persistEnvelope]
  );

  const applyServerSnapshot = useCallback(
    (snapshot: WorkspaceApiResponse) => {
      const pending = envelopeRef.current.pendingMutations;
      const mergedTx = mergeRemoteTransactions(
        snapshot.state.transactions,
        envelopeRef.current.state.transactions,
        pending
      );
      const mergedEmp = mergeRemoteEmployees(
        snapshot.state.masterEmployees,
        envelopeRef.current.state.masterEmployees,
        pending
      );
      const mergedHist = mergeHistoryLists(
        snapshot.historyLog,
        envelopeRef.current.historyLog,
        pending.dirtyHistoryIds
      );

      const shouldApplyFilterFromServer =
        !appliedInitialCloudSettingsRef.current && !hasUserChangedFilterRef.current;
      if (shouldApplyFilterFromServer) {
        appliedInitialCloudSettingsRef.current = true;
      }

      const nextState: AppState = pending.dirtySettings
        ? {
            ...envelopeRef.current.state,
            transactions: mergedTx,
            masterEmployees: mergedEmp,
          }
        : {
            ...envelopeRef.current.state,
            transactions: mergedTx,
            masterEmployees: mergedEmp,
            officials: {
              ppkName: snapshot.state.officials.ppkName || DEFAULT_OFFICIALS.ppkName,
              ppkNip: snapshot.state.officials.ppkNip ?? DEFAULT_OFFICIALS.ppkNip,
              bendName: snapshot.state.officials.bendName || DEFAULT_OFFICIALS.bendName,
              bendNip: snapshot.state.officials.bendNip ?? DEFAULT_OFFICIALS.bendNip,
              kepsekName: snapshot.state.officials.kepsekName || DEFAULT_OFFICIALS.kepsekName,
              kepsekNip: snapshot.state.officials.kepsekNip ?? DEFAULT_OFFICIALS.kepsekNip,
            },
            customMainTitle: snapshot.state.customMainTitle || DEFAULT_CUSTOM_MAIN_TITLE,
            customActivityTitle:
              snapshot.state.customActivityTitle || DEFAULT_CUSTOM_ACTIVITY_TITLE,
            currentMonth: shouldApplyFilterFromServer
              ? snapshot.state.currentMonth || envelopeRef.current.state.currentMonth
              : envelopeRef.current.state.currentMonth,
            currentCategory: shouldApplyFilterFromServer
              ? sanitizeCategory(snapshot.state.currentCategory)
              : envelopeRef.current.state.currentCategory,
          };

      const stillPending = hasAnyPendingMutation(pending);
      setAppState(nextState);
      setHistoryLog(mergedHist);
      setSyncErrorMsg('');
      setSyncState(stillPending ? 'offline' : 'synced');
      persistEnvelope(
        nextState,
        envelopeRef.current.activeTab,
        mergedHist,
        stillPending,
        pending
      );
      return { mergedTx, mergedHist };
    },
    [persistEnvelope]
  );

  const refreshFromCloud = useCallback(
    async (showSuccessToast = true, targetUser?: User | null): Promise<boolean> => {
      if (inFlightRefreshRef.current) {
        const ok = await inFlightRefreshRef.current;
        if (showSuccessToast && ok) {
          showToast(
            `Sinkronisasi selesai: ${envelopeRef.current.state.transactions.length} entri SPJ & ${envelopeRef.current.historyLog.length} riwayat.`
          );
        }
        return ok;
      }
      const now = Date.now();
      if (!showSuccessToast && now - lastRefreshAtRef.current < 4000) {
        return true;
      }
      lastRefreshAtRef.current = now;

      const run = (async (): Promise<boolean> => {
        setSyncState('syncing');
        try {
          const activeUser = targetUser || user || (await ensureAnonymousSession());
          if (!activeUser) {
            throw new Error('Sesi sinkronisasi otomatis belum siap.');
          }

          if (hasAnyPendingMutation(envelopeRef.current.pendingMutations)) {
            await flushPendingMutations(activeUser);
          }

          const snapshot = await apiRequest<WorkspaceApiResponse>(
            '/api/workspace',
            { method: 'GET' },
            activeUser
          );
          const { mergedTx, mergedHist } = applyServerSnapshot(snapshot);
          if (showSuccessToast) {
            showToast(
              `Sinkronisasi selesai: ${mergedTx.length} entri SPJ & ${mergedHist.length} riwayat.`
            );
          }
          return true;
        } catch (error) {
          console.error('Refresh workspace failed:', error);
          const readableErr = formatSyncErrorMessage(error);
          setSyncState('offline');
          if (showSuccessToast || !syncErrorMsg) {
            setSyncErrorMsg(readableErr);
          }
          if (showSuccessToast) {
            showToast(readableErr);
          }
          return false;
        } finally {
          inFlightRefreshRef.current = null;
        }
      })();

      inFlightRefreshRef.current = run;
      return run;
    },
    [user, syncErrorMsg, flushPendingMutations, applyServerSnapshot, showToast]
  );

  // Automatic silent session + initial sync + periodic cross-device polling
  useEffect(() => {
    let unsubAuth: (() => void) | null = null;
    let mounted = true;

    void authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
        if (!mounted) return;
        if (!currentUser) {
          setUser(null);
          try {
            const anonUser = await ensureAnonymousSession();
            if (!mounted) return;
            if (!anonUser) {
              setAuthReady(true);
              setSyncState('offline');
            }
          } catch (err) {
            console.error('Auto session init failed:', err);
            if (mounted) {
              setAuthReady(true);
              setSyncState('offline');
              setSyncErrorMsg(formatSyncErrorMessage(err));
            }
          }
          return;
        }

        setUser(currentUser);
        setAuthReady(true);
        await refreshFromCloud(false, currentUser);
      });
    });

    return () => {
      mounted = false;
      if (unsubAuth) unsubAuth();
    };
  }, [refreshFromCloud]);

  // Auto-sync across computers & phones when online, switching tabs, or every 15s while open
  useEffect(() => {
    const handleOnline = () => {
      void refreshFromCloud(false);
    };
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void refreshFromCloud(false);
      }
    };
    const pollId = window.setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        !hasAnyPendingMutation(envelopeRef.current.pendingMutations)
      ) {
        void refreshFromCloud(false);
      }
    }, 15000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [refreshFromCloud]);

  const syncSettingsToCloud = useCallback(
    async (nextState: AppState, markDirtyOnFail = true, newHistoryEntry?: HistoryEntry) => {
      setSyncState('syncing');
      try {
        await apiRequest('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            settings: {
              officials: nextState.officials,
              customMainTitle: nextState.customMainTitle,
              customActivityTitle: nextState.customActivityTitle,
              currentMonth: nextState.currentMonth,
              currentCategory: nextState.currentCategory,
            },
            historyEntry: newHistoryEntry,
          }),
        });

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
        console.error('Sync settings failed:', error);
        if (markDirtyOnFail) {
          const nextPending: PendingCloudMutations = {
            ...envelopeRef.current.pendingMutations,
            dirtySettings: true,
            dirtyHistoryIds: newHistoryEntry
              ? Array.from(
                  new Set([
                    ...envelopeRef.current.pendingMutations.dirtyHistoryIds,
                    newHistoryEntry.id,
                  ])
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
        setSyncErrorMsg('Pengaturan belum tersinkron. Klik Sinkronkan Ulang saat terhubung.');
      }
    },
    [persistEnvelope]
  );

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
    void syncSettingsToCloud(nextState, false);
  };

  const handleMonthChange = (month: string): void => {
    hasUserChangedFilterRef.current = true;
    setEditingTx(null);
    const nextState: AppState = { ...appState, currentMonth: month };
    const stamp = Date.now();
    setAppState(nextState);
    persistEnvelope(nextState, activeTab, historyLog, hasUnsyncedLocal, pendingMutations, stamp);
    void syncSettingsToCloud(nextState, false);
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
    showToast(isEdit ? 'Perubahan SPJ tersimpan otomatis.' : 'Entri SPJ baru tersimpan otomatis.');

    setSyncState('syncing');
    try {
      await apiRequest('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({ transaction: normalizedTx, historyEntry: newEntry }),
      });

      const cleanedPending: PendingCloudMutations = {
        ...envelopeRef.current.pendingMutations,
        dirtyTxIds: envelopeRef.current.pendingMutations.dirtyTxIds.filter((id) => id !== safeId),
        dirtyHistoryIds: envelopeRef.current.pendingMutations.dirtyHistoryIds.filter(
          (id) => id !== newEntry.id
        ),
      };
      envelopeRef.current.pendingMutations = cleanedPending;
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
      console.error('Save transaction to server failed:', error);
      setHasUnsyncedLocal(true);
      setSyncState('offline');
      setSyncErrorMsg('Perubahan tersimpan di perangkat dan akan disinkronkan saat koneksi normal.');
      showToast('Tersimpan di perangkat, sinkronisasi tertunda karena koneksi.');
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

        setSyncState('syncing');
        try {
          await apiRequest(`/api/transactions/${encodeURIComponent(safeId)}`, {
            method: 'DELETE',
            body: JSON.stringify({ historyEntry: newEntry }),
          });

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
          console.error('Delete transaction failed:', error);
          setSyncState('offline');
          setSyncErrorMsg('Penghapusan belum tersinkron. Klik Sinkronkan Ulang saat online.');
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

    setSyncState('syncing');
    try {
      await apiRequest('/api/transactions/batch', {
        method: 'POST',
        body: JSON.stringify({ transactions: clonedList, historyEntry: newEntry }),
      });

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
      console.error('Batch clone transactions failed:', error);
      setHasUnsyncedLocal(true);
      setSyncState('offline');
      setSyncErrorMsg('Hasil salin belum tersinkron. Klik Sinkronkan Ulang saat terhubung.');
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
    await syncSettingsToCloud(nextState, true, newEntry);
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

    setSyncState('syncing');
    try {
      await apiRequest('/api/employees', {
        method: 'POST',
        body: JSON.stringify({ employee: normalizedEmp, historyEntry: newEntry }),
      });

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
      console.error('Add employee failed:', error);
      setHasUnsyncedLocal(true);
      setSyncState('offline');
      setSyncErrorMsg('Pegawai master belum tersinkron. Klik Sinkronkan Ulang.');
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

        setSyncState('syncing');
        try {
          await apiRequest(`/api/employees/${encodeURIComponent(safeId)}`, {
            method: 'DELETE',
            body: JSON.stringify({ historyEntry: newEntry }),
          });

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
          console.error('Delete employee failed:', error);
          setSyncState('offline');
          setSyncErrorMsg('Penghapusan pegawai belum tersinkron. Klik Sinkronkan Ulang.');
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

      setSyncState('syncing');
      try {
        await apiRequest('/api/workspace/import', {
          method: 'POST',
          body: JSON.stringify({ state: nextState, historyEntry: newEntry }),
        });

        const cleared = { ...EMPTY_PENDING_MUTATIONS };
        setPendingMutations(cleared);
        setHasUnsyncedLocal(false);
        setSyncErrorMsg('');
        setSyncState('synced');
        persistEnvelope(nextState, activeTab, nextHistory, false, cleared);
      } catch (err) {
        console.error('Import JSON sync failed:', err);
        setSyncState('offline');
        setSyncErrorMsg('Data JSON tersimpan di perangkat, tetapi sinkronisasi tertunda.');
        showToast('Data dipulihkan di perangkat, sinkronisasi tertunda.');
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

        setSyncState('syncing');
        try {
          await apiRequest('/api/workspace/reset', {
            method: 'POST',
            body: JSON.stringify({ state: fresh, historyEntry: newEntry }),
          });

          const cleared = { ...EMPTY_PENDING_MUTATIONS };
          setPendingMutations(cleared);
          setHasUnsyncedLocal(false);
          setSyncErrorMsg('');
          setSyncState('synced');
          persistEnvelope(fresh, activeTab, nextHistory, false, cleared);
        } catch (error) {
          console.error('Reset sync failed:', error);
          setSyncState('offline');
          setSyncErrorMsg('Reset belum tersinkron. Klik Sinkronkan Ulang.');
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
            <button
              type="button"
              onClick={() => void refreshFromCloud(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
              title="Muat ulang data terbaru antar perangkat"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncState === 'syncing' ? 'animate-spin text-blue-400' : 'text-emerald-400'}`}
              />
              <span>Segarkan</span>
            </button>
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
                    Sinkron Otomatis Aktif · {appState.transactions.length} entri
                    {lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
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
                      ? 'Tersimpan di perangkat (Luring)'
                      : 'Koneksi sinkronisasi terputus'}
                    {lastSavedTimeStr ? ` · ${lastSavedTimeStr}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshFromCloud(true)}
                    className="ml-1 px-2 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold flex items-center gap-1 transition"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Sinkronkan Ulang
                  </button>
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="text-slate-600">
                    {authReady ? 'Menghubungkan sinkronisasi...' : 'Menyiapkan sinkronisasi otomatis...'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Warning Banner when sync encounters an offline error */}
      {syncErrorMsg && syncState === 'offline' && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-6 py-2.5 no-print">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{syncErrorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshFromCloud(true)}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap flex items-center gap-1.5 self-start sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sinkronkan Ulang
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
