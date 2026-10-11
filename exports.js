import { getSettings } from './settings.js';

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

export async function downloadPdf(filename, { title, subtitle, tables }) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const navy = [9, 47, 107];
  const orange = [237, 91, 3];

  doc.setFillColor(...navy);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 64, 'F');
  doc.setFillColor(...orange);
  doc.rect(0, 64, doc.internal.pageSize.getWidth(), 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(`${getSettings().school_name}${getSettings().academic_year ? ' · ' + getSettings().academic_year : ''}`, 40, 30);
  doc.setFontSize(11);
  doc.text(title, 40, 50);

  doc.setTextColor(32, 43, 60);
  doc.setFontSize(10);
  let y = 90;
  if (subtitle) {
    doc.text(subtitle, 40, y);
    y += 14;
  }

  for (const t of tables) {
    if (t.heading) {
      doc.setFontSize(12);
      doc.text(t.heading, 40, y + 6);
      y += 14;
    }
    autoTable(doc, {
      startY: y,
      head: [t.columns],
      body: t.rows.length ? t.rows : [[{ content: 'No records', colSpan: t.columns.length }]],
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: navy },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      margin: { left: 40, right: 40 },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

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
  doc.save(filename);
}
