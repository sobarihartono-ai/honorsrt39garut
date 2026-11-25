import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, RotateCcw, UserPlus } from 'lucide-react';
import { MONTHS, MONTH_ROMAN } from '../data/seedData';
import { CategoryType, MasterEmployee, Transaction } from '../types';
import { formatRupiah } from '../utils/formatters';

const DRAFT_STORAGE_KEY = 'srt39_form_draft_v1';

interface FormDraft {
  category: CategoryType;
  selectedMasterId: string;
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
  customRangka: string;
}

function loadDraft(cat: CategoryType): FormDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY) || sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FormDraft;
    if (parsed && parsed.category === cat && (parsed.nama || parsed.jenis)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveDraft(draft: FormDraft | null): void {
  try {
    if (!draft) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    const str = JSON.stringify(draft);
    localStorage.setItem(DRAFT_STORAGE_KEY, str);
    sessionStorage.setItem(DRAFT_STORAGE_KEY, str);
  } catch {
    // ignore storage errors
  }
}

interface TransactionFormProps {
  currentCategory: CategoryType;
  currentMonth: string;
  customActivityTitle: string;
  masterEmployees: MasterEmployee[];
  transactions: Transaction[];
  editingTx: Transaction | null;
  onCancelEdit: () => void;
  onSubmitTx: (tx: Transaction, isEdit: boolean) => void;
}

export const TransactionForm: React.FC<TransactionFormProps> = ({
  currentCategory,
  currentMonth,
  customActivityTitle,
  masterEmployees,
  transactions,
  editingTx,
  onCancelEdit,
  onSubmitTx,
}) => {
  const activeMonthDefault = currentMonth === 'ALL' ? 'November' : currentMonth;

  const filteredMaster = useMemo(
    () => masterEmployees.filter((m) => m.category === currentCategory),
    [masterEmployees, currentCategory]
  );

  const suggestNoBukti = (bulan: string, cat: CategoryType): string => {
    const roman = MONTH_ROMAN[bulan] || 'XI';
    const countInMonth = transactions.filter((t) => t.category === cat && t.bulan === bulan).length + 1;
    const seq = String(countInMonth).padStart(3, '0');
    const code = cat === 'gurutamu' ? 'TRNP' : cat === 'lainnya' ? 'KHS' : 'HNR';
    return `REG/${seq}/${code}/${roman}/2026`;
  };

  const defaultTarif = currentCategory === 'gurutamu' ? 170000 : currentCategory === 'lainnya' ? 300000 : 500000;
  const defaultPajak = currentCategory === 'gurutamu' ? 0 : 0.05;
  const defaultJabatan =
    currentCategory === 'gurutamu'
      ? 'Guru Tamu PAI'
      : currentCategory === 'lainnya'
        ? 'Narasumber'
        : 'Guru Ekstrakurikuler';

  const initialDraft = !editingTx ? loadDraft(currentCategory) : null;

  const [selectedMasterId, setSelectedMasterId] = useState<string>(initialDraft?.selectedMasterId || 'MANUAL');
  const [bulan, setBulan] = useState<string>(initialDraft?.bulan || activeMonthDefault);
  const [noBukti, setNoBukti] = useState<string>(
    () => initialDraft?.noBukti || suggestNoBukti(activeMonthDefault, currentCategory)
  );
  const [tanggal, setTanggal] = useState<string>(initialDraft?.tanggal || `25 ${activeMonthDefault} 2026`);
  const [nama, setNama] = useState<string>(initialDraft?.nama || '');
  const [jenjang, setJenjang] = useState<string>(
    initialDraft?.jenjang || (currentCategory === 'lainnya' ? 'SRT 39 GARUT' : 'SRMP')
  );
  const [jenis, setJenis] = useState<string>(initialDraft?.jenis || '');
  const [status, setStatus] = useState<string>(
    initialDraft?.status || (currentCategory === 'gurutamu' ? 'ASN' : 'NON ASN')
  );
  const [jabatan, setJabatan] = useState<string>(initialDraft?.jabatan || defaultJabatan);
  const [tarif, setTarif] = useState<number>(initialDraft?.tarif ?? defaultTarif);
  const [jamlat, setJamlat] = useState<number>(initialDraft?.jamlat ?? 1);
  const [pajakRate, setPajakRate] = useState<number>(initialDraft?.pajakRate ?? defaultPajak);
  const [customRangka, setCustomRangka] = useState<string>(initialDraft?.customRangka || customActivityTitle);

  const prevCatRef = useRef<CategoryType>(currentCategory);
  const prevMonthRef = useRef<string>(currentMonth);
  const prevEditingIdRef = useRef<string | null>(editingTx?.id ?? null);

  useEffect(() => {
    const editingChanged = prevEditingIdRef.current !== (editingTx?.id ?? null);
    const catChanged = prevCatRef.current !== currentCategory;
    const monthChanged = prevMonthRef.current !== currentMonth;

    prevEditingIdRef.current = editingTx?.id ?? null;
    prevCatRef.current = currentCategory;
    prevMonthRef.current = currentMonth;

    if (editingTx) {
      setSelectedMasterId('MANUAL');
      setBulan(editingTx.bulan);
      setNoBukti(editingTx.noBukti);
      setTanggal(editingTx.tanggal);
      setNama(editingTx.nama);
      setJenjang(editingTx.jenjang);
      setJenis(editingTx.jenis);
      setStatus(editingTx.status);
      setJabatan(editingTx.jabatan);
      setTarif(editingTx.tarif);
      setJamlat(editingTx.jamlat);
      setPajakRate(editingTx.pajakRate);
      setCustomRangka(editingTx.customRangka || customActivityTitle);
      return;
    }

    if (editingChanged || catChanged || monthChanged) {
      const draft = loadDraft(currentCategory);
      if (draft && !catChanged && !monthChanged) {
        setSelectedMasterId(draft.selectedMasterId);
        setBulan(draft.bulan);
        setNoBukti(draft.noBukti);
        setTanggal(draft.tanggal);
        setNama(draft.nama);
        setJenjang(draft.jenjang);
        setJenis(draft.jenis);
        setStatus(draft.status);
        setJabatan(draft.jabatan);
        setTarif(draft.tarif);
        setJamlat(draft.jamlat);
        setPajakRate(draft.pajakRate);
        setCustomRangka(draft.customRangka);
      } else {
        const m = currentMonth === 'ALL' ? 'November' : currentMonth;
        setSelectedMasterId('MANUAL');
        setBulan(m);
        setNoBukti(suggestNoBukti(m, currentCategory));
        setTanggal(`25 ${m} 2026`);
        setNama('');
        setJenjang(currentCategory === 'lainnya' ? 'SRT 39 GARUT' : 'SRMP');
        setJenis('');
        setStatus(currentCategory === 'gurutamu' ? 'ASN' : 'NON ASN');
        setJabatan(defaultJabatan);
        setTarif(defaultTarif);
        setJamlat(1);
        setPajakRate(defaultPajak);
        setCustomRangka(customActivityTitle);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTx, currentCategory, currentMonth]);

  // Persist unsubmitted form draft automatically across refresh/reload
  useEffect(() => {
    if (editingTx) return;
    if (!nama.trim() && !jenis.trim()) {
      saveDraft(null);
      return;
    }
    saveDraft({
      category: currentCategory,
      selectedMasterId,
      bulan,
      noBukti,
      tanggal,
      nama,
      jenjang,
      jenis,
      status,
      jabatan,
      tarif,
      jamlat,
      pajakRate,
      customRangka,
    });
  }, [
    editingTx,
    currentCategory,
    selectedMasterId,
    bulan,
    noBukti,
    tanggal,
    nama,
    jenjang,
    jenis,
    status,
    jabatan,
    tarif,
    jamlat,
    pajakRate,
    customRangka,
  ]);

  const handleSelectMaster = (empId: string): void => {
    setSelectedMasterId(empId);
    if (empId === 'MANUAL') return;
    const emp = filteredMaster.find((m) => m.id === empId);
    if (!emp) return;
    setNama(emp.nama);
    setJenis(emp.jenis);
    setJenjang(emp.jenjang);
    setStatus(emp.status);
    setJabatan(emp.jabatan);
    setTarif(emp.tarif);
    setPajakRate(emp.pajakRate);
  };

  const handleBulanChange = (newMonth: string): void => {
    setBulan(newMonth);
    if (!editingTx) {
      setNoBukti(suggestNoBukti(newMonth, currentCategory));
      setTanggal((prev) => {
        const dayMatch = prev.match(/^(\d{1,2})\s+/);
        const day = dayMatch ? dayMatch[1] : '25';
        return `${day} ${newMonth} 2026`;
      });
    }
  };

  const kotor = Math.max(0, Number(tarif) || 0) * Math.max(1, Number(jamlat) || 1);
  const pajak = Math.round(kotor * (Number(pajakRate) || 0));
  const bersih = kotor - pajak;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!nama.trim() || !jenis.trim() || !noBukti.trim() || !tanggal.trim()) return;

    const tx: Transaction = {
      id: editingTx ? editingTx.id : `tx-${Date.now()}`,
      category: editingTx ? editingTx.category : currentCategory,
      bulan,
      noBukti: noBukti.trim(),
      tanggal: tanggal.trim(),
      nama: nama.trim(),
      jenjang: jenjang.trim() || 'SRMP',
      jenis: jenis.trim(),
      status: status.trim() || 'NON ASN',
      jabatan: jabatan.trim() || defaultJabatan,
      tarif: Math.max(0, Number(tarif) || 0),
      jamlat: Math.max(1, Math.round(Number(jamlat) || 1)),
      pajakRate: Math.min(1, Math.max(0, Number(pajakRate) || 0)),
      customRangka: (customRangka || customActivityTitle).trim(),
    };

    onSubmitTx(tx, Boolean(editingTx));

    if (!editingTx) {
      saveDraft(null);
      setSelectedMasterId('MANUAL');
      setNama('');
      setJenis('');
      setJamlat(1);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/70">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <UserPlus className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              {editingTx ? `Edit SPJ: ${editingTx.nama}` : 'Tambah Entri SPJ Baru'}
            </h2>
            <p className="text-xs text-slate-500">
              Pilih pegawai master atau ketik manual · Draf & riwayat tersimpan otomatis
            </p>
          </div>
        </div>
        {editingTx && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 self-start sm:self-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Batal Edit
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Pilih dari Daftar Pegawai Master
            </label>
            <select
              value={selectedMasterId}
              onChange={(e) => handleSelectMaster(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="MANUAL">-- Input Manual / Ketik Sendiri --</option>
              {filteredMaster.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.nama} — {emp.jenis} ({emp.jenjang})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Bulan Anggaran</label>
            <select
              value={bulan}
              onChange={(e) => handleBulanChange(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m} 2026
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">No. Bukti Kas</label>
            <input
              type="text"
              required
              value={noBukti}
              onChange={(e) => setNoBukti(e.target.value)}
              placeholder="REG/001/HNR/XI/2026"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Lengkap Penerima</label>
            <input
              type="text"
              required
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="Nama pelatih / narasumber"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {currentCategory === 'ekskul' ? 'Jenis Ekstrakurikuler' : 'Jenis Kegiatan / Mapel'}
            </label>
            <input
              type="text"
              required
              value={jenis}
              onChange={(e) => setJenis(e.target.value)}
              placeholder={currentCategory === 'gurutamu' ? 'Guru PAI / Guru Mengaji' : 'Karate / Pramuka'}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jenjang / Sasaran</label>
            <select
              value={jenjang}
              onChange={(e) => setJenjang(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="SRD">SRD</option>
              <option value="SRMP">SRMP</option>
              <option value="SRMA">SRMA</option>
              <option value="SRT 39 GARUT">SRT 39 GARUT</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tanggal Pembukuan</label>
            <input
              type="text"
              required
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              placeholder="25 November 2026"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Status Kepegawaian</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="NON ASN">NON ASN</option>
              <option value="ASN">ASN</option>
              <option value="ASN/PPPK PARUH WAKTU">ASN/PPPK PARUH WAKTU</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jabatan di Daftar Hadir</label>
            <input
              type="text"
              required
              value={jabatan}
              onChange={(e) => setJabatan(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tarif (Rp)</label>
              <input
                type="number"
                min={0}
                step={1000}
                required
                value={tarif}
                onChange={(e) => setTarif(Number(e.target.value))}
                className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Jamlat</label>
              <input
                type="number"
                min={1}
                max={1000}
                required
                value={jamlat}
                onChange={(e) => setJamlat(Number(e.target.value))}
                className="w-full min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">PPh 21</label>
              <select
                value={pajakRate}
                onChange={(e) => setPajakRate(Number(e.target.value))}
                className="w-full min-h-[44px] px-2 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={0}>0%</option>
                <option value={0.05}>5%</option>
                <option value={0.06}>6%</option>
                <option value={0.15}>15%</option>
              </select>
            </div>
          </div>

          {currentCategory === 'lainnya' && (
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Kalimat "DALAM RANGKA" Khusus Lembar Ini
              </label>
              <input
                type="text"
                value={customRangka}
                onChange={(e) => setCustomRangka(e.target.value)}
                placeholder="DALAM RANGKA KEGIATAN PEMBINAAN KARAKTER SISWA"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs sm:text-sm text-slate-600">
            <span>
              Kotor: <strong className="font-mono-num text-slate-900">{formatRupiah(kotor)}</strong>
            </span>
            <span>
              PPh 21: <strong className="font-mono-num text-rose-600">{formatRupiah(pajak)}</strong>
            </span>
            <span>
              Bersih: <strong className="font-mono-num text-emerald-700">{formatRupiah(bersih)}</strong>
            </span>
          </div>
          <button
            type="submit"
            className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition shadow-sm"
          >
            {editingTx ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {editingTx ? 'Perbarui Data SPJ' : 'Simpan ke Daftar SPJ'}
          </button>
        </div>
      </form>
    </section>
  );
};
