import { getSettings, getLogo } from './settings.js';

// Load the logo as a PNG data URL for the PDF (works for the built-in or an uploaded logo).
async function logoData() {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = getLogo();
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const ctx = c.getContext('2d');
    const r = Math.min(160 / img.width, 160 / img.height);
    ctx.drawImage(img, (160 - img.width * r) / 2, (160 - img.height * r) / 2, img.width * r, img.height * r);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

// Excel and PDF downloads. Libraries are loaded only when needed,
// so the app stays fast on phones.

export async function downloadExcel(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records' }]);
    const keys = Object.keys(rows[0] || { Note: '' });
    ws['!cols'] = keys.map((k) => ({
      wch: Math.min(40, Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)) + 2),
    }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export async function downloadPdf(filename, { title, subtitle, tables, orientation = 'landscape', print = false, signatures = [] }) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const navy = [9, 47, 107];
  const orange = [237, 91, 3];

  doc.setFillColor(...navy);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 64, 'F');
  doc.setFillColor(...orange);
  doc.rect(0, 64, doc.internal.pageSize.getWidth(), 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  const logo = await logoData();
  const tx = logo ? 92 : 40;
  if (logo) doc.addImage(logo, 'PNG', 36, 8, 48, 48);
  doc.text(`${getSettings().school_name}${getSettings().academic_year ? ' · ' + getSettings().academic_year : ''}`, tx, 30);
  doc.setFontSize(11);
  doc.text(title, tx, 50);

  doc.setTextColor(32, 43, 60);
  doc.setFontSize(10);
  let y = 90;
  if (subtitle) {
    doc.text(subtitle, 40, y);
    y += 14;
  }

  const W0 = doc.internal.pageSize.getWidth(), H0 = doc.internal.pageSize.getHeight();
  const drawSignatures = (list) => {
    if (y > H0 - 80) { doc.addPage(); y = 70; }
    const w = (W0 - 80) / list.length;
    list.forEach((s, i) => {
      const x = 40 + i * w;
      doc.setDrawColor(150); doc.setLineWidth(0.6); doc.line(x + 10, y + 34, x + w - 20, y + 34);
      doc.setFontSize(9); doc.setTextColor(60, 70, 90);
      doc.text(s, x + 10, y + 46);
    });
    y += 64;
    doc.setTextColor(32, 43, 60);
  };

  for (const [ti, t] of tables.entries()) {
    // a section that starts on its own page (e.g. one class per page)
    if (t.newPage && ti > 0) { doc.addPage(); y = 50; }
    if (t.section) {
      doc.setFillColor(...navy); doc.rect(40, y - 8, W0 - 80, 26, 'F');
      doc.setFillColor(...orange); doc.rect(40, y + 18, W0 - 80, 2, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(12);
      doc.text(t.section, 50, y + 9);
      doc.setTextColor(32, 43, 60);
      y += 32;
      if (t.sectionNote) { doc.setFontSize(9.5); doc.text(t.sectionNote, 40, y + 4); y += 14; }
    }
    if (t.signatures) { drawSignatures(t.signatures); continue; }
    if (t.heading) {
      doc.setFontSize(12);
      doc.text(t.heading, 40, y + 6);
      y += 14;
    }
    autoTable(doc, {
      startY: y,
      head: [t.columns],
      body: t.rows.length ? t.rows : [[{ content: 'No records', colSpan: t.columns.length }]],
      styles: t.compact ? { fontSize: 8, cellPadding: 2.6 } : { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: navy },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      margin: { left: 40, right: 40 },
    });
    y = doc.lastAutoTable.finalY + (t.compact ? 16 : 24);
  }

  if (signatures.length) drawSignatures(signatures);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Generated ${new Date().toLocaleString('en-GB')} · Page ${i} of ${pages}`,
      40,
      doc.internal.pageSize.getHeight() - 20
    );
  }
  finishPdf(doc, filename, print);
}

// Save the PDF, or open it with the print dialog.
export function finishPdf(doc, filename, print) {
  if (print) {
    doc.autoPrint();
    const w = window.open(doc.output('bloburl'), '_blank');
    if (w) return;
  }
  doc.save(filename);
}

export { logoData };
