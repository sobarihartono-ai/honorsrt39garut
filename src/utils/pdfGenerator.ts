import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CategoryType, Officials, PrintJobMeta, Transaction } from '../types';
import { formatNumber } from './formatters';

interface DocContext {
  category: CategoryType;
  month: string;
  officials: Officials;
  customMainTitle: string;
  customActivityTitle: string;
}

function escapeHtml(str: string | number | undefined): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildVectorPDF(job: PrintJobMeta, ctx: DocContext): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth(); // 297mm
  const marginX = 12;

  doc.setFont('times', 'normal');
  doc.setTextColor(0, 0, 0);

  if (job.type === 'rekap') {
    const list = job.items || [];
    const bulanUpper = ctx.month === 'ALL' ? 'TAHUN 2026' : `BULAN ${ctx.month.toUpperCase()} 2026`;
    let rekapTitle = 'REKAP HONOR EKSTRAKURIKULER';
    if (ctx.category === 'gurutamu') {
      rekapTitle = 'REKAP UANG TRANSPOR GURU TAMU PAI DAN GURU MENGAJI';
    } else if (ctx.category === 'lainnya') {
      rekapTitle = `REKAP HONORARIUM (${ctx.customActivityTitle.toUpperCase()})`;
    }

    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.text(rekapTitle, pageW / 2, 16, { align: 'center' });
    doc.text('SEKOLAH RAKYAT TERINTEGRASI 39 GARUT', pageW / 2, 21.5, { align: 'center' });
    doc.text(bulanUpper, pageW / 2, 27, { align: 'center' });

    let totalKotor = 0;
    let totalPajak = 0;
    let totalBersih = 0;

    const bodyRows: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = list.map(
      (tx, idx) => {
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
        return [
          String(idx + 1),
          labelKegiatan,
          formatNumber(kotor),
          formatNumber(pajak),
          formatNumber(bersih),
          tx.tanggal,
          `${idx + 1}................`,
        ];
      }
    );

    bodyRows.push([
      { content: 'TOTAL', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: [248, 250, 252] } },
      { content: formatNumber(totalKotor), styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252] } },
      { content: formatNumber(totalPajak), styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252] } },
      { content: formatNumber(totalBersih), styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252] } },
      { content: '', styles: { fillColor: [248, 250, 252] } },
      { content: '', styles: { fillColor: [248, 250, 252] } },
    ]);

    autoTable(doc, {
      startY: 33,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      styles: {
        font: 'times',
        fontSize: 9.5,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.25,
        cellPadding: 2.2,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
      },
      head: [['NO', 'NAMA KEGIATAN', 'JUMLAH', 'PAJAK PPH PSL 21', 'DITERIMA', 'Tanggal Bayar', 'Tanda Tangan']],
      body: bodyRows,
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 113, halign: 'left' },
        2: { cellWidth: 30, halign: 'right' },
        3: { cellWidth: 32, halign: 'right' },
        4: { cellWidth: 30, halign: 'right' },
        5: { cellWidth: 30, halign: 'center' },
        6: { cellWidth: 26, halign: 'left' },
      },
    });

    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;
    const finalY = lastY + 10;
    const signX = pageW - marginX - 35;
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.text(`Garut, ${ctx.month === 'ALL' ? 'Oktober' : ctx.month} 2026`, signX, finalY, { align: 'center' });
    doc.text('Kepala Sekolah SRT 39 Garut', signX, finalY + 5, { align: 'center' });
    doc.setFont('times', 'bold');
    doc.text(ctx.officials.kepsekName, signX, finalY + 23, { align: 'center' });
    const nameW = doc.getTextWidth(ctx.officials.kepsekName);
    doc.line(signX - nameW / 2, finalY + 23.8, signX + nameW / 2, finalY + 23.8);
    doc.setFont('times', 'normal');
    doc.text(ctx.officials.kepsekNip, signX, finalY + 28.5, { align: 'center' });
  }

  if (job.type === 'dh') {
    (job.items || []).forEach((tx, index) => {
      if (index > 0) doc.addPage();

      let rangkaLine = `DALAM RANGKA KEGIATAN EKSTRAKURIKULER SISWA ${tx.jenjang}`;
      let colJenisHeader = 'JENIS EKSTRAKURIKULER';
      if (ctx.category === 'gurutamu') {
        rangkaLine = `DALAM RANGKA KEGIATAN GURU TAMU SISWA ${tx.jenjang}`;
        colJenisHeader = 'JENIS KEGIATAN';
      } else if (ctx.category === 'lainnya') {
        rangkaLine = (tx.customRangka || ctx.customActivityTitle).toUpperCase();
        colJenisHeader = 'JENIS KEGIATAN';
      }

      doc.setFont('times', 'bold');
      doc.setFontSize(12);
      doc.text('KEMENTERIAN SOSIAL REPUBLIK INDONESIA', pageW / 2, 18, { align: 'center' });
      doc.text('Pusat Pendidikan, Pelatihan dan Pengembangan Profesi', pageW / 2, 24, { align: 'center' });

      doc.setFontSize(11);
      doc.text('DAFTAR HADIR', pageW / 2, 34, { align: 'center' });
      doc.text(rangkaLine, pageW / 2, 39.5, { align: 'center' });
      doc.text(`DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${tx.tanggal}`, pageW / 2, 45, { align: 'center' });

      autoTable(doc, {
        startY: 52,
        margin: { left: marginX, right: marginX },
        theme: 'grid',
        styles: {
          font: 'times',
          fontSize: 10.5,
          textColor: [0, 0, 0],
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          valign: 'middle',
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          halign: 'center',
          minCellHeight: 11,
        },
        bodyStyles: { minCellHeight: 36 },
        head: [['NO', 'NAMA/NRP', colJenisHeader, 'ASN/NON ASN', 'JABATAN', 'TANDA TANGAN']],
        body: [
          [
            { content: '1', styles: { halign: 'center', fontStyle: 'bold' } },
            { content: tx.nama, styles: { halign: 'center' } },
            { content: tx.jenis, styles: { halign: 'center' } },
            { content: tx.status, styles: { halign: 'center' } },
            { content: tx.jabatan, styles: { halign: 'center', fontStyle: 'bold' } },
            { content: '1.', styles: { halign: 'left', fontStyle: 'bold', cellPadding: { left: 4 } } },
          ],
        ],
        columnStyles: {
          0: { cellWidth: 12 },
          1: { cellWidth: 60 },
          2: { cellWidth: 46 },
          3: { cellWidth: 57 },
          4: { cellWidth: 49 },
          5: { cellWidth: 49 },
        },
      });

      const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
      const finalY = lastY + 14;
      const signX = pageW - marginX - 38;
      doc.setFont('times', 'normal');
      doc.setFontSize(10.5);
      doc.text(`Garut, ${tx.tanggal}`, signX, finalY, { align: 'center' });
      doc.text('Penanggung jawab Kegiatan', signX, finalY + 5.5, { align: 'center' });
      doc.text('Kepala Sekolah SRT 39 Garut', signX, finalY + 11, { align: 'center' });

      doc.text(ctx.officials.kepsekName, signX, finalY + 32, { align: 'center' });
      const nameW = doc.getTextWidth(ctx.officials.kepsekName);
      doc.line(signX - nameW / 2, finalY + 32.8, signX + nameW / 2, finalY + 32.8);
      doc.text(ctx.officials.kepsekNip, signX, finalY + 38, { align: 'center' });
    });
  }

  if (job.type === 'tt') {
    (job.items || []).forEach((tx, index) => {
      if (index > 0) doc.addPage();

      const kotor = tx.tarif * tx.jamlat;
      const pajak = Math.round(kotor * tx.pajakRate);
      const bersih = kotor - pajak;

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

      const pajakDisplay = pajak === 0 ? 'Rp   -' : formatNumber(pajak);

      doc.setFont('times', 'bold');
      doc.setFontSize(10.5);
      doc.text('KEMENTERIAN SOSIAL REPUBLIK INDONESIA', marginX, 16);
      doc.text('Pusat Pendidikan, Pelatihan dan Pengembangan Profesi', marginX, 21.5);

      const metaLabelX = pageW - marginX - 78;
      const metaValX = pageW - marginX - 48;
      doc.setFont('times', 'normal');
      doc.setFontSize(9.5);
      doc.text('No. Bukti Kas', metaLabelX, 16);
      doc.text(`: ${tx.noBukti}`, metaValX, 16);
      doc.text('Tgl. Pembukuan', metaLabelX, 21);
      doc.text(`: ${tx.tanggal}`, metaValX, 21);
      doc.text('Mata Anggaran', metaLabelX, 26);
      doc.text(': Honorarium Jasa Instruktur', metaValX, 26);
      doc.text('Tahun Anggaran', metaLabelX, 31);
      doc.text(': 2026', metaValX, 31);

      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.text(mainTitle, pageW / 2, 40, { align: 'center' });
      doc.text(rangkaLine, pageW / 2, 45.5, { align: 'center' });
      doc.text(`DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${tx.tanggal}`, pageW / 2, 51, { align: 'center' });

      autoTable(doc, {
        startY: 57,
        margin: { left: marginX, right: marginX },
        theme: 'grid',
        styles: {
          font: 'times',
          fontSize: 9.5,
          textColor: [0, 0, 0],
          lineColor: [0, 0, 0],
          lineWidth: 0.3,
          valign: 'middle',
          halign: 'center',
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          minCellHeight: 11,
        },
        head: [
          [
            'NO',
            'NAMA / NRP',
            colJenisHeader,
            'ASN/NON ASN',
            rateHeader,
            'JAMLAT',
            'JUMLAH KOTOR (Rp)',
            'Pph 21',
            'JUMLAH BERSIH (Rp)',
            'TANDA TANGAN',
          ],
        ],
        body: [
          [
            { content: '1', styles: { minCellHeight: 15 } },
            { content: tx.nama, styles: { minCellHeight: 15 } },
            { content: tx.jenis, styles: { minCellHeight: 15 } },
            { content: tx.status, styles: { minCellHeight: 15 } },
            { content: formatNumber(tx.tarif), styles: { minCellHeight: 15 } },
            { content: String(tx.jamlat), styles: { minCellHeight: 15 } },
            { content: formatNumber(kotor), styles: { minCellHeight: 15 } },
            { content: pajakDisplay, styles: { minCellHeight: 15 } },
            { content: formatNumber(bersih), styles: { minCellHeight: 15 } },
            { content: '1..............', styles: { halign: 'left', cellPadding: { left: 2 }, minCellHeight: 15 } },
          ],
          [
            { content: '', colSpan: 4, styles: { minCellHeight: 8 } },
            { content: formatNumber(tx.tarif), styles: { fontStyle: 'bold', minCellHeight: 8 } },
            { content: '', styles: { minCellHeight: 8 } },
            { content: formatNumber(kotor), styles: { fontStyle: 'bold', minCellHeight: 8 } },
            { content: formatNumber(pajak), styles: { fontStyle: 'bold', minCellHeight: 8 } },
            { content: formatNumber(bersih), styles: { fontStyle: 'bold', minCellHeight: 8 } },
            { content: '', styles: { minCellHeight: 8 } },
          ],
        ],
        columnStyles: {
          0: { cellWidth: 11 },
          1: { cellWidth: 44 },
          2: { cellWidth: 38 },
          3: { cellWidth: 34 },
          4: { cellWidth: 27 },
          5: { cellWidth: 17 },
          6: { cellWidth: 30 },
          7: { cellWidth: 19 },
          8: { cellWidth: 28 },
          9: { cellWidth: 25 },
        },
      });

      const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 110;
      const finalY = lastY + 11;
      doc.setFont('times', 'normal');
      doc.setFontSize(9.5);

      const col1X = marginX + 4;
      doc.text('Setuju Dibayar', col1X, finalY);
      doc.text('an. Kuasa Pengguna Anggaran', col1X, finalY + 5);
      doc.text('Pejabat Pembuat Komitmen', col1X, finalY + 10);
      doc.text('Wilayah 10', col1X, finalY + 15);
      doc.text(ctx.officials.ppkName, col1X + 18, finalY + 34, { align: 'center' });
      const ppkW = doc.getTextWidth(ctx.officials.ppkName);
      doc.line(col1X + 18 - ppkW / 2, finalY + 34.7, col1X + 18 + ppkW / 2, finalY + 34.7);
      doc.text(ctx.officials.ppkNip, col1X + 18, finalY + 39.5, { align: 'center' });

      const col2X = marginX + 104;
      doc.text('Lunas Dibayar', col2X, finalY + 5);
      doc.text(`Tanggal                 ${tx.tanggal}`, col2X, finalY + 10);
      doc.text('Bendahara Pengeluaran Pembantu', col2X, finalY + 15);
      doc.text('Wilayah 10', col2X, finalY + 20);
      doc.text(ctx.officials.bendName, col2X + 26, finalY + 34, { align: 'center' });
      const bendW = doc.getTextWidth(ctx.officials.bendName);
      doc.line(col2X + 26 - bendW / 2, finalY + 34.7, col2X + 26 + bendW / 2, finalY + 34.7);
      doc.text(ctx.officials.bendNip, col2X + 26, finalY + 39.5, { align: 'center' });

      const col3X = pageW - marginX - 34;
      doc.text('Yang Membayarkan', col3X, finalY + 15, { align: 'center' });
      doc.text('Kepala Sekolah SRT 39 Garut', col3X, finalY + 20, { align: 'center' });
      doc.text(ctx.officials.kepsekName, col3X, finalY + 34, { align: 'center' });
      const kepW = doc.getTextWidth(ctx.officials.kepsekName);
      doc.line(col3X - kepW / 2, finalY + 34.7, col3X + kepW / 2, finalY + 34.7);
      doc.text(ctx.officials.kepsekNip, col3X, finalY + 39.5, { align: 'center' });
    });
  }

  return doc;
}

