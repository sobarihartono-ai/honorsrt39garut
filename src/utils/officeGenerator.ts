import writeXlsxFile from 'write-excel-file/browser';
import type { Sheet, SheetData, Row } from 'write-excel-file/browser';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { CategoryType, Officials, PrintJobMeta, Transaction } from '../types';
import { formatNumber } from './formatters';

export interface OfficeDocContext {
  category: CategoryType;
  month: string;
  officials: Officials;
  customMainTitle: string;
  customActivityTitle: string;
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  const cleaned = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet';
  let candidate = cleaned.slice(0, 31);
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function saveBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getRekapMeta(ctx: OfficeDocContext) {
  const bulanUpper = ctx.month === 'ALL' ? 'TAHUN 2026' : `BULAN ${ctx.month.toUpperCase()} 2026`;
  let rekapTitle = 'REKAP HONOR EKSTRAKURIKULER';
  if (ctx.category === 'gurutamu') {
    rekapTitle = 'REKAP UANG TRANSPOR GURU TAMU PAI DAN GURU MENGAJI';
  } else if (ctx.category === 'lainnya') {
    rekapTitle = `REKAP HONORARIUM (${ctx.customActivityTitle.toUpperCase()})`;
  }
  return { rekapTitle, bulanUpper };
}

function getTxLabels(tx: Transaction, ctx: OfficeDocContext) {
  let mainTitle = 'TANDA TERIMA HONOR PELATIH';
  let rangkaLine = `DALAM RANGKA KEGIATAN EKSTRAKURIKULER SISWA ${tx.jenjang}`;
  let rateHeader = 'HONOR (Rp)';
  let colJenisHeader = 'JENIS EKSTRAKURIKULER';

  if (ctx.category === 'gurutamu') {
    mainTitle = 'TANDA TERIMA TRANSPORT';
    rangkaLine = `DALAM RANGKA KEGIATAN GURU TAMU SISWA ${tx.jenjang}`;
    rateHeader = 'TRANSPORT (Rp)';
    colJenisHeader = 'JENIS KEGIATAN';
  } else if (ctx.category === 'lainnya') {
    mainTitle = ctx.customMainTitle.toUpperCase();
    rangkaLine = (tx.customRangka || ctx.customActivityTitle).toUpperCase();
    rateHeader = 'HONOR (Rp)';
    colJenisHeader = 'JENIS KEGIATAN';
  }

  return { mainTitle, rangkaLine, rateHeader, colJenisHeader };
}

function buildRekapExcelSheet(items: Transaction[], ctx: OfficeDocContext, sheetName: string): Sheet<Blob> {
  const { rekapTitle, bulanUpper } = getRekapMeta(ctx);
  let totalKotor = 0;
  let totalPajak = 0;
  let totalBersih = 0;

  const data: SheetData = [
    [{ value: rekapTitle, fontWeight: 'bold', fontSize: 12, align: 'center', columnSpan: 7, fontFamily: 'Times New Roman' }],
    [{ value: 'SEKOLAH RAKYAT TERINTEGRASI 39 GARUT', fontWeight: 'bold', fontSize: 12, align: 'center', columnSpan: 7, fontFamily: 'Times New Roman' }],
    [{ value: bulanUpper, fontWeight: 'bold', fontSize: 12, align: 'center', columnSpan: 7, fontFamily: 'Times New Roman' }],
    [],
    [
      { value: 'NO', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 24 },
      { value: 'NAMA KEGIATAN', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'JUMLAH', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'PAJAK PPH PSL 21', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: 'DITERIMA', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'Tanggal Bayar', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'Tanda Tangan', fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    ],
  ];

  items.forEach((tx, idx) => {
    const kotor = tx.tarif * tx.jamlat;
    const pajak = Math.round(kotor * tx.pajakRate);
    const bersih = kotor - pajak;
    totalKotor += kotor;
    totalPajak += pajak;
    totalBersih += bersih;

    const labelKegiatan =
      ctx.category === 'gurutamu'
        ? `Pembayaran Uang Transpor ${tx.jenis} ${tx.jenjang}`
        : ctx.category === 'lainnya'
          ? `Pembayaran Honorarium ${tx.jenis} (${tx.nama})`
          : `Pembayaran Honorarium Pembina Ekstrakurikuler ${tx.jenis} ${tx.jenjang}`;

    data.push([
      { value: idx + 1, type: Number, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: labelKegiatan, type: String, align: 'left', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: kotor, type: Number, format: '#,##0', align: 'right', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: pajak, type: Number, format: '#,##0', align: 'right', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: bersih, type: Number, format: '#,##0', align: 'right', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.tanggal, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: `${idx + 1}................`, type: String, align: 'left', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    ]);
  });

  data.push([
    { value: 'TOTAL', type: String, columnSpan: 2, fontWeight: 'bold', align: 'center', alignVertical: 'center', backgroundColor: '#F8FAFC', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 22 },
    null,
    { value: totalKotor, type: Number, format: '#,##0', fontWeight: 'bold', align: 'right', alignVertical: 'center', backgroundColor: '#F8FAFC', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    { value: totalPajak, type: Number, format: '#,##0', fontWeight: 'bold', align: 'right', alignVertical: 'center', backgroundColor: '#F8FAFC', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    { value: totalBersih, type: Number, format: '#,##0', fontWeight: 'bold', align: 'right', alignVertical: 'center', backgroundColor: '#F8FAFC', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    { value: '', type: String, backgroundColor: '#F8FAFC', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    { value: '', type: String, backgroundColor: '#F8FAFC', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
  ]);

  data.push([]);
  data.push([null, null, null, null, null, { value: `Garut, ${ctx.month === 'ALL' ? 'Oktober' : ctx.month} 2026`, columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }]);
  data.push([null, null, null, null, null, { value: 'Kepala Sekolah SRT 39 Garut', columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }]);
  data.push([]);
  data.push([]);
  data.push([]);
  data.push([null, null, null, null, null, { value: ctx.officials.kepsekName, columnSpan: 2, align: 'center', fontWeight: 'bold', textDecoration: { underline: true }, fontFamily: 'Times New Roman' }]);
  data.push([null, null, null, null, null, { value: ctx.officials.kepsekNip, columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }]);

  return {
    sheet: sheetName,
    orientation: 'landscape',
    columns: [
      { width: 6 },
      { width: 52 },
      { width: 16 },
      { width: 18 },
      { width: 16 },
      { width: 20 },
      { width: 18 },
    ],
    data,
  };
}

function buildDaftarHadirExcelSheet(tx: Transaction, ctx: OfficeDocContext, sheetName: string): Sheet<Blob> {
  const { rangkaLine, colJenisHeader } = getTxLabels(tx, ctx);

  const data: SheetData = [
    [{ value: 'KEMENTERIAN SOSIAL REPUBLIK INDONESIA', fontWeight: 'bold', fontSize: 12, align: 'center', columnSpan: 6, fontFamily: 'Times New Roman' }],
    [{ value: 'Pusat Pendidikan, Pelatihan dan Pengembangan Profesi', fontWeight: 'bold', fontSize: 12, align: 'center', columnSpan: 6, fontFamily: 'Times New Roman' }],
    [],
    [{ value: 'DAFTAR HADIR', fontWeight: 'bold', fontSize: 11, align: 'center', columnSpan: 6, fontFamily: 'Times New Roman' }],
    [{ value: rangkaLine, fontWeight: 'bold', fontSize: 11, align: 'center', columnSpan: 6, fontFamily: 'Times New Roman' }],
    [{ value: `DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${tx.tanggal}`, fontWeight: 'bold', fontSize: 11, align: 'center', columnSpan: 6, fontFamily: 'Times New Roman' }],
    [],
    [
      { value: 'NO', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 26 },
      { value: 'NAMA/NRP', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: colJenisHeader, fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'ASN/NON ASN', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'JABATAN', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'TANDA TANGAN', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    ],
    [
      { value: 1, type: Number, fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 48 },
      { value: tx.nama, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.jenis, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.status, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.jabatan, type: String, fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: '1.', type: String, fontWeight: 'bold', align: 'left', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    ],
    [],
    [null, null, null, null, { value: `Garut, ${tx.tanggal}`, columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }],
    [null, null, null, null, { value: 'Penanggung jawab Kegiatan', columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }],
    [null, null, null, null, { value: 'Kepala Sekolah SRT 39 Garut', columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }],
    [],
    [],
    [],
    [null, null, null, null, { value: ctx.officials.kepsekName, columnSpan: 2, align: 'center', textDecoration: { underline: true }, fontFamily: 'Times New Roman' }],
    [null, null, null, null, { value: ctx.officials.kepsekNip, columnSpan: 2, align: 'center', fontFamily: 'Times New Roman' }],
  ];

  return {
    sheet: sheetName,
    orientation: 'landscape',
    columns: [
      { width: 8 },
      { width: 32 },
      { width: 26 },
      { width: 24 },
      { width: 26 },
      { width: 24 },
    ],
    data,
  };
}

function buildTandaTerimaExcelSheet(tx: Transaction, ctx: OfficeDocContext, sheetName: string): Sheet<Blob> {
  const kotor = tx.tarif * tx.jamlat;
  const pajak = Math.round(kotor * tx.pajakRate);
  const bersih = kotor - pajak;
  const { mainTitle, rangkaLine, rateHeader, colJenisHeader } = getTxLabels(tx, ctx);

  const data: SheetData = [
    [
      { value: 'KEMENTERIAN SOSIAL REPUBLIK INDONESIA', fontWeight: 'bold', fontSize: 11, columnSpan: 6, fontFamily: 'Times New Roman' },
      null, null, null, null, null,
      { value: 'No. Bukti Kas', columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
      null,
      { value: `: ${tx.noBukti}`, columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
    ],
    [
      { value: 'Pusat Pendidikan, Pelatihan dan Pengembangan Profesi', fontWeight: 'bold', fontSize: 11, columnSpan: 6, fontFamily: 'Times New Roman' },
      null, null, null, null, null,
      { value: 'Tgl. Pembukuan', columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
      null,
      { value: `: ${tx.tanggal}`, columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
    ],
    [
      null, null, null, null, null, null,
      { value: 'Mata Anggaran', columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
      null,
      { value: ': Honorarium Jasa Instruktur', columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
    ],
    [
      null, null, null, null, null, null,
      { value: 'Tahun Anggaran', columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
      null,
      { value: ': 2026', columnSpan: 2, fontSize: 9.5, fontFamily: 'Times New Roman' },
    ],
    [],
    [{ value: mainTitle, fontWeight: 'bold', fontSize: 11, align: 'center', columnSpan: 10, fontFamily: 'Times New Roman' }],
    [{ value: rangkaLine, fontWeight: 'bold', fontSize: 11, align: 'center', columnSpan: 10, fontFamily: 'Times New Roman' }],
    [{ value: `DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${tx.tanggal}`, fontWeight: 'bold', fontSize: 11, align: 'center', columnSpan: 10, fontFamily: 'Times New Roman' }],
    [],
    [
      { value: 'NO', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 28 },
      { value: 'NAMA / NRP', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: colJenisHeader, fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: 'ASN/NON ASN', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: rateHeader, fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: 'JAMLAT', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'JUMLAH KOTOR (Rp)', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: 'Pph 21', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: 'JUMLAH BERSIH (Rp)', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
      { value: 'TANDA TANGAN', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', wrap: true },
    ],
    [
      { value: 1, type: Number, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 34 },
      { value: tx.nama, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.jenis, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.status, type: String, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.tarif, type: Number, format: '#,##0', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: tx.jamlat, type: Number, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: kotor, type: Number, format: '#,##0', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: pajak === 0 ? 'Rp   -' : pajak, type: pajak === 0 ? String : Number, format: pajak === 0 ? undefined : '#,##0', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: bersih, type: Number, format: '#,##0', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: '1..............', type: String, align: 'left', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    ],
    [
      { value: '', type: String, columnSpan: 4, borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman', height: 22 },
      null, null, null,
      { value: tx.tarif, type: Number, format: '#,##0', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: '', type: String, borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: kotor, type: Number, format: '#,##0', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: pajak, type: Number, format: '#,##0', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: bersih, type: Number, format: '#,##0', fontWeight: 'bold', align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
      { value: '', type: String, borderStyle: 'thin', borderColor: '#000000', fontFamily: 'Times New Roman' },
    ],
    [],
    [
      { value: 'Setuju Dibayar', columnSpan: 3, fontFamily: 'Times New Roman' },
      null, null,
      { value: '', columnSpan: 4, fontFamily: 'Times New Roman' },
      null, null, null,
      { value: '', columnSpan: 3, fontFamily: 'Times New Roman' },
    ],
    [
      { value: 'an. Kuasa Pengguna Anggaran', columnSpan: 3, fontFamily: 'Times New Roman' },
      null, null,
      { value: 'Lunas Dibayar', columnSpan: 4, fontFamily: 'Times New Roman' },
      null, null, null,
      { value: '', columnSpan: 3, fontFamily: 'Times New Roman' },
    ],
    [
      { value: 'Pejabat Pembuat Komitmen', columnSpan: 3, fontFamily: 'Times New Roman' },
      null, null,
      { value: `Tanggal          ${tx.tanggal}`, columnSpan: 4, fontFamily: 'Times New Roman' },
      null, null, null,
      { value: 'Yang Membayarkan', columnSpan: 3, align: 'center', fontFamily: 'Times New Roman' },
    ],
    [
      { value: 'Wilayah 10', columnSpan: 3, fontFamily: 'Times New Roman' },
      null, null,
      { value: 'Bendahara Pengeluaran Pembantu Wilayah 10', columnSpan: 4, fontFamily: 'Times New Roman' },
      null, null, null,
      { value: 'Kepala Sekolah SRT 39 Garut', columnSpan: 3, align: 'center', fontFamily: 'Times New Roman' },
    ],
    [],
    [],
    [],
    [
      { value: ctx.officials.ppkName, columnSpan: 3, textDecoration: { underline: true }, fontFamily: 'Times New Roman' },
      null, null,
      { value: ctx.officials.bendName, columnSpan: 4, align: 'center', textDecoration: { underline: true }, fontFamily: 'Times New Roman' },
      null, null, null,
      { value: ctx.officials.kepsekName, columnSpan: 3, align: 'center', textDecoration: { underline: true }, fontFamily: 'Times New Roman' },
    ],
    [
      { value: ctx.officials.ppkNip, columnSpan: 3, fontFamily: 'Times New Roman' },
      null, null,
      { value: ctx.officials.bendNip, columnSpan: 4, align: 'center', fontFamily: 'Times New Roman' },
      null, null, null,
      { value: ctx.officials.kepsekNip, columnSpan: 3, align: 'center', fontFamily: 'Times New Roman' },
    ],
  ];

  return {
    sheet: sheetName,
    orientation: 'landscape',
    columns: [
      { width: 6 },
      { width: 22 },
      { width: 20 },
      { width: 18 },
      { width: 14 },
      { width: 10 },
      { width: 16 },
      { width: 12 },
      { width: 16 },
      { width: 15 },
    ],
    data,
  };
}

function buildMasterListExcelSheet(items: Transaction[], ctx: OfficeDocContext, sheetName: string): Sheet<Blob> {
  const data: SheetData = [
    [{ value: `RINGKASAN DATA SPJ - ${ctx.month === 'ALL' ? 'TAHUN 2026' : ctx.month.toUpperCase() + ' 2026'}`, fontWeight: 'bold', fontSize: 12, columnSpan: 11, fontFamily: 'Times New Roman' }],
    [],
    [
      { value: 'NO', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'NO. BUKTI', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'TANGGAL', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'NAMA', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'BIDANG / KEGIATAN', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'JENJANG', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'STATUS', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'TARIF', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'JAMLAT', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'PPH 21', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
      { value: 'DITERIMA BERSIH', fontWeight: 'bold', align: 'center', backgroundColor: '#F1F5F9', borderStyle: 'thin', borderColor: '#000000' },
    ],
  ];

  items.forEach((tx, idx) => {
    const kotor = tx.tarif * tx.jamlat;
    const pajak = Math.round(kotor * tx.pajakRate);
    const bersih = kotor - pajak;
    const row: Row = [
      { value: idx + 1, type: Number, align: 'center', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.noBukti, type: String, align: 'left', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.tanggal, type: String, align: 'center', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.nama, type: String, align: 'left', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.jenis, type: String, align: 'left', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.jenjang, type: String, align: 'center', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.status, type: String, align: 'center', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.tarif, type: Number, format: '#,##0', align: 'right', borderStyle: 'thin', borderColor: '#000000' },
      { value: tx.jamlat, type: Number, align: 'center', borderStyle: 'thin', borderColor: '#000000' },
      { value: pajak, type: Number, format: '#,##0', align: 'right', borderStyle: 'thin', borderColor: '#000000' },
      { value: bersih, type: Number, format: '#,##0', align: 'right', borderStyle: 'thin', borderColor: '#000000' },
    ];
    data.push(row);
  });

  return {
    sheet: sheetName,
    orientation: 'landscape',
    columns: [
      { width: 6 },
      { width: 22 },
      { width: 18 },
      { width: 24 },
      { width: 20 },
      { width: 12 },
      { width: 22 },
      { width: 14 },
      { width: 9 },
      { width: 14 },
      { width: 16 },
    ],
    data,
  };
}

export async function downloadExcelReport(job: PrintJobMeta, ctx: OfficeDocContext): Promise<void> {
  const usedNames = new Set<string>();
  const sheets: Sheet<Blob>[] = [];

  if (job.type === 'rekap') {
    sheets.push(buildRekapExcelSheet(job.items, ctx, sanitizeSheetName('Rekapitulasi', usedNames)));
  } else if (job.type === 'dh') {
    if (job.items.length > 1) {
      sheets.push(buildMasterListExcelSheet(job.items, ctx, sanitizeSheetName('Ringkasan', usedNames)));
    }
    job.items.forEach((tx, idx) => {
      const label = sanitizeSheetName(`${idx + 1}. ${tx.nama}`, usedNames);
      sheets.push(buildDaftarHadirExcelSheet(tx, ctx, label));
    });
  } else {
    if (job.items.length > 1) {
      sheets.push(buildMasterListExcelSheet(job.items, ctx, sanitizeSheetName('Ringkasan SPJ', usedNames)));
    }
    job.items.forEach((tx, idx) => {
      const label = sanitizeSheetName(`${idx + 1}. ${tx.nama}`, usedNames);
      sheets.push(buildTandaTerimaExcelSheet(tx, ctx, label));
    });
  }

  await writeXlsxFile(sheets).toFile(`${job.docName}.xlsx`);
}

// ============================================================
// WORD (.docx) GENERATOR
// ============================================================

const BORDER_THIN = {
  top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
};

const BORDER_NONE = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function wordText(
  text: string,
  opts?: { bold?: boolean; underline?: boolean; sizePt?: number }
): TextRun {
  return new TextRun({
    text,
    font: 'Times New Roman',
    bold: opts?.bold ?? false,
    underline: opts?.underline ? {} : undefined,
    size: (opts?.sizePt ?? 10) * 2,
    color: '000000',
  });
}

function wordCell(
  text: string,
  opts?: {
    bold?: boolean;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    widthPct?: number;
    colSpan?: number;
    shading?: string;
    sizePt?: number;
    noBorder?: boolean;
    underline?: boolean;
  }
): TableCell {
  return new TableCell({
    columnSpan: opts?.colSpan,
    width: opts?.widthPct ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: opts?.shading ? { fill: opts.shading } : undefined,
    borders: opts?.noBorder ? BORDER_NONE : BORDER_THIN,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: opts?.align ?? AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [wordText(text, { bold: opts?.bold, sizePt: opts?.sizePt ?? 9.5, underline: opts?.underline })],
      }),
    ],
  });
}

export async function downloadWordReport(job: PrintJobMeta, ctx: OfficeDocContext): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  if (job.type === 'rekap') {
    const { rekapTitle, bulanUpper } = getRekapMeta(ctx);
    let totalKotor = 0;
    let totalPajak = 0;
    let totalBersih = 0;

    children.push(
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [wordText(rekapTitle, { bold: true, sizePt: 12 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [wordText('SEKOLAH RAKYAT TERINTEGRASI 39 GARUT', { bold: true, sizePt: 12 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [wordText(bulanUpper, { bold: true, sizePt: 12 })] })
    );

    const rows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          wordCell('NO', { bold: true, widthPct: 5, shading: 'F1F5F9' }),
          wordCell('NAMA KEGIATAN', { bold: true, widthPct: 41, shading: 'F1F5F9' }),
          wordCell('JUMLAH', { bold: true, widthPct: 11, shading: 'F1F5F9' }),
          wordCell('PAJAK PPH PSL 21', { bold: true, widthPct: 12, shading: 'F1F5F9' }),
          wordCell('DITERIMA', { bold: true, widthPct: 11, shading: 'F1F5F9' }),
          wordCell('Tanggal Bayar', { bold: true, widthPct: 11, shading: 'F1F5F9' }),
          wordCell('Tanda Tangan', { bold: true, widthPct: 9, shading: 'F1F5F9' }),
        ],
      }),
    ];

    job.items.forEach((tx, idx) => {
      const kotor = tx.tarif * tx.jamlat;
      const pajak = Math.round(kotor * tx.pajakRate);
      const bersih = kotor - pajak;
      totalKotor += kotor;
      totalPajak += pajak;
      totalBersih += bersih;

      const labelKegiatan =
        ctx.category === 'gurutamu'
          ? `Pembayaran Uang Transpor ${tx.jenis} ${tx.jenjang}`
          : ctx.category === 'lainnya'
            ? `Pembayaran Honorarium ${tx.jenis} (${tx.nama})`
            : `Pembayaran Honorarium Pembina Ekstrakurikuler ${tx.jenis} ${tx.jenjang}`;

      rows.push(
        new TableRow({
          children: [
            wordCell(String(idx + 1), { align: AlignmentType.CENTER }),
            wordCell(labelKegiatan, { align: AlignmentType.LEFT }),
            wordCell(formatNumber(kotor), { align: AlignmentType.RIGHT }),
            wordCell(formatNumber(pajak), { align: AlignmentType.RIGHT }),
            wordCell(formatNumber(bersih), { align: AlignmentType.RIGHT }),
            wordCell(tx.tanggal, { align: AlignmentType.CENTER }),
            wordCell(`${idx + 1}................`, { align: AlignmentType.LEFT }),
          ],
        })
      );
    });

    rows.push(
      new TableRow({
        children: [
          wordCell('TOTAL', { bold: true, colSpan: 2, shading: 'F8FAFC', align: AlignmentType.CENTER }),
          wordCell(formatNumber(totalKotor), { bold: true, shading: 'F8FAFC', align: AlignmentType.RIGHT }),
          wordCell(formatNumber(totalPajak), { bold: true, shading: 'F8FAFC', align: AlignmentType.RIGHT }),
          wordCell(formatNumber(totalBersih), { bold: true, shading: 'F8FAFC', align: AlignmentType.RIGHT }),
          wordCell('', { shading: 'F8FAFC' }),
          wordCell('', { shading: 'F8FAFC' }),
        ],
      })
    );

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
      }),
      new Paragraph({ spacing: { before: 240 }, children: [] }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              wordCell('', { widthPct: 68, noBorder: true }),
              new TableCell({
                width: { size: 32, type: WidthType.PERCENTAGE },
                borders: BORDER_NONE,
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(`Garut, ${ctx.month === 'ALL' ? 'Oktober' : ctx.month} 2026`, { sizePt: 10 })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [wordText('Kepala Sekolah SRT 39 Garut', { sizePt: 10 })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.kepsekName, { bold: true, underline: true, sizePt: 10 })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.kepsekNip, { sizePt: 10 })] }),
                ],
              }),
            ],
          }),
        ],
      })
    );
  }

  if (job.type === 'dh') {
    job.items.forEach((tx, index) => {
      const { rangkaLine, colJenisHeader } = getTxLabels(tx, ctx);

      children.push(
        new Paragraph({
          pageBreakBefore: index > 0,
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [wordText('KEMENTERIAN SOSIAL REPUBLIK INDONESIA', { bold: true, sizePt: 12 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 180 },
          children: [wordText('Pusat Pendidikan, Pelatihan dan Pengembangan Profesi', { bold: true, sizePt: 12 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [wordText('DAFTAR HADIR', { bold: true, sizePt: 11 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [wordText(rangkaLine, { bold: true, sizePt: 11 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [wordText(`DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${tx.tanggal}`, { bold: true, sizePt: 11 })],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                wordCell('NO', { bold: true, widthPct: 6, sizePt: 10 }),
                wordCell('NAMA/NRP', { bold: true, widthPct: 24, sizePt: 10 }),
                wordCell(colJenisHeader, { bold: true, widthPct: 18, sizePt: 10 }),
                wordCell('ASN/NON ASN', { bold: true, widthPct: 18, sizePt: 10 }),
                wordCell('JABATAN', { bold: true, widthPct: 18, sizePt: 10 }),
                wordCell('TANDA TANGAN', { bold: true, widthPct: 16, sizePt: 10 }),
              ],
            }),
            new TableRow({
              children: [
                wordCell('1', { bold: true, sizePt: 10.5 }),
                wordCell(tx.nama, { sizePt: 10.5 }),
                wordCell(tx.jenis, { sizePt: 10.5 }),
                wordCell(tx.status, { sizePt: 10.5 }),
                wordCell(tx.jabatan, { bold: true, sizePt: 10.5 }),
                wordCell('1.', { bold: true, align: AlignmentType.LEFT, sizePt: 10.5 }),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 320 }, children: [] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                wordCell('', { widthPct: 62, noBorder: true }),
                new TableCell({
                  width: { size: 38, type: WidthType.PERCENTAGE },
                  borders: BORDER_NONE,
                  children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(`Garut, ${tx.tanggal}`, { sizePt: 10.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText('Penanggung jawab Kegiatan', { sizePt: 10.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 650 }, children: [wordText('Kepala Sekolah SRT 39 Garut', { sizePt: 10.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.kepsekName, { underline: true, sizePt: 10.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.kepsekNip, { sizePt: 10.5 })] }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    });
  }

  if (job.type === 'tt') {
    job.items.forEach((tx, index) => {
      const kotor = tx.tarif * tx.jamlat;
      const pajak = Math.round(kotor * tx.pajakRate);
      const bersih = kotor - pajak;
      const { mainTitle, rangkaLine, rateHeader, colJenisHeader } = getTxLabels(tx, ctx);
      const pajakDisplay = pajak === 0 ? 'Rp   -' : formatNumber(pajak);

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 62, type: WidthType.PERCENTAGE },
                  borders: BORDER_NONE,
                  children: [
                    new Paragraph({
                      pageBreakBefore: index > 0,
                      children: [wordText('KEMENTERIAN SOSIAL REPUBLIK INDONESIA', { bold: true, sizePt: 10.5 })],
                    }),
                    new Paragraph({
                      children: [wordText('Pusat Pendidikan, Pelatihan dan Pengembangan Profesi', { bold: true, sizePt: 10.5 })],
                    }),
                  ],
                }),
                new TableCell({
                  width: { size: 38, type: WidthType.PERCENTAGE },
                  borders: BORDER_NONE,
                  children: [
                    new Paragraph({ children: [wordText(`No. Bukti Kas     : ${tx.noBukti}`, { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText(`Tgl. Pembukuan  : ${tx.tanggal}`, { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText('Mata Anggaran   : Honorarium Jasa Instruktur', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText('Tahun Anggaran  : 2026', { sizePt: 9.5 })] }),
                  ],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER, children: [wordText(mainTitle, { bold: true, sizePt: 11 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(rangkaLine, { bold: true, sizePt: 11 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [wordText(`DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${tx.tanggal}`, { bold: true, sizePt: 11 })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                wordCell('NO', { bold: true, widthPct: 4, sizePt: 9 }),
                wordCell('NAMA / NRP', { bold: true, widthPct: 16, sizePt: 9 }),
                wordCell(colJenisHeader, { bold: true, widthPct: 14, sizePt: 9 }),
                wordCell('ASN/NON ASN', { bold: true, widthPct: 12, sizePt: 9 }),
                wordCell(rateHeader, { bold: true, widthPct: 10, sizePt: 9 }),
                wordCell('JAMLAT', { bold: true, widthPct: 6, sizePt: 9 }),
                wordCell('JUMLAH KOTOR (Rp)', { bold: true, widthPct: 11, sizePt: 9 }),
                wordCell('Pph 21', { bold: true, widthPct: 7, sizePt: 9 }),
                wordCell('JUMLAH BERSIH (Rp)', { bold: true, widthPct: 10, sizePt: 9 }),
                wordCell('TANDA TANGAN', { bold: true, widthPct: 10, sizePt: 9 }),
              ],
            }),
            new TableRow({
              children: [
                wordCell('1', { sizePt: 9.5 }),
                wordCell(tx.nama, { sizePt: 9.5 }),
                wordCell(tx.jenis, { sizePt: 9.5 }),
                wordCell(tx.status, { sizePt: 9.5 }),
                wordCell(formatNumber(tx.tarif), { sizePt: 9.5 }),
                wordCell(String(tx.jamlat), { sizePt: 9.5 }),
                wordCell(formatNumber(kotor), { sizePt: 9.5 }),
                wordCell(pajakDisplay, { sizePt: 9.5 }),
                wordCell(formatNumber(bersih), { sizePt: 9.5 }),
                wordCell('1..............', { align: AlignmentType.LEFT, sizePt: 9.5 }),
              ],
            }),
            new TableRow({
              children: [
                wordCell('', { colSpan: 4 }),
                wordCell(formatNumber(tx.tarif), { bold: true, sizePt: 9.5 }),
                wordCell(''),
                wordCell(formatNumber(kotor), { bold: true, sizePt: 9.5 }),
                wordCell(formatNumber(pajak), { bold: true, sizePt: 9.5 }),
                wordCell(formatNumber(bersih), { bold: true, sizePt: 9.5 }),
                wordCell(''),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 240 }, children: [] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 32, type: WidthType.PERCENTAGE },
                  borders: BORDER_NONE,
                  children: [
                    new Paragraph({ children: [wordText('Setuju Dibayar', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText('an. Kuasa Pengguna Anggaran', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText('Pejabat Pembuat Komitmen', { sizePt: 9.5 })] }),
                    new Paragraph({ spacing: { after: 550 }, children: [wordText('Wilayah 10', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText(ctx.officials.ppkName, { underline: true, sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText(ctx.officials.ppkNip, { sizePt: 9.5 })] }),
                  ],
                }),
                new TableCell({
                  width: { size: 36, type: WidthType.PERCENTAGE },
                  borders: BORDER_NONE,
                  children: [
                    new Paragraph({ children: [wordText(' ', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText('Lunas Dibayar', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText(`Tanggal          ${tx.tanggal}`, { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText('Bendahara Pengeluaran Pembantu', { sizePt: 9.5 })] }),
                    new Paragraph({ spacing: { after: 400 }, children: [wordText('Wilayah 10', { sizePt: 9.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.bendName, { underline: true, sizePt: 9.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.bendNip, { sizePt: 9.5 })] }),
                  ],
                }),
                new TableCell({
                  width: { size: 32, type: WidthType.PERCENTAGE },
                  borders: BORDER_NONE,
                  children: [
                    new Paragraph({ children: [wordText(' ', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText(' ', { sizePt: 9.5 })] }),
                    new Paragraph({ children: [wordText(' ', { sizePt: 9.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText('Yang Membayarkan', { sizePt: 9.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [wordText('Kepala Sekolah SRT 39 Garut', { sizePt: 9.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.kepsekName, { underline: true, sizePt: 9.5 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [wordText(ctx.officials.kepsekNip, { sizePt: 9.5 })] }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    });
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: 11906,
              height: 16838,
            },
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveBlobFile(blob, `${job.docName}.docx`);
}
