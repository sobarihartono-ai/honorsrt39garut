import {
  DEFAULT_APP_STATE,
  DEFAULT_CUSTOM_ACTIVITY_TITLE,
  DEFAULT_CUSTOM_MAIN_TITLE,
  DEFAULT_MASTER_EMPLOYEES,
  DEFAULT_OFFICIALS,
  DEFAULT_TRANSACTIONS,
} from '../data/seedData';
import { AppState, HistoryEntry, TabType } from '../types';

const STORAGE_KEY = 'srt39_honor_transpor_v4';
const WINDOW_NAME_PREFIX = 'SRT39_SNAPSHOT_V1:';
const IDB_NAME = 'srt39_honor_db_v1';
const IDB_STORE = 'kv';
const IDB_KEY = 'workspace_snapshot';

export interface PendingCloudMutations {
  dirtyTxIds: string[];
  deletedTxIds: string[];
  dirtyEmpIds: string[];
  deletedEmpIds: string[];
  dirtySettings: boolean;
}

export const EMPTY_PENDING_MUTATIONS: PendingCloudMutations = {
  dirtyTxIds: [],
  deletedTxIds: [],
  dirtyEmpIds: [],
  deletedEmpIds: [],
  dirtySettings: false,
};

export interface PersistedEnvelope {
  state: AppState;
  activeTab: TabType;
  historyLog: HistoryEntry[];
  hasUnsyncedLocalChanges: boolean;
  pendingMutations: PendingCloudMutations;
  updatedAt: number;
}

export interface SyncWriteResult {
  localStorageOk: boolean;
  sessionStorageOk: boolean;
  windowNameOk: boolean;
}

function normalizePendingMutations(raw: unknown): PendingCloudMutations {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PENDING_MUTATIONS };
  const obj = raw as Record<string, unknown>;
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  return {
    dirtyTxIds: strArr(obj.dirtyTxIds),
    deletedTxIds: strArr(obj.deletedTxIds),
    dirtyEmpIds: strArr(obj.dirtyEmpIds),
    deletedEmpIds: strArr(obj.deletedEmpIds),
    dirtySettings: Boolean(obj.dirtySettings),
  };
}

export function hasAnyPendingMutation(m: PendingCloudMutations): boolean {
  return (
    m.dirtyTxIds.length > 0 ||
    m.deletedTxIds.length > 0 ||
    m.dirtyEmpIds.length > 0 ||
    m.deletedEmpIds.length > 0 ||
    m.dirtySettings
  );
}

export function normalizeAppState(raw?: Partial<AppState> | null): AppState {
  if (!raw || typeof raw !== 'object') return DEFAULT_APP_STATE;
  return {
    transactions: Array.isArray(raw.transactions) ? raw.transactions : DEFAULT_TRANSACTIONS,
    masterEmployees: Array.isArray(raw.masterEmployees)
      ? raw.masterEmployees
      : DEFAULT_MASTER_EMPLOYEES,
    officials: raw.officials ? { ...DEFAULT_OFFICIALS, ...raw.officials } : DEFAULT_OFFICIALS,
    customMainTitle:
      typeof raw.customMainTitle === 'string' && raw.customMainTitle.trim()
        ? raw.customMainTitle
        : DEFAULT_CUSTOM_MAIN_TITLE,
    customActivityTitle:
      typeof raw.customActivityTitle === 'string' && raw.customActivityTitle.trim()
        ? raw.customActivityTitle
        : DEFAULT_CUSTOM_ACTIVITY_TITLE,
    currentMonth: typeof raw.currentMonth === 'string' ? raw.currentMonth : 'November',
    currentCategory:
      raw.currentCategory === 'ekskul' ||
      raw.currentCategory === 'gurutamu' ||
      raw.currentCategory === 'lainnya'
        ? raw.currentCategory
        : 'gurutamu',
  };
}

