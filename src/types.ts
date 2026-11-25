export type CategoryType = 'ekskul' | 'gurutamu' | 'lainnya';

export type TabType = 'kelola' | 'rekap' | 'dh' | 'tt' | 'master';

export interface Transaction {
  id: string;
  category: CategoryType;
  bulan: string;
  noBukti: string;
  tanggal: string;
  nama: string;
  jenjang: string;
  jenis: string;
  status: string;
  jabatan: string;
  tarif: number;
  jamlat: number;
  pajakRate: number;
  customRangka?: string;
}

export interface MasterEmployee {
  id: string;
  category: CategoryType;
  nama: string;
  jenis: string;
  jenjang: string;
  status: string;
  jabatan: string;
  tarif: number;
  pajakRate: number;
}

export interface Officials {
  ppkName: string;
  ppkNip: string;
  bendName: string;
  bendNip: string;
  kepsekName: string;
  kepsekNip: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: string;
  detail: string;
}

export interface AppState {
  transactions: Transaction[];
  masterEmployees: MasterEmployee[];
  officials: Officials;
  customMainTitle: string;
  customActivityTitle: string;
  currentMonth: string;
  currentCategory: CategoryType;
}

export interface PrintJobMeta {
  docName: string;
  type: 'rekap' | 'dh' | 'tt';
  items: Transaction[];
}
