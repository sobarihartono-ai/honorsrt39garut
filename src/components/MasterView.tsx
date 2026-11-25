import React, { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Save, Trash2, Upload, UserCheck, Users } from 'lucide-react';
import { CategoryType, MasterEmployee, Officials } from '../types';
import { formatRupiah } from '../utils/formatters';

interface MasterViewProps {
  officials: Officials;
  customMainTitle: string;
  customActivityTitle: string;
  masterEmployees: MasterEmployee[];
  onSaveOfficials: (
    nextOfficials: Officials,
    nextMainTitle: string,
    nextActivityTitle: string
  ) => void;
  onAddEmployee: (emp: MasterEmployee) => void;
  onDeleteEmployee: (emp: MasterEmployee) => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  onRequestResetDefaults: () => void;
}

export const MasterView: React.FC<MasterViewProps> = ({
  officials,
  customMainTitle,
  customActivityTitle,
  masterEmployees,
  onSaveOfficials,
  onAddEmployee,
  onDeleteEmployee,
  onExportJSON,
  onImportJSON,
  onRequestResetDefaults,
}) => {
  const [ppkName, setPpkName] = useState(officials.ppkName);
  const [ppkNip, setPpkNip] = useState(officials.ppkNip);
  const [bendName, setBendName] = useState(officials.bendName);
  const [bendNip, setBendNip] = useState(officials.bendNip);
  const [kepsekName, setKepsekName] = useState(officials.kepsekName);
  const [kepsekNip, setKepsekNip] = useState(officials.kepsekNip);
  const [mainTitle, setMainTitle] = useState(customMainTitle);
  const [activityTitle, setActivityTitle] = useState(customActivityTitle);

  useEffect(() => {
    setPpkName(officials.ppkName);
    setPpkNip(officials.ppkNip);
    setBendName(officials.bendName);
    setBendNip(officials.bendNip);
    setKepsekName(officials.kepsekName);
    setKepsekNip(officials.kepsekNip);
    setMainTitle(customMainTitle);
    setActivityTitle(customActivityTitle);
  }, [officials, customMainTitle, customActivityTitle]);

  const [empCategory, setEmpCategory] = useState<CategoryType>('ekskul');
  const [empNama, setEmpNama] = useState('');
  const [empJenis, setEmpJenis] = useState('');
  const [empJenjang, setEmpJenjang] = useState('SRMP');
  const [empStatus, setEmpStatus] = useState('NON ASN');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveOfficialsSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    onSaveOfficials(
      {
        ppkName: ppkName.trim(),
        ppkNip: ppkNip.trim(),
        bendName: bendName.trim(),
        bendNip: bendNip.trim(),
        kepsekName: kepsekName.trim(),
        kepsekNip: kepsekNip.trim(),
      },
      mainTitle.trim(),
      activityTitle.trim()
    );
  };

  const handleAddEmployeeSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!empNama.trim() || !empJenis.trim()) return;
    const emp: MasterEmployee = {
      id: `emp-${Date.now()}`,
      category: empCategory,
      nama: empNama.trim(),
      jenis: empJenis.trim(),
      jenjang: empJenjang,
      status: empStatus,
      jabatan:
        empCategory === 'gurutamu'
          ? 'Guru Tamu PAI'
          : empCategory === 'lainnya'
            ? 'Narasumber / Pembina'
            : 'Guru Ekstrakurikuler',
      tarif: empCategory === 'gurutamu' ? 170000 : empCategory === 'lainnya' ? 300000 : 500000,
      pajakRate: empCategory === 'gurutamu' ? 0 : 0.05,
    };
    onAddEmployee(emp);
    setEmpNama('');
    setEmpJenis('');
  };

  return (
    <div className="space-y-6">
      {/* Pejabat Penandatangan & Judul Kegiatan Khusus */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-2.5 bg-slate-50/70">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              Pejabat Penandatangan & Judul Kegiatan
            </h2>
            <p className="text-xs text-slate-500">
              Nama dan NIP pejabat tampil otomatis pada Rekapitulasi, Daftar Hadir, dan Tanda Terima SPJ
            </p>
          </div>
        </div>
        <form onSubmit={handleSaveOfficialsSubmit} className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="text-xs font-bold text-slate-700">Pejabat Pembuat Komitmen (PPK)</div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Nama PPK</label>
                <input
                  type="text"
                  required
                  value={ppkName}
                  onChange={(e) => setPpkName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">NIP PPK</label>
                <input
                  type="text"
                  required
                  value={ppkNip}
                  onChange={(e) => setPpkNip(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900"
                />
              </div>
            </div>

            <div className="space-y-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="text-xs font-bold text-slate-700">Bendahara Pengeluaran Pembantu</div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Nama Bendahara</label>
                <input
                  type="text"
                  required
                  value={bendName}
                  onChange={(e) => setBendName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">NIP Bendahara</label>
                <input
                  type="text"
                  required
                  value={bendNip}
                  onChange={(e) => setBendNip(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900"
                />
              </div>
            </div>

            <div className="space-y-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="text-xs font-bold text-slate-700">Kepala Sekolah SRT 39 Garut</div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Nama Kepala Sekolah</label>
                <input
                  type="text"
                  required
                  value={kepsekName}
                  onChange={(e) => setKepsekName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">NIP Kepala Sekolah</label>
                <input
                  type="text"
                  required
                  value={kepsekNip}
                  onChange={(e) => setKepsekNip(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-mono-num text-slate-900"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Judul Utama Kategori Kegiatan Lainnya
              </label>
              <input
                type="text"
                value={mainTitle}
                onChange={(e) => setMainTitle(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Sub-Judul Default "Dalam Rangka"
              </label>
              <input
                type="text"
                value={activityTitle}
                onChange={(e) => setActivityTitle(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
            >
              <Save className="w-4 h-4" />
              Simpan Pengaturan Pejabat
            </button>
          </div>
        </form>
      </section>

      {/* Master Pegawai */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-2.5 bg-slate-50/70">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              Daftar Pegawai Master ({masterEmployees.length} Orang)
            </h2>
            <p className="text-xs text-slate-500">
              Data template pegawai agar pengisian SPJ bulanan lebih cepat
            </p>
          </div>
        </div>

        <form onSubmit={handleAddEmployeeSubmit} className="p-4 sm:p-6 border-b border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Kategori</label>
              <select
                value={empCategory}
                onChange={(e) => setEmpCategory(e.target.value as CategoryType)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
              >
                <option value="ekskul">Ekstrakurikuler</option>
                <option value="gurutamu">Guru Tamu</option>
                <option value="lainnya">Kegiatan Lainnya</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Pegawai</label>
              <input
                type="text"
                required
                value={empNama}
                onChange={(e) => setEmpNama(e.target.value)}
                placeholder="Nama lengkap"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Bidang / Mapel</label>
              <input
                type="text"
                required
                value={empJenis}
                onChange={(e) => setEmpJenis(e.target.value)}
                placeholder="Pramuka / Guru Mengaji"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Jenjang & Status</label>
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={empJenjang}
                  onChange={(e) => setEmpJenjang(e.target.value)}
                  className="min-h-[44px] px-2 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  <option value="SRD">SRD</option>
                  <option value="SRMP">SRMP</option>
                  <option value="SRMA">SRMA</option>
                  <option value="SRT 39 GARUT">SRT 39</option>
                </select>
                <select
                  value={empStatus}
                  onChange={(e) => setEmpStatus(e.target.value)}
                  className="min-h-[44px] px-2 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  <option value="NON ASN">NON ASN</option>
                  <option value="ASN">ASN</option>
                  <option value="ASN/PPPK PARUH WAKTU">PPPK PW</option>
                </select>
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition"
              >
                + Tambah
              </button>
            </div>
          </div>
        </form>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Nama Pegawai</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Bidang & Jenjang</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Tarif Default</th>
                <th className="py-3 px-4 text-center">Hapus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {masterEmployees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-semibold text-slate-900">{emp.nama}</td>
                  <td className="py-2.5 px-4 text-xs font-semibold uppercase text-blue-700">{emp.category}</td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {emp.jenis} ({emp.jenjang})
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{emp.status}</td>
                  <td className="py-2.5 px-4 text-right font-mono-num text-slate-800">
                    {formatRupiah(emp.tarif)}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteEmployee(emp)}
                      className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 transition"
                      aria-label={`Hapus pegawai ${emp.nama}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile List */}
        <div className="md:hidden divide-y divide-slate-100">
          {masterEmployees.map((emp) => (
            <div key={emp.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{emp.nama}</div>
                <div className="text-xs text-slate-600 mt-0.5">
                  {emp.category.toUpperCase()} · {emp.jenis} ({emp.jenjang}) · {emp.status}
                </div>
                <div className="text-xs font-mono-num text-slate-500 mt-0.5">{formatRupiah(emp.tarif)}</div>
              </div>
              <button
                type="button"
                onClick={() => onDeleteEmployee(emp)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-rose-200 bg-rose-50 text-rose-700 flex items-center justify-center shrink-0"
                aria-label={`Hapus ${emp.nama}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Cadangan & Pemulihan Data JSON */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900">Cadangan & Pemulihan Data (JSON)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Unduh salinan JSON untuk arsip luring, impor file backup, atau kembalikan data awal 2026
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onExportJSON}
              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition"
            >
              <Download className="w-4 h-4 text-blue-600" />
              Unduh Backup JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportJSON(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition"
            >
              <Upload className="w-4 h-4 text-emerald-600" />
              Pulihkan JSON
            </button>
            <button
              type="button"
              onClick={onRequestResetDefaults}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition"
            >
              <RotateCcw className="w-4 h-4" />
              Reset Data Awal
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
