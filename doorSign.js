import { getSettings, getLogo } from './settings.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A4 sign for the classroom door: group, class (very big), ages / boys or girls, teacher.
export function printDoorSign(klass, teacherName, orientation = 'portrait') {
  const land = orientation === 'landscape';
  const s = getSettings();
  // "Group 1 – Class A" → "GROUP 1" + "Class A"
  const m = String(klass.name || '').split(/\s+[–-]\s+/);
  const top = m.length > 1 ? m[0] : '';
  const big = m.length > 1 ? m.slice(1).join(' – ') : klass.name || '';
  const parts = String(klass.group_name || '').split(' · ').filter(Boolean);
  const labels = (parts.length > 1 ? parts.slice(1) : parts).filter((p) => !top || p.toLowerCase() !== top.toLowerCase());
  const girls = labels.some((l) => /girl/i.test(l)) && !labels.some((l) => /boy/i.test(l));
  const days = (s.class_days || []).map((d) => DAYS[d]).filter(Boolean);
  const when = [days.length ? `Every ${days.join(' & ')}` : '', klass.schedule || '', s.academic_year].filter(Boolean).join(' · ');
  const bigSize = big.length <= 8 ? 34 : big.length <= 14 ? 24 : 17;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Door sign — ${esc(klass.name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&family=Amiri:wght@700&display=swap">
<style>
@page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; }
body { font-family: 'Plus Jakarta Sans', Arial, sans-serif; }
.page { width: 210mm; height: 296mm; display: flex; flex-direction: column; overflow: hidden; --c: #1c2f55; --c2: #2b4a7e; --a: #e07414; --t: #f4efe4; }
.page.girls { --c: #6b1d4a; --c2: #8e2a63; --a: #d4a537; --t: #fbf1f6; }
.top { background: linear-gradient(160deg, var(--c), var(--c2)); color: #fff; text-align: center; padding: 16mm 12mm 12mm; }
.top img { width: 46mm; height: 46mm; border-radius: 50%; object-fit: cover; background: #fff; box-shadow: 0 0 0 2mm #c9a86a; }
.school { font: 800 9.5mm/1.15 'Plus Jakarta Sans', Arial, sans-serif; margin-top: 6mm; }
.school-ar { font: 700 9mm 'Amiri', serif; margin-top: 2mm; direction: rtl; }
.tri { height: 3.5mm; background: linear-gradient(90deg, #e07414 0 33.3%, #23502f 33.3% 66.6%, #742224 66.6%); }
.mid { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 12mm; background: linear-gradient(180deg, #fff 55%, var(--t)); }
.group { font: 800 16mm/1 'Plus Jakarta Sans', Arial, sans-serif; color: var(--a); text-transform: uppercase; letter-spacing: .5mm; }
.cls { font: 800 ${bigSize}mm/1.05 'Plus Jakarta Sans', Arial, sans-serif; color: var(--c); margin: 4mm 0 6mm; }
.info { display: flex; flex-wrap: wrap; justify-content: center; gap: 4mm; font: 600 7mm 'Plus Jakarta Sans', Arial, sans-serif; color: #fff; }
.info span { background: var(--c); border-radius: 4mm; padding: 2.5mm 6mm; }
.teacher { margin-top: 14mm; border: 1mm solid var(--t); border-radius: 6mm; padding: 7mm 12mm; background: #fff; }
.teacher small { display: block; font: 600 6mm 'Plus Jakarta Sans', Arial, sans-serif; color: #777; text-transform: uppercase; letter-spacing: 1mm; }
.teacher b { display: block; font: 800 ${teacherName && teacherName.length > 22 ? 10 : 13}mm/1.1 'Plus Jakarta Sans', Arial, sans-serif; color: var(--c); margin-top: 2mm; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 6mm; padding: 7mm 14mm; background: var(--c); color: #fff; font: 600 5.5mm 'Plus Jakarta Sans', Arial, sans-serif; }
.foot .ar { font: 700 7mm 'Amiri', serif; direction: rtl; }
/* landscape: logo and school name on the left, class and teacher on the right */
.page.land { width: 297mm; height: 209mm; display: grid; grid-template-columns: 100mm 3.5mm 1fr; grid-template-rows: 1fr auto; }
.page.land .top { grid-row: 1; grid-column: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10mm 8mm; }
.page.land .top img { width: 52mm; height: 52mm; }
.page.land .school { font-size: 8.5mm; }
.page.land .tri { grid-row: 1; grid-column: 2; height: auto; background: linear-gradient(180deg, #e07414 0 33.3%, #23502f 33.3% 66.6%, #742224 66.6%); }
.page.land .mid { grid-row: 1; grid-column: 3; }
.page.land .cls { font-size: ${Math.round(bigSize * 1.15)}mm; }
.page.land .teacher { margin-top: 10mm; }
.page.land .foot { grid-row: 2; grid-column: 1 / 4; padding: 6mm 14mm; }
</style></head><body>
<div class="page ${girls ? 'girls' : ''} ${land ? 'land' : ''}">
  <div class="top"><img src="${esc(new URL(getLogo(), window.location.href).href)}" alt="">
    <div class="school">${esc(s.school_name)}</div>
    <div class="school-ar">${esc(s.school_name_ar || 'حلقة القرآن الكريم والتجويد')}</div></div>
  <div class="tri"></div>
  <div class="mid">
    ${top ? `<div class="group">${esc(top)}</div>` : ''}
    <div class="cls">${esc(big)}</div>
    ${labels.length ? `<div class="info">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
    <div class="teacher"><small>Teacher</small><b>${esc(teacherName || '—')}</b></div>
  </div>
  <div class="foot"><span>${esc(when)}</span><span class="ar">خيركم من تعلّم القرآن وعلّمه</span></div>
</div></body></html>`;

  // print from a hidden frame so only the sign prints
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open(); d.write(html); d.close();
  const go = async () => {
    try { await d.fonts?.ready; } catch { /* fonts are optional */ }
    const img = d.querySelector('img');
    if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 3000); });
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  };
  setTimeout(go, 400);
  return html;
}
