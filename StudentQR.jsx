import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export const QR_PREFIX = 'QCSLISJ:';

export default function StudentQR({ student, size = 240 }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    QRCode.toDataURL(QR_PREFIX + student.qr_token, { width: size * 2, margin: 1, color: { dark: '#1c2f55' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [student.qr_token, size]);

  if (!src) return null;
  return (
    <div className="qr-box">
      <img src={src} width={size} height={size} alt={`Attendance QR code for ${student.full_name}`} />
      <div className="qr-name">{student.full_name}</div>
      <div className="qr-code-text">{student.student_code}</div>
      <a className="btn small ghost" href={src} download={`${student.student_code}-qr.png`}>Download QR</a>
    </div>
  );
}
