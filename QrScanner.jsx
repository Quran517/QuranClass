import { useEffect, useRef, useState } from 'react';

// Camera QR scanner. Calls onScan(text) for each new code read.
export default function QrScanner({ onScan }) {
  const boxId = useRef('qr-reader-' + Math.random().toString(36).slice(2)).current;
  const scanner = useRef(null);
  const last = useRef({ text: '', at: 0 });
  const cb = useRef(onScan);
  const [err, setErr] = useState('');
  cb.current = onScan;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const s = new Html5Qrcode(boxId);
        scanner.current = s;
        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (text) => {
            const now = Date.now();
            if (text === last.current.text && now - last.current.at < 4000) return;
            last.current = { text, at: now };
            if (navigator.vibrate) navigator.vibrate(80);
            cb.current(text);
          },
          () => {}
        );
        if (cancelled) s.stop().catch(() => {});
      } catch (e) {
        setErr(
          String(e).includes('Permission') || String(e).includes('NotAllowed')
            ? 'Camera permission was denied. Allow camera access for this site in your browser settings and try again.'
            : 'Could not start the camera: ' + (e?.message || e)
        );
      }
    })();
    return () => {
      cancelled = true;
      const s = scanner.current;
      if (s) s.stop().then(() => s.clear()).catch(() => {});
    };
  }, [boxId]);

  return (
    <div className="scanner">
      <div id={boxId} className="scanner-view" />
      {err && <p className="error">{err}</p>}
    </div>
  );
}