function renderRekapHTMLString(items: Transaction[], ctx: DocContext): string {
  const bulanUpper = ctx.month === 'ALL' ? 'TAHUN 2026' : `BULAN ${ctx.month.toUpperCase()} 2026`;
  let rekapTitle = 'REKAP HONOR EKSTRAKURIKULER';
  if (ctx.category === 'gurutamu') rekapTitle = 'REKAP UANG TRANSPOR GURU TAMU PAI DAN GURU MENGAJI';
  if (ctx.category === 'lainnya') rekapTitle = `REKAP HONORARIUM (${ctx.customActivityTitle.toUpperCase()})`;

  let totalKotor = 0;
  let totalPajak = 0;
  let totalBersih = 0;

  const rows = items
    .map((tx, idx) => {
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

      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td style="text-align:left;">${escapeHtml(labelKegiatan)}</td>
          <td style="text-align:right;">${formatNumber(kotor)}</td>
          <td style="text-align:right;">${formatNumber(pajak)}</td>
          <td style="text-align:right;">${formatNumber(bersih)}</td>
          <td style="text-align:center;">${escapeHtml(tx.tanggal)}</td>
          <td style="text-align:left;">${idx + 1}................</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="excel-sheet-wrapper">
      <div style="text-align:center; font-weight:bold; font-size:13pt; line-height:1.35; margin-bottom:14px;">
        <div>${escapeHtml(rekapTitle)}</div>
        <div>SEKOLAH RAKYAT TERINTEGRASI 39 GARUT</div>
        <div>${escapeHtml(bulanUpper)}</div>
      </div>
      <table class="excel-table" style="font-size:10pt;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="width:5%;">NO</th>
            <th style="width:41%;">NAMA KEGIATAN</th>
            <th style="width:11%;">JUMLAH</th>
            <th style="width:12%;">PAJAK PPH PSL 21</th>
            <th style="width:11%;">DITERIMA</th>
            <th style="width:11%;">Tanggal Bayar</th>
            <th style="width:9%;">Tanda Tangan</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7" style="text-align:center; padding:16px;">Belum ada data transaksi pada periode ini</td></tr>'}
          <tr style="font-weight:bold; background:#f8fafc;">
            <td colspan="2" style="text-align:center;">TOTAL</td>
            <td style="text-align:right;">${formatNumber(totalKotor)}</td>
            <td style="text-align:right;">${formatNumber(totalPajak)}</td>
            <td style="text-align:right;">${formatNumber(totalBersih)}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:26px; display:flex; justify-content:flex-end; font-size:10.5pt;">
        <div style="width:260px; text-align:center;">
          <div>Garut, ${escapeHtml(ctx.month === 'ALL' ? 'Oktober' : ctx.month)} 2026</div>
          <div>Kepala Sekolah SRT 39 Garut</div>
          <div style="height:56px;"></div>
          <div style="font-weight:bold; text-decoration:underline;">${escapeHtml(ctx.officials.kepsekName)}</div>
          <div>${escapeHtml(ctx.officials.kepsekNip)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderDaftarHadirHTMLString(tx: Transaction, ctx: DocContext): string {
  let rangkaLine = `DALAM RANGKA KEGIATAN EKSTRAKURIKULER SISWA ${tx.jenjang}`;
  let colJenisHeader = 'JENIS EKSTRAKURIKULER';
  if (ctx.category === 'gurutamu') {
    rangkaLine = `DALAM RANGKA KEGIATAN GURU TAMU SISWA ${tx.jenjang}`;
    colJenisHeader = 'JENIS KEGIATAN';
  } else if (ctx.category === 'lainnya') {
    rangkaLine = (tx.customRangka || ctx.customActivityTitle).toUpperCase();
    colJenisHeader = 'JENIS KEGIATAN';
  }

  return `
    <div class="excel-sheet-wrapper">
      <div style="text-align:center; font-weight:bold; font-size:12.5pt; line-height:1.4; margin-bottom:14px;">
        <div>KEMENTERIAN SOSIAL REPUBLIK INDONESIA</div>
        <div>Pusat Pendidikan, Pelatihan dan Pengembangan Profesi</div>
      </div>
      <div style="text-align:center; font-weight:bold; font-size:11pt; line-height:1.4; margin-bottom:16px;">
        <div>DAFTAR HADIR</div>
        <div>${escapeHtml(rangkaLine)}</div>
        <div>DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${escapeHtml(tx.tanggal)}</div>
      </div>
      <table class="excel-table" style="font-size:10.5pt;">
        <thead>
          <tr>
            <th style="width:4%; padding:10px 6px;">NO</th>
            <th style="width:22%; padding:10px 6px;">NAMA/NRP</th>
            <th style="width:17%; padding:10px 6px;">${escapeHtml(colJenisHeader)}</th>
            <th style="width:21%; padding:10px 6px;">ASN/NON ASN</th>
            <th style="width:18%; padding:10px 6px;">JABATAN</th>
            <th style="width:18%; padding:10px 6px;">TANDA TANGAN</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align:center; font-weight:bold; height:132px; vertical-align:middle;">1</td>
            <td style="text-align:center;">${escapeHtml(tx.nama)}</td>
            <td style="text-align:center;">${escapeHtml(tx.jenis)}</td>
            <td style="text-align:center;">${escapeHtml(tx.status)}</td>
            <td style="text-align:center; font-weight:bold;">${escapeHtml(tx.jabatan)}</td>
            <td style="text-align:left; font-weight:bold; padding-left:10px; vertical-align:middle;">1.</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:28px; display:flex; justify-content:flex-end; font-size:10.5pt;">
        <div style="width:290px; text-align:center; line-height:1.45; margin-right:10%;">
          <div>Garut, ${escapeHtml(tx.tanggal)}</div>
          <div>Penanggung jawab Kegiatan</div>
          <div>Kepala Sekolah SRT 39 Garut</div>
          <div style="height:64px;"></div>
          <div style="text-decoration:underline;">${escapeHtml(ctx.officials.kepsekName)}</div>
          <div>${escapeHtml(ctx.officials.kepsekNip)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderTandaTerimaHTMLString(tx: Transaction, ctx: DocContext): string {
  const kotor = tx.tarif * tx.jamlat;
  const pajak = Math.round(kotor * tx.pajakRate);
  const bersih = kotor - pajak;

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

  const pajakDisplay = pajak === 0 ? 'Rp &nbsp;&nbsp;-' : formatNumber(pajak);

  return `
    <div class="excel-sheet-wrapper">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
        <div style="font-weight:bold; font-size:11pt; line-height:1.4;">
          <div>KEMENTERIAN SOSIAL REPUBLIK INDONESIA</div>
          <div>Pusat Pendidikan, Pelatihan dan Pengembangan Profesi</div>
        </div>
        <table style="font-size:9.5pt; border-collapse:collapse;">
          <tr><td style="padding:1px 12px 1px 0;">No. Bukti Kas</td><td style="padding:1px 0;">: ${escapeHtml(tx.noBukti)}</td></tr>
          <tr><td style="padding:1px 12px 1px 0;">Tgl. Pembukuan</td><td style="padding:1px 0;">: ${escapeHtml(tx.tanggal)}</td></tr>
          <tr><td style="padding:1px 12px 1px 0;">Mata Anggaran</td><td style="padding:1px 0;">: Honorarium Jasa Instruktur</td></tr>
          <tr><td style="padding:1px 12px 1px 0;">Tahun Anggaran</td><td style="padding:1px 0;">: 2026</td></tr>
        </table>
      </div>

      <div style="text-align:center; font-weight:bold; font-size:11pt; line-height:1.4; margin-bottom:14px;">
        <div>${escapeHtml(mainTitle)}</div>
        <div>${escapeHtml(rangkaLine)}</div>
        <div>DI SEKOLAH RAKYAT TERINTEGRASI 39 GARUT, TANGGAL ${escapeHtml(tx.tanggal)}</div>
      </div>

      <table class="excel-table" style="font-size:9.5pt;">
        <thead>
          <tr>
            <th style="width:4%; padding:8px 4px;">NO</th>
            <th style="width:16%; padding:8px 4px;">NAMA / NRP</th>
            <th style="width:14%; padding:8px 4px;">${escapeHtml(colJenisHeader)}</th>
            <th style="width:12%; padding:8px 4px;">ASN/NON ASN</th>
            <th style="width:10%; padding:8px 4px;">${escapeHtml(rateHeader)}</th>
            <th style="width:6%; padding:8px 4px;">JAMLAT</th>
            <th style="width:11%; padding:8px 4px;">JUMLAH KOTOR (Rp)</th>
            <th style="width:7%; padding:8px 4px;">Pph 21</th>
            <th style="width:10%; padding:8px 4px;">JUMLAH BERSIH (Rp)</th>
            <th style="width:10%; padding:8px 4px;">TANDA TANGAN</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align:center; height:48px;">1</td>
            <td style="text-align:center;">${escapeHtml(tx.nama)}</td>
            <td style="text-align:center;">${escapeHtml(tx.jenis)}</td>
            <td style="text-align:center;">${escapeHtml(tx.status)}</td>
            <td style="text-align:center;">${formatNumber(tx.tarif)}</td>
            <td style="text-align:center;">${tx.jamlat}</td>
            <td style="text-align:center;">${formatNumber(kotor)}</td>
            <td style="text-align:center;">${pajakDisplay}</td>
            <td style="text-align:center;">${formatNumber(bersih)}</td>
            <td style="text-align:left; padding-left:6px;">1..............</td>
          </tr>
          <tr style="font-weight:bold;">
            <td colspan="4" style="height:26px;"></td>
            <td style="text-align:center;">${formatNumber(tx.tarif)}</td>
            <td></td>
            <td style="text-align:center;">${formatNumber(kotor)}</td>
            <td style="text-align:center;">${formatNumber(pajak)}</td>
            <td style="text-align:center;">${formatNumber(bersih)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:22px; display:grid; grid-template-columns: 1fr 1.15fr 1fr; gap:12px; font-size:9.5pt; line-height:1.4;">
        <div style="padding-left:14px;">
          <div>Setuju Dibayar</div>
          <div>an. Kuasa Pengguna Anggaran</div>
          <div>Pejabat Pembuat Komitmen</div>
          <div>Wilayah 10</div>
          <div style="height:52px;"></div>
          <div style="text-decoration:underline;">${escapeHtml(ctx.officials.ppkName)}</div>
          <div>${escapeHtml(ctx.officials.ppkNip)}</div>
        </div>
        <div>
          <div>&nbsp;</div>
          <div>Lunas Dibayar</div>
          <div>Tanggal &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${escapeHtml(tx.tanggal)}</div>
          <div>Bendahara Pengeluaran Pembantu</div>
          <div>Wilayah 10</div>
          <div style="height:36px;"></div>
          <div style="text-align:center;">
            <div style="text-decoration:underline;">${escapeHtml(ctx.officials.bendName)}</div>
            <div>${escapeHtml(ctx.officials.bendNip)}</div>
          </div>
        </div>
        <div style="text-align:center;">
          <div>&nbsp;</div>
          <div>&nbsp;</div>
          <div>&nbsp;</div>
          <div>Yang Membayarkan</div>
          <div>Kepala Sekolah SRT 39 Garut</div>
          <div style="height:36px;"></div>
          <div style="text-decoration:underline;">${escapeHtml(ctx.officials.kepsekName)}</div>
          <div>${escapeHtml(ctx.officials.kepsekNip)}</div>
        </div>
      </div>
    </div>
  `;
}

export function buildStandaloneHTML(job: PrintJobMeta, ctx: DocContext): string {
  let bodyContent = '';
  if (job.type === 'rekap') {
    bodyContent = renderRekapHTMLString(job.items, ctx);
  } else if (job.type === 'dh') {
    bodyContent = job.items
      .map(
        (tx, i) =>
          `<div class="${i < job.items.length - 1 ? 'page-break' : ''}">${renderDaftarHadirHTMLString(tx, ctx)}</div>`
      )
      .join('');
  } else {
    bodyContent = job.items
      .map(
        (tx, i) =>
          `<div class="${i < job.items.length - 1 ? 'page-break' : ''}">${renderTandaTerimaHTMLString(tx, ctx)}</div>`
      )
      .join('');
  }

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(job.docName)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    body { margin: 0; padding: 12px; font-family: 'Times New Roman', Times, serif; color: #000; background: #fff; }
    .excel-sheet-wrapper { width: 100%; max-width: 280mm; margin: 0 auto 20px auto; box-sizing: border-box; }
    .excel-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .excel-table th, .excel-table td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; word-wrap: break-word; }
    .excel-table th { font-weight: bold; text-align: center; }
    .page-break { page-break-after: always; break-after: page; }
    @media print {
      body { padding: 0; }
      .excel-sheet-wrapper { margin: 0; max-width: none; }
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

export function downloadBlob(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
