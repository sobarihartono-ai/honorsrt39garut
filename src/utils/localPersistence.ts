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

export interface PersistedEnvelope {
  state: AppState;
  activeTab: TabType;
  historyLog: HistoryEntry[];
  hasUnsyncedLocalChanges: boolean;
  updatedAt: number;
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
    return {
      state: normalizeAppState(obj.state as Partial<AppState>),
      activeTab: validTab,
      historyLog: Array.isArray(obj.historyLog) ? (obj.historyLog as HistoryEntry[]).slice(0, 60) : [],
      hasUnsyncedLocalChanges: Boolean(obj.hasUnsyncedLocalChanges),
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    };
  }

  if ('transactions' in obj) {
    return {
      state: normalizeAppState(obj as Partial<AppState>),
      activeTab: 'kelola',
      historyLog: [],
      hasUnsyncedLocalChanges: false,
      updatedAt: Date.now(),
    };
  }

  return null;
}

export function loadInitialEnvelope(): {
  envelope: PersistedEnvelope;
  fromStorage: boolean;
  localStorageWritable: boolean;
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

  let lsEnv: PersistedEnvelope | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      lsEnv = normalizeEnvelope(JSON.parse(raw));
    }
  } catch {
    lsEnv = null;
  }

  let wnEnv: PersistedEnvelope | null = null;
  try {
    if (typeof window !== 'undefined' && window.name.startsWith(WINDOW_NAME_PREFIX)) {
      const jsonStr = window.name.slice(WINDOW_NAME_PREFIX.length);
      wnEnv = normalizeEnvelope(JSON.parse(jsonStr));
    }
  } catch {
    wnEnv = null;
  }

  if (lsEnv && wnEnv) {
    return {
      envelope: wnEnv.updatedAt > lsEnv.updatedAt ? wnEnv : lsEnv,
      fromStorage: true,
      localStorageWritable: lsWritable,
    };
  }
  if (lsEnv) {
    return { envelope: lsEnv, fromStorage: true, localStorageWritable: lsWritable };
  }
  if (wnEnv) {
    return { envelope: wnEnv, fromStorage: true, localStorageWritable: lsWritable };
  }

  return {
    envelope: {
      state: DEFAULT_APP_STATE,
      activeTab: 'kelola',
      historyLog: [],
      hasUnsyncedLocalChanges: false,
      updatedAt: 0,
    },
    fromStorage: false,
    localStorageWritable: lsWritable,
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

export function saveEnvelopeSync(envelope: PersistedEnvelope): void {
  const serialized = JSON.stringify(envelope);

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (err) {
    console.warn('localStorage write failed:', err);
  }

  try {
    if (typeof window !== 'undefined') {
      window.name = WINDOW_NAME_PREFIX + serialized;
    }
  } catch {
    // ignore window.name failure
  }
}
