import React, { useState } from 'react';
import { FileCode2, FileDown, FileSpreadsheet, FileText, Printer, X } from 'lucide-react';
import { CategoryType, Officials, PrintJobMeta } from '../types';
import { DaftarHadirSheet, RekapSheet, ResponsiveSheetFrame, TandaTerimaSheet } from './DocumentSheets';
import { downloadExcelReport, downloadWordReport } from '../utils/officeGenerator';
import { buildStandaloneHTML, buildVectorPDF, downloadBlob } from '../utils/pdfGenerator';

interface PrintModalProps {
  job: PrintJobMeta | null;
  category: CategoryType;
  month: string;
  officials: Officials;
  customMainTitle: string;
  customActivityTitle: string;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const PrintModal: React.FC<PrintModalProps> = ({
  job,
  category,
  month,
  officials,
  customMainTitle,
  customActivityTitle,
  onClose,
  onNotify,
}) => {
  const [busyFormat, setBusyFormat] = useState<'excel' | 'word' | null>(null);

  if (!job) return null;

  const ctx = {
    category,
    month,
    officials,
    customMainTitle,
    customActivityTitle,
  };

  const handlePrint = (): void => {
    window.focus();
    window.print();
  };

  const handleDownloadPDF = (): void => {
    try {
      const pdf = buildVectorPDF(job, ctx);
      pdf.save(`${job.docName}.pdf`);
      onNotify('File PDF A4 Landscape berhasil diunduh.');
    } catch (err) {
      console.error('PDF generation failed:', err);
      onNotify('Gagal membuat PDF. Coba gunakan Simpan HTML atau Cetak.');
    }
  };

  const handleDownloadExcel = async (): Promise<void> => {
    if (busyFormat) return;
    setBusyFormat('excel');
    try {
      await downloadExcelReport(job, ctx);
      onNotify('Laporan Excel (.xlsx) berhasil diunduh.');
    } catch (err) {
      console.error('Excel generation failed:', err);
      onNotify('Gagal membuat file Excel. Silakan coba lagi.');
    } finally {
      setBusyFormat(null);
    }
  };

  const handleDownloadWord = async (): Promise<void> => {
    if (busyFormat) return;
    setBusyFormat('word');
    try {
      await downloadWordReport(job, ctx);
      onNotify('Laporan Word (.docx) berhasil diunduh.');
    } catch (err) {
      console.error('Word generation failed:', err);
      onNotify('Gagal membuat file Word. Silakan coba lagi.');
    } finally {
      setBusyFormat(null);
    }
  };

  const handleDownloadHTML = (): void => {
    const html = buildStandaloneHTML(job, ctx);
    downloadBlob(html, 'text/html;charset=utf-8', `${job.docName}.html`);
    onNotify('File HTML siap cetak berhasil diunduh.');
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-100 w-full max-w-[1200px] max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              Pratinjau Cetak: {job.docName.replace(/_/g, ' ')}
            </h3>
            <p className="text-xs text-slate-500">Format Kertas Resmi A4 Landscape · PDF, Excel, Word & HTML</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <Printer className="w-4 h-4" />
              Cetak
            </button>
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <FileDown className="w-4 h-4" />
              PDF
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={busyFormat !== null}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {busyFormat === 'excel' ? 'Membuat...' : 'Excel (.xlsx)'}
            </button>
            <button
              type="button"
              onClick={handleDownloadWord}
              disabled={busyFormat !== null}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <FileText className="w-4 h-4" />
              {busyFormat === 'word' ? 'Membuat...' : 'Word (.docx)'}
            </button>
            <button
              type="button"
              onClick={handleDownloadHTML}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <FileCode2 className="w-4 h-4" />
              HTML
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1 whitespace-nowrap transition"
              aria-label="Tutup pratinjau cetak"
            >
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">Tutup</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3 sm:p-6">
          <ResponsiveSheetFrame>
            {job.type === 'rekap' && (
              <RekapSheet
                items={job.items}
                category={category}
                month={month}
                officials={officials}
                customMainTitle={customMainTitle}
                customActivityTitle={customActivityTitle}
              />
            )}
            {job.type === 'dh' &&
              job.items.map((tx, idx) => (
                <div key={tx.id} className={idx < job.items.length - 1 ? 'page-break' : ''}>
                  <DaftarHadirSheet
                    tx={tx}
                    category={category}
                    month={month}
                    officials={officials}
                    customMainTitle={customMainTitle}
                    customActivityTitle={customActivityTitle}
                  />
                </div>
              ))}
            {job.type === 'tt' &&
              job.items.map((tx, idx) => (
                <div key={tx.id} className={idx < job.items.length - 1 ? 'page-break' : ''}>
                  <TandaTerimaSheet
                    tx={tx}
                    category={category}
                    month={month}
                    officials={officials}
                    customMainTitle={customMainTitle}
                    customActivityTitle={customActivityTitle}
                  />
                </div>
              ))}
          </ResponsiveSheetFrame>
        </div>
      </div>
    </div>
  );
};
