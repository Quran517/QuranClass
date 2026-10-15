import { useEffect, useRef, useState } from 'react';

// USB / Bluetooth barcode & QR scanners "type" the code very fast and press Enter.
// This reads them on the whole page, whichever box has the cursor, and also
// when the computer keyboard is set to Arabic (we use the physical key, not the letter).

const CODE_CHARS = (() => {
  const m = {};
  for (let c = 65; c <= 90; c++) { const L = String.fromCharCode(c); m['Key' + L] = [L.toLowerCase(), L]; }
  for (let d = 0; d <= 9; d++) { m['Digit' + d] = [String(d), ')!@#$%^&*('[d]]; m['Numpad' + d] = [String(d), String(d)]; }
  Object.assign(m, {
    Minus: ['-', '_'], NumpadSubtract: ['-', '-'], Equal: ['=', '+'], NumpadAdd: ['+', '+'], Period: ['.', '>'], NumpadDecimal: ['.', '.'],
    Comma: [',', '<'], Slash: ['/', '?'], NumpadDivide: ['/', '/'], Semicolon: [';', ':'], Quote: ["'", '"'], Space: [' ', ' '],
    BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'], Backquote: ['`', '~'],
  });
  return m;
})();

// Arabic (101) keyboard letters → the Latin key in the same place (for typed / pasted codes).
const AR = {
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l',
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm', 'ك': ';', 'ط': "'", 'و': ',', 'ز': '.', 'ظ': '/',
  // with Shift (capital letters on the Arabic layout)
  'َ': 'Q', 'ً': 'W', 'ُ': 'E', 'ٌ': 'R', 'إ': 'Y', '÷': 'I', '×': 'O', '؛': 'P',
  'ِ': 'A', 'ٍ': 'S', 'أ': 'H', 'ـ': 'J', '،': 'K', 'ْ': 'X', 'آ': 'N',
};

export function normalizeScan(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/لا/g, 'b').replace(/لإ/g, 'T').replace(/لأ/g, 'G').replace(/لآ/g, 'B');
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  s = [...s].map((ch) => AR[ch] ?? ch).join('');
  // QR text from the ID card: QCSLISJ:<token>
  if (/^qcslisj[:;]/i.test(s)) s = 'QCSLISJ:' + s.slice(8).toLowerCase();
  return s.replace(/\s+/g, '');
}

const FAST = 60;        // ms between keys: faster than any person types (scanners: 2–40 ms)
const MIN_LEN = 4;

export function useHardwareScanner(onScan, { enabled = true } = {}) {
  const cb = useRef(onScan);
  cb.current = onScan;
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let buf = '', times = [], timer = null, startEl = null;
    const reset = () => { buf = ''; times = []; startEl = null; clearTimeout(timer); };
    const fire = (e) => {
      const fast = times.length >= MIN_LEN && (times[times.length - 1] - times[0]) / (times.length - 1) < FAST;
      if (!fast || buf.length < MIN_LEN) return false;
      const value = normalizeScan(buf);
      const el = startEl;
      reset();
      if (e) { e.preventDefault(); e.stopPropagation(); }
      // the code may also have been typed into the box that had the cursor: clear it
      if (el && el.dataset && el.dataset.scan !== undefined) el.dispatchEvent(new CustomEvent('scan-clear', { bubbles: true }));
      setLast({ value, at: Date.now() });
      cb.current(value);
      return true;
    };
    const down = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      if (t && t.tagName === 'TEXTAREA') return;
      const now = performance.now();
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Tab') {
        if (fire(e)) return;
        if (e.key !== 'Tab') reset();
        return;
      }
      const ch = CODE_CHARS[e.code];
      if (!ch) return;
      if (times.length && now - times[times.length - 1] > 250) reset();
      if (!buf) startEl = t;
      buf += e.shiftKey ? ch[1] : ch[0];
      times.push(now);
      clearTimeout(timer);
      // scanners set up without an Enter key: finish after a short pause
      timer = setTimeout(() => { if (buf.length >= 5) fire(null); else reset(); }, 260);
    };
    window.addEventListener('keydown', down, true);
    return () => { window.removeEventListener('keydown', down, true); clearTimeout(timer); };
  }, [enabled]);
  return last;
}

// For the "Scanner test" panel: shows every key the computer receives, and how fast.
export function useKeyLog(enabled) {
  const [log, setLog] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let prev = 0;
    const down = (e) => {
      const now = performance.now();
      const gap = prev ? Math.round(now - prev) : 0;
      prev = now;
      setLog((l) => [...l.slice(-59), { key: e.key, code: e.code, gap, shift: e.shiftKey }]);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [enabled]);
  return [log, () => setLog([])];
}
