import React, { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { CategoryType, Officials, Transaction } from '../types';
import { formatNumber } from '../utils/formatters';

interface SheetContextProps {
  category: CategoryType;
  month: string;
  officials: Officials;
  customMainTitle: string;
  customActivityTitle: string;
}

export const RekapSheet: React.FC<{ items: Transaction[] } & SheetContextProps> = ({
  items,
  category,
  month,
  officials,
  customActivityTitle,
}) => {
  const bulanUpper = month === 'ALL' ? 'TAHUN 2026' : `BULAN ${month.toUpperCase()} 2026`;
  let rekapTitle = 'REKAP HONOR EKSTRAKURIKULER';
  if (category === 'gurutamu') rekapTitle = 'REKAP UANG TRANSPOR GURU TAMU PAI DAN GURU MENGAJI';
  if (category === 'lainnya') rekapTitle = `REKAP HONORARIUM (${customActivityTitle.toUpperCase()})`;

  let totalKotor = 0;
  let totalPajak = 0;
  let totalBersih = 0;

  return (
    <div className="excel-sheet-wrapper">
      <div className="text-center font-bold leading-[1.35] mb-[14px]" style={{ fontSize: '13pt' }}>
        <div>{rekapTitle}</div>
        <div>SEKOLAH RAKYAT TERINTEGRASI 39 GARUT</div>
        <div>{bulanUpper}</div>
      </div>
      <table className="excel-table" style={{ fontSize: '10pt' }}>
        <thead>
          <tr className="bg-slate-50">
            <th style={{ width: '5%' }}>NO</th>
            <th style={{ width: '41%' }}>NAMA KEGIATAN</th>
            <th style={{ width: '11%' }}>JUMLAH</th>
            <th style={{ width: '12%' }}>PAJAK PPH PSL 21</th>
            <th style={{ width: '11%' }}>DITERIMA</th>
            <th style={{ width: '11%' }}>Tanggal Bayar</th>
            <th style={{ width: '9%' }}>Tanda Tangan</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center py-4">
                Belum ada data transaksi pada periode ini
              </td>
            </tr>
          ) : (
            items.map((tx, idx) => {
              const kotor = tx.tarif * tx.jamlat;
              const pajak = Math.round(kotor * tx.pajakRate);
              const bersih = kotor - pajak;
              totalKotor += kotor;
              totalPajak += pajak;
              totalBersih += bersih;

              const labelKegiatan =
                category === 'gurutamu'
                  ? `Pembayaran Uang Transpor ${tx.jenis} ${tx.jenjang}`
                  : category === 'lainnya'
                    ? `Pembayaran Honorarium ${tx.jenis} (${tx.nama})`
                    : `Pembayaran Honorarium Pembina Ekstrakurikuler ${tx.jenis} ${tx.jenjang}`;

              return (
                <tr key={tx.id}>
                  <td className="text-center">{idx + 1}</td>
                  <td className="text-left">{labelKegiatan}</td>
                  <td className="text-right">{formatNumber(kotor)}</td>
                  <td className="text-right">{formatNumber(pajak)}</td>
                  <td className="text-right">{formatNumber(bersih)}</td>
                  <td className="text-center">{tx.tanggal}</td>
                  <td className="text-left">{idx + 1}................</td>
                </tr>
              );
            })
          )}
          <tr className="font-bold bg-slate-50">
            <td colSpan={2} className="text-center">
              TOTAL
            </td>
            <td className="text-right">{formatNumber(totalKotor)}</td>
            <td className="text-right">{formatNumber(totalPajak)}</td>
            <td className="text-right">{formatNumber(totalBersih)}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div className="mt-[26px] flex justify-end" style={{ fontSize: '10.5pt' }}>
        <div className="w-[260px] text-center">
          <div>Garut, {month === 'ALL' ? 'Oktober' : month} 2026</div>
          <div>Kepala Sekolah SRT 39 Garut</div>
          <div className="h-[56px]" />
          <div className="font-bold underline">{officials.kepsekName}</div>
          <div>{officials.kepsekNip}</div>
        </div>
      </div>
    </div>
  );
};