function normalizeEnvelope(parsed: unknown): PersistedEnvelope | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  // Support both new envelope format and previous plain AppState format
  if ('state' in obj && obj.state && typeof obj.state === 'object') {
    const tab = obj.activeTab;
    const validTab: TabType =
      tab === 'kelola' || tab === 'rekap' || tab === 'dh' || tab === 'tt' || tab === 'master'
        ? tab
        : 'kelola';
    const pendingMutations = normalizePendingMutations(obj.pendingMutations);
    return {
      state: normalizeAppState(obj.state as Partial<AppState>),
      activeTab: validTab,
      historyLog: Array.isArray(obj.historyLog) ? (obj.historyLog as HistoryEntry[]).slice(0, 60) : [],
      hasUnsyncedLocalChanges:
        Boolean(obj.hasUnsyncedLocalChanges) || hasAnyPendingMutation(pendingMutations),
      pendingMutations,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    };
  }

  if ('transactions' in obj) {
    return {
      state: normalizeAppState(obj as Partial<AppState>),
      activeTab: 'kelola',
      historyLog: [],
      hasUnsyncedLocalChanges: false,
      pendingMutations: { ...EMPTY_PENDING_MUTATIONS },
      updatedAt: Date.now(),
    };
  }

  return null;
}

function tryReadJsonStorage(storage: Storage | undefined): PersistedEnvelope | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadInitialEnvelope(): {
  envelope: PersistedEnvelope;
  fromStorage: boolean;
  localStorageWritable: boolean;
  sessionStorageWritable: boolean;
} {
  let lsWritable = false;
  try {
    const testKey = '__srt39_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    lsWritable = true;
  } catch {
    lsWritable = false;
  }

  let ssWritable = false;
  try {
    const testKey = '__srt39_test__';
    sessionStorage.setItem(testKey, '1');
    sessionStorage.removeItem(testKey);
    ssWritable = true;
  } catch {
    ssWritable = false;
  }

  const candidates: PersistedEnvelope[] = [];

  const lsEnv = tryReadJsonStorage(typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (lsEnv) candidates.push(lsEnv);

  const ssEnv = tryReadJsonStorage(
    typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
  );
  if (ssEnv) candidates.push(ssEnv);

  try {
    if (typeof window !== 'undefined' && window.name.startsWith(WINDOW_NAME_PREFIX)) {
      const jsonStr = window.name.slice(WINDOW_NAME_PREFIX.length);
      const wnEnv = normalizeEnvelope(JSON.parse(jsonStr));
      if (wnEnv) candidates.push(wnEnv);
    }
  } catch {
    // ignore invalid window.name
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      envelope: candidates[0],
      fromStorage: true,
      localStorageWritable: lsWritable,
      sessionStorageWritable: ssWritable,
    };
  }

  return {
    envelope: {
      state: DEFAULT_APP_STATE,
      activeTab: 'kelola',
      historyLog: [],
      hasUnsyncedLocalChanges: false,
      pendingMutations: { ...EMPTY_PENDING_MUTATIONS },
      updatedAt: 0,
    },
    fromStorage: false,
    localStorageWritable: lsWritable,
    sessionStorageWritable: ssWritable,
  };
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function readIndexedDbEnvelope(): Promise<PersistedEnvelope | null> {
  try {
    const db = await openIDB();
    return await new Promise<PersistedEnvelope | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(IDB_KEY);
      getReq.onsuccess = () => {
        resolve(normalizeEnvelope(getReq.result));
      };
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function writeIndexedDbEnvelope(envelope: PersistedEnvelope): Promise<boolean> {
  try {
    const db = await openIDB();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(envelope, IDB_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export function saveEnvelopeSync(envelope: PersistedEnvelope): SyncWriteResult {
  const serialized = JSON.stringify(envelope);
  let localStorageOk = false;
  let sessionStorageOk = false;
  let windowNameOk = false;

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorageOk = true;
  } catch {
    localStorageOk = false;
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, serialized);
    sessionStorageOk = true;
  } catch {
    sessionStorageOk = false;
  }

  try {
    if (typeof window !== 'undefined') {
      window.name = WINDOW_NAME_PREFIX + serialized;
      windowNameOk = true;
    }
  } catch {
    windowNameOk = false;
  }

  return { localStorageOk, sessionStorageOk, windowNameOk };
}
