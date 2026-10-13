import { useEffect, useRef, useState } from 'react';

// Camera scanner for the student QR code and the barcode on ID cards.
// Calls onScan(text) for each new code read.
export default function QrScanner({ onScan }) {
  const boxId = useRef('qr-reader-' + Math.random().toString(36).slice(2)).current;
  const scanner = useRef(null);
  const last = useRef({ text: '', at: 0 });
  const cb = useRef(onScan);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  cb.current = onScan;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
        if (cancelled) return;
        const s = new Html5Qrcode(boxId, {
          formatsToSupport: [F.QR_CODE, F.CODE_128],
          // Uses the phone's built-in fast scanner when available (Android Chrome).
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        });
        scanner.current = s;
        const onRead = (text) => {
          const now = Date.now();
          if (text === last.current.text && now - last.current.at < 4000) return;
          last.current = { text, at: now };
          cb.current(text);
        };
        const config = {
          fps: 15,
          // Large scan area: 80% of the camera view, so small codes on cards are found.
          qrbox: (w, h) => {
            const side = Math.floor(Math.min(w, h) * 0.8);
            return { width: Math.max(side, 150), height: Math.max(Math.floor(side * 0.75), 120) };
          },
          videoConstraints: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: [{ focusMode: 'continuous' }],
          },
        };
        try {
          await s.start({ facingMode: 'environment' }, config, onRead, () => {});
        } catch (first) {
          // Some phones reject the HD settings; fall back to the basic camera.
          delete config.videoConstraints;
          await s.start({ facingMode: 'environment' }, config, onRead, () => {});
        }
        if (cancelled) s.stop().catch(() => {});
        else setReady(true);
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
      {ready && <p className="small muted scan-tip">Hold the card 15–25 cm away, in good light. The QR code or the barcode both work.</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