export const DaftarHadirSheet: React.FC<{ tx: Transaction } & SheetContextProps> = ({
  tx,
  category,
  officials,
  customActivityTitle,
}) => {
  let rangkaLine = `DALAM RANGKA KEGIATAN EKSTRAKURIKULER SISWA ${tx.jenjang}`;
  let colJenisHeader = 'JENIS EKSTRAKURIKULER';
  if (category === 'gurutamu') {
    rangkaLine = `DALAM RANGKA KEGIATAN GURU TAMU SISWA ${tx.jenjang}`;
    colJenisHeader = 'JENIS KEGIATAN';
  } else if (category === 'lainnya') {
    rangkaLine = (tx.customRangka || customActivityTitle).toUpperCase();
    colJenisHeader = 'JENIS KEGIATAN';
  }

  return (
    <div className="excel-sheet-wrapper">
      <div className="text-center font-bold leading-[1.4] mb-[14px]" style={{ fontSize: '12.5pt' }}>
        <div>KEMENTERIAN SOSIAL REPUBLIK INDONESIA</div>
        <div>Pusat Pendidikan, Pelatihan dan Pengembangan Profesi</div>
      </div>
      <div className="text-center font-bold leading-[1.4] mb-[16px]" style={{ fontSize: '11pt' }}>
        <div>DAFTAR HADIR</div>
        <div>{rangkaLine}</div>
        <div>DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL {tx.tanggal}</div>
      </div>
      <table className="excel-table" style={{ fontSize: '10.5pt' }}>
        <thead>
          <tr>
            <th style={{ width: '6%', padding: '10px 6px' }}>NO</th>
            <th style={{ width: '24%', padding: '10px 6px' }}>NAMA/NRP</th>
            <th style={{ width: '18%', padding: '10px 6px' }}>{colJenisHeader}</th>
            <th style={{ width: '18%', padding: '10px 6px' }}>ASN/NON ASN</th>
            <th style={{ width: '18%', padding: '10px 6px' }}>JABATAN</th>
            <th style={{ width: '16%', padding: '10px 6px' }}>TANDA TANGAN</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-center font-bold" style={{ height: '72px' }}>
              1
            </td>
            <td className="text-center">{tx.nama}</td>
            <td className="text-center">{tx.jenis}</td>
            <td className="text-center">{tx.status}</td>
            <td className="text-center font-bold">{tx.jabatan}</td>
            <td className="text-left font-bold" style={{ paddingLeft: '10px' }}>
              1.
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-[28px] flex justify-end" style={{ fontSize: '10.5pt' }}>
        <div className="w-[290px] text-center leading-[1.45]" style={{ marginRight: '10%' }}>
          <div>Garut, {tx.tanggal}</div>
          <div>Penanggung jawab Kegiatan</div>
          <div>Kepala Sekolah SRT 39 Garut</div>
          <div className="h-[64px]" />
          <div className="underline">{officials.kepsekName}</div>
          <div>{officials.kepsekNip}</div>
        </div>
      </div>
    </div>
  );
};

