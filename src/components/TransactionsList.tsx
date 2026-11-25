import React, { useMemo, useState } from 'react';
import { FileCheck2, FileSpreadsheet, Pencil, Search, Trash2 } from 'lucide-react';
import { Transaction } from '../types';
import { formatRupiah } from '../utils/formatters';

interface TransactionsListProps {
  items: Transaction[];
  currentMonth: string;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onOpenDH: (tx: Transaction) => void;
  onOpenTT: (tx: Transaction) => void;
  onOpenAllDH: () => void;
  onOpenAllTT: () => void;
}

export const TransactionsList: React.FC<TransactionsListProps> = ({
  items,
  currentMonth,
  onEdit,
  onDelete,
  onOpenDH,
  onOpenTT,
  onOpenAllDH,
  onOpenAllTT,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.nama.toLowerCase().includes(q) ||
        t.jenis.toLowerCase().includes(q) ||
        t.jenjang.toLowerCase().includes(q) ||
        t.noBukti.toLowerCase().includes(q) ||
        t.tanggal.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const totals = useMemo(() => {
    return filteredItems.reduce(
      (acc, tx) => {
        const kotor = tx.tarif * tx.jamlat;
        const pajak = Math.round(kotor * tx.pajakRate);
        const bersih = kotor - pajak;
        acc.kotor += kotor;
        acc.pajak += pajak;
        acc.bersih += bersih;
        return acc;
      },
      { kotor: 0, pajak: 0, bersih: 0 }
    );
  }, [filteredItems]);

  return (
    <div className="space-y-5">
      {/* 4-KPI Summary Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Jumlah Entri</div>
          <div className="mt-1 text-xl sm:text-2xl font-bold font-mono-num text-slate-900">
            {filteredItems.length}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {currentMonth === 'ALL' ? 'Semua Bulan 2026' : `Periode ${currentMonth} 2026`}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Jumlah Kotor</div>
          <div className="mt-1 text-lg sm:text-2xl font-bold font-mono-num text-slate-900">
            {formatRupiah(totals.kotor)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Bruto sebelum pajak</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Potongan PPh 21</div>
          <div className="mt-1 text-lg sm:text-2xl font-bold font-mono-num text-rose-600">
            {formatRupiah(totals.pajak)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Total pajak terpotong</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Diterima Bersih</div>
          <div className="mt-1 text-lg sm:text-2xl font-bold font-mono-num text-emerald-700">
            {formatRupiah(totals.bersih)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Netto dibayarkan</div>
        </div>
      </div>

      {/* Filter & Bulk Print Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, bidang, jenjang, atau no. bukti..."
              className="w-full min-h-[44px] pl-10 pr-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenAllDH}
              className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
            >
              <FileCheck2 className="w-4 h-4 text-blue-600" />
              Cetak Semua DH
            </button>
            <button
              type="button"
              onClick={onOpenAllTT}
              className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              Cetak Semua SPJ
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada entri SPJ yang sesuai dengan filter periode atau pencarian ini.
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-3 text-center w-10">No</th>
                    <th className="py-3 px-3">Penerima & Bidang</th>
                    <th className="py-3 px-3">No. Bukti & Tanggal</th>
                    <th className="py-3 px-3 text-right">Kotor</th>
                    <th className="py-3 px-3 text-right">PPh 21</th>
                    <th className="py-3 px-3 text-right">Bersih</th>
                    <th className="py-3 px-3 text-center">Dokumen & Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredItems.map((tx, idx) => {
                    const kotor = tx.tarif * tx.jamlat;
                    const pajak = Math.round(kotor * tx.pajakRate);
                    const bersih = kotor - pajak;
                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 text-center font-mono-num text-slate-500">{idx + 1}</td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">{tx.nama}</div>
                          <div className="text-xs text-slate-500">
                            {tx.jenis} · {tx.jenjang} · {tx.status}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono-num text-xs font-medium text-slate-800">{tx.noBukti}</div>
                          <div className="text-xs text-slate-500">{tx.tanggal}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-slate-700">
                          {formatRupiah(kotor)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-rose-600">
                          {formatRupiah(pajak)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num font-bold text-emerald-700">
                          {formatRupiah(bersih)}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenDH(tx)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition"
                              title="Pratinjau Daftar Hadir"
                            >
                              DH
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenTT(tx)}
                              className="px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-xs font-semibold text-blue-700 transition"
                              title="Pratinjau Tanda Terima SPJ"
                            >
                              SPJ
                            </button>
                            <button
                              type="button"
                              onClick={() => onEdit(tx)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition"
                              aria-label={`Edit ${tx.nama}`}
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(tx)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition"
                              aria-label={`Hapus ${tx.nama}`}
                              title="Hapus"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Touch Card List */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredItems.map((tx, idx) => {
                const kotor = tx.tarif * tx.jamlat;
                const pajak = Math.round(kotor * tx.pajakRate);
                const bersih = kotor - pajak;
                return (
                  <div key={tx.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">
                          {idx + 1}. {tx.nama}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          {tx.jenis} · {tx.jenjang} · {tx.status}
                        </div>
                        <div className="text-xs font-mono-num text-slate-500 mt-1">
                          {tx.noBukti} · {tx.tanggal}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold font-mono-num text-emerald-700">
                          {formatRupiah(bersih)}
                        </div>
                        <div className="text-[11px] font-mono-num text-slate-500">
                          Kotor {formatRupiah(kotor)}
                        </div>
                        {pajak > 0 && (
                          <div className="text-[11px] font-mono-num text-rose-600">
                            PPh {formatRupiah(pajak)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onOpenDH(tx)}
                        className="min-h-[44px] rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 flex items-center justify-center"
                      >
                        DH
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenTT(tx)}
                        className="min-h-[44px] rounded-xl border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 flex items-center justify-center"
                      >
                        SPJ
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(tx)}
                        className="min-h-[44px] rounded-xl border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 flex items-center justify-center gap-1"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(tx)}
                        className="min-h-[44px] rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700 flex items-center justify-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Hapus
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
