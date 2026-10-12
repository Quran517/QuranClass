// Short beeps for the QR scanner. Uses the phone's speaker — no files or apps needed.
let ctx = null;

// Must be called from a tap (browsers only allow sound after the user touches the page).
export function unlockSound() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq, start, length, type = 'sine', volume = 0.35) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + length + 0.02);
}

// ok: present marked · repeat: already marked today · error: not recognised / wrong class
export function scanSound(kind) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (kind === 'ok') {
    tone(880, 0, 0.12);
    tone(1320, 0.12, 0.16);
  } else if (kind === 'repeat') {
    tone(990, 0, 0.1);
  } else {
    tone(220, 0, 0.18, 'square', 0.25);
    tone(180, 0.22, 0.3, 'square', 0.25);
  }
}

export function scanVibrate(kind) {
  if (!navigator.vibrate) return;
  navigator.vibrate(kind === 'ok' ? 80 : kind === 'repeat' ? 40 : [120, 80, 120]);
}