export const TandaTerimaSheet: React.FC<{ tx: Transaction } & SheetContextProps> = ({
  tx,
  category,
  officials,
  customMainTitle,
  customActivityTitle,
}) => {
  const kotor = tx.tarif * tx.jamlat;
  const pajak = Math.round(kotor * tx.pajakRate);
  const bersih = kotor - pajak;

  let mainTitle = 'TANDA TERIMA HONOR PELATIH';
  let rangkaLine = `DALAM RANGKA KEGIATAN EKSTRAKURIKULER SISWA ${tx.jenjang}`;
  let rateHeader = 'HONOR (Rp)';
  let colJenisHeader = 'JENIS EKSTRAKURIKULER';

  if (category === 'gurutamu') {
    mainTitle = 'TANDA TERIMA TRANSPORT';
    rangkaLine = `DALAM RANGKA KEGIATAN GURU TAMU SISWA ${tx.jenjang}`;
    rateHeader = 'TRANSPORT (Rp)';
    colJenisHeader = 'JENIS KEGIATAN';
  } else if (category === 'lainnya') {
    mainTitle = customMainTitle.toUpperCase();
    rangkaLine = (tx.customRangka || customActivityTitle).toUpperCase();
    rateHeader = 'HONOR (Rp)';
    colJenisHeader = 'JENIS KEGIATAN';
  }

  return (
    <div className="excel-sheet-wrapper">
      <div className="flex justify-between items-start mb-[14px]">
        <div className="font-bold leading-[1.4]" style={{ fontSize: '11pt' }}>
          <div>KEMENTERIAN SOSIAL REPUBLIK INDONESIA</div>
          <div>Pusat Pendidikan, Pelatihan dan Pengembangan Profesi</div>
        </div>
        <table className="border-collapse" style={{ fontSize: '9.5pt' }}>
          <tbody>
            <tr>
              <td style={{ padding: '1px 12px 1px 0' }}>No. Bukti Kas</td>
              <td style={{ padding: '1px 0' }}>: {tx.noBukti}</td>
            </tr>
            <tr>
              <td style={{ padding: '1px 12px 1px 0' }}>Tgl. Pembukuan</td>
              <td style={{ padding: '1px 0' }}>: {tx.tanggal}</td>
            </tr>
            <tr>
              <td style={{ padding: '1px 12px 1px 0' }}>Mata Anggaran</td>
              <td style={{ padding: '1px 0' }}>: Honorarium Jasa Instruktur</td>
            </tr>
            <tr>
              <td style={{ padding: '1px 12px 1px 0' }}>Tahun Anggaran</td>
              <td style={{ padding: '1px 0' }}>: 2026</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-center font-bold leading-[1.4] mb-[14px]" style={{ fontSize: '11pt' }}>
        <div>{mainTitle}</div>
        <div>{rangkaLine}</div>
        <div>DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL {tx.tanggal}</div>
      </div>

      <table className="excel-table" style={{ fontSize: '9.5pt' }}>
        <thead>
          <tr>
            <th style={{ width: '4%', padding: '8px 4px' }}>NO</th>
            <th style={{ width: '16%', padding: '8px 4px' }}>NAMA / NRP</th>
            <th style={{ width: '14%', padding: '8px 4px' }}>{colJenisHeader}</th>
            <th style={{ width: '12%', padding: '8px 4px' }}>ASN/NON ASN</th>
            <th style={{ width: '10%', padding: '8px 4px' }}>{rateHeader}</th>
            <th style={{ width: '6%', padding: '8px 4px' }}>JAMLAT</th>
            <th style={{ width: '11%', padding: '8px 4px' }}>JUMLAH KOTOR (Rp)</th>
            <th style={{ width: '7%', padding: '8px 4px' }}>Pph 21</th>
            <th style={{ width: '10%', padding: '8px 4px' }}>JUMLAH BERSIH (Rp)</th>
            <th style={{ width: '10%', padding: '8px 4px' }}>TANDA TANGAN</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-center" style={{ height: '48px' }}>
              1
            </td>
            <td className="text-center">{tx.nama}</td>
            <td className="text-center">{tx.jenis}</td>
            <td className="text-center">{tx.status}</td>
            <td className="text-center">{formatNumber(tx.tarif)}</td>
            <td className="text-center">{tx.jamlat}</td>
            <td className="text-center">{formatNumber(kotor)}</td>
            <td className="text-center">{pajak === 0 ? 'Rp   -' : formatNumber(pajak)}</td>
            <td className="text-center">{formatNumber(bersih)}</td>
            <td className="text-left" style={{ paddingLeft: '6px' }}>
              1..............
            </td>
          </tr>
          <tr className="font-bold">
            <td colSpan={4} style={{ height: '26px' }} />
            <td className="text-center">{formatNumber(tx.tarif)}</td>
            <td />
            <td className="text-center">{formatNumber(kotor)}</td>
            <td className="text-center">{formatNumber(pajak)}</td>
            <td className="text-center">{formatNumber(bersih)}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <div
        className="mt-[22px] grid gap-[12px] leading-[1.4]"
        style={{ gridTemplateColumns: '1fr 1.15fr 1fr', fontSize: '9.5pt' }}
      >
        <div style={{ paddingLeft: '14px' }}>
          <div>Setuju Dibayar</div>
          <div>an. Kuasa Pengguna Anggaran</div>
          <div>Pejabat Pembuat Komitmen</div>
          <div>Wilayah 10</div>
          <div className="h-[52px]" />
          <div className="underline">{officials.ppkName}</div>
          <div>{officials.ppkNip}</div>
        </div>
        <div>
          <div>&nbsp;</div>
          <div>Lunas Dibayar</div>
          <div>Tanggal &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {tx.tanggal}</div>
          <div>Bendahara Pengeluaran Pembantu</div>
          <div>Wilayah 10</div>
          <div className="h-[36px]" />
          <div className="text-center">
            <div className="underline">{officials.bendName}</div>
            <div>{officials.bendNip}</div>
          </div>
        </div>
        <div className="text-center">
          <div>&nbsp;</div>
          <div>&nbsp;</div>
          <div>&nbsp;</div>
          <div>Yang Membayarkan</div>
          <div>Kepala Sekolah SRT 39 Garut</div>
          <div className="h-[36px]" />
          <div className="underline">{officials.kepsekName}</div>
          <div>{officials.kepsekNip}</div>
        </div>
      </div>
    </div>
  );
};

export const ResponsiveSheetFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [compactFit, setCompactFit] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between md:hidden px-1">
        <span className="text-xs text-slate-500">Geser horizontal untuk melihat seluruh kolom A4</span>
        <button
          type="button"
          onClick={() => setCompactFit((v) => !v)}
          className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 flex items-center gap-1.5"
        >
          {compactFit ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          {compactFit ? 'Ukuran Asli' : 'Perkecil di HP'}
        </button>
      </div>
      <div className="overflow-x-auto pb-2 -mx-1 px-1">
        <div
          className={
            compactFit
              ? 'origin-top-left scale-[0.34] sm:scale-[0.58] md:scale-100 w-[297mm]'
              : 'min-w-fit'
          }
          style={compactFit ? { marginBottom: '-120mm' } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
