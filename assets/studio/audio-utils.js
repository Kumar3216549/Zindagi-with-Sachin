// Zindagi Writer Desk — Audiobook Studio
// Pure audio helpers: decoding, WAV encoding, peaks, loudness (ITU-R BS.1770-4),
// limiter, noise cleanup, silence detection and the ACX check.
// Everything runs in the browser; no server is involved.

export const SR = 44100; // studio working sample rate (mono)

// ---------- decoding ----------

let sharedCtx = null;
function ctx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}
export function audioContext() { return ctx(); }

// Decode any audio Blob/ArrayBuffer into mono Float32 samples at 44.1 kHz.
export async function decodeToMono(input) {
  const ab = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const decoded = await ctx().decodeAudioData(ab.slice(0));
  return toMono44k(decoded);
}

export async function toMono44k(buffer) {
  const length = Math.max(1, Math.ceil(buffer.duration * SR));
  const off = new OfflineAudioContext(1, length, SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination); // the destination down-mixes to mono for us
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}

export function samplesToAudioBuffer(samples, sampleRate = SR) {
  const buf = ctx().createBuffer(1, Math.max(1, samples.length), sampleRate);
  buf.copyToChannel(samples, 0);
  return buf;
}

// ---------- WAV ----------

export function encodeWav(samples, sampleRate = SR) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ---------- peaks for the waveform ----------

export function computePeaks(samples, buckets = 6000) {
  const n = samples.length;
  buckets = Math.max(1, Math.min(buckets, n));
  const out = new Float32Array(buckets * 2);
  const step = n / buckets;
  for (let b = 0; b < buckets; b++) {
    let mn = 0, mx = 0;
    const s = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step));
    for (let i = s; i < e; i++) { const x = samples[i]; if (x > mx) mx = x; else if (x < mn) mn = x; }
    out[b * 2] = mn; out[b * 2 + 1] = mx;
  }
  return out;
}

// ---------- levels ----------

export const toDb = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
export const fromDb = (db) => Math.pow(10, db / 20);

export function peakDb(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
  return toDb(p);
}

export function rmsDb(samples, start = 0, end = samples.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += samples[i] * samples[i];
  return toDb(Math.sqrt(s / Math.max(1, end - start)));
}

// ---------- biquad ----------

function biquad(samples, c) {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

function norm(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function highShelf(fc, gainDb, Q, rate) {
  const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * fc / rate;
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q), sA = Math.sqrt(A);
  return norm(
    A * ((A + 1) + (A - 1) * cw + 2 * sA * alpha),
    -2 * A * ((A - 1) + (A + 1) * cw),
    A * ((A + 1) + (A - 1) * cw - 2 * sA * alpha),
    (A + 1) - (A - 1) * cw + 2 * sA * alpha,
    2 * ((A - 1) - (A + 1) * cw),
    (A + 1) - (A - 1) * cw - 2 * sA * alpha);
}

function highPass(fc, Q, rate) {
  const w0 = 2 * Math.PI * fc / rate, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
  return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}

// ---------- integrated loudness, ITU-R BS.1770-4 (mono) ----------

export function integratedLoudness(samples, rate = SR) {
  if (samples.length < rate * 0.4) return -Infinity;
  let k = biquad(samples, highShelf(1681.974450955533, 3.999843853973347, 0.7071752369554196, rate));
  k = biquad(k, highPass(38.13547087602444, 0.5003270373238773, rate));
  const block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate);
  const z = [];
  // running sum of squares for speed
  const sq = new Float64Array(k.length + 1);
  for (let i = 0; i < k.length; i++) sq[i + 1] = sq[i] + k[i] * k[i];
  for (let s = 0; s + block <= k.length; s += hop) z.push((sq[s + block] - sq[s]) / block);
  const lk = (m) => -0.691 + 10 * Math.log10(m);
  const abs = z.filter((m) => lk(m) > -70);
  if (!abs.length) return -Infinity;
  const relGate = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((m) => lk(m) > relGate);
  if (!rel.length) return -Infinity;
  return lk(rel.reduce((a, b) => a + b, 0) / rel.length);
}

// ---------- gain, limiter, normalisation ----------

export function applyGain(samples, db) {
  const g = fromDb(db), out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

// Look-ahead style peak limiter: backward pass shapes the attack before each
// peak, forward pass applies a smooth release. Never exceeds the ceiling.
export function limit(samples, ceilingDb = -3, rate = SR, attackMs = 5, releaseMs = 120) {
  const ceil = fromDb(ceilingDb), n = samples.length;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.abs(samples[i]); env[i] = a > ceil ? ceil / a : 1; }
  const att = 1 - Math.exp(-1 / (attackMs * 0.001 * rate));
  for (let i = n - 2; i >= 0; i--) { const t = env[i + 1] + (1 - env[i + 1]) * att; if (t < env[i]) env[i] = t; }
  const rel = 1 - Math.exp(-1 / (releaseMs * 0.001 * rate));
  for (let i = 1; i < n; i++) { const t = env[i - 1] + (1 - env[i - 1]) * rel; if (t < env[i]) env[i] = t; }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = samples[i] * env[i];
  return out;
}

export function normalizeLoudness(samples, targetLufs = -16, ceilingDb = -3, rate = SR) {
  const before = integratedLoudness(samples, rate);
  if (!isFinite(before)) return { samples, before, after: before, gainDb: 0 };
  const gainDb = Math.max(-30, Math.min(30, targetLufs - before));
  const out = limit(applyGain(samples, gainDb), ceilingDb, rate);
  return { samples: out, before, after: integratedLoudness(out, rate), gainDb };
}

// ---------- noise cleanup ----------
// High-pass at 80 Hz (rumble, mic handling) + a smooth downward expander that
// pulls the room noise down between words. Threshold follows the measured floor.

export function noiseFloorDb(samples, rate = SR) {
  const win = Math.round(0.05 * rate);
  const vals = [];
  for (let s = 0; s + win <= samples.length; s += win) {
    const d = rmsDb(samples, s, s + win);
    if (d > -100) vals.push(d);
  }
  if (!vals.length) return -100;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.1)];
}

export function denoise(samples, rate = SR) {
  const hp = biquad(samples, highPass(80, 0.707, rate));
  const floor = noiseFloorDb(hp, rate);
  const thr = fromDb(Math.min(floor + 9, -35));
  const att = 1 - Math.exp(-1 / (0.005 * rate)), rel = 1 - Math.exp(-1 / (0.06 * rate));
  const gAtt = 1 - Math.exp(-1 / (0.008 * rate)), gRel = 1 - Math.exp(-1 / (0.15 * rate));
  const maxCut = fromDb(-18);
  const out = new Float32Array(hp.length);
  let env = 0, g = 1;
  for (let i = 0; i < hp.length; i++) {
    const a = Math.abs(hp[i]);
    env += (a > env ? att : rel) * (a - env);
    // 1:3 expansion below threshold, limited to -18 dB of reduction
    let target = env >= thr ? 1 : Math.max(maxCut, Math.pow(env / thr, 2));
    g += (target > g ? gAtt : gRel) * (target - g);
    out[i] = hp[i] * g;
  }
  return out;
}

// ---------- silence detection ----------

export function detectSilences(samples, rate = SR, thresholdDb = -45, minDur = 0.7) {
  const win = Math.round(0.02 * rate), thr = fromDb(thresholdDb);
  const res = [];
  let start = -1;
  for (let s = 0; s < samples.length; s += win) {
    const e = Math.min(samples.length, s + win);
    let sum = 0;
    for (let i = s; i < e; i++) sum += samples[i] * samples[i];
    const quiet = Math.sqrt(sum / (e - s)) < thr;
    if (quiet && start < 0) start = s;
    if ((!quiet || e === samples.length) && start >= 0) {
      const end = quiet ? e : s;
      if ((end - start) / rate >= minDur) res.push({ start: start / rate, end: end / rate });
      start = -1;
    }
  }
  return res;
}

// ---------- ACX check ----------
// ACX: RMS between -23 and -18 dBFS, peaks at or below -3 dBFS,
// noise floor at or below -60 dBFS.

export function acxCheck(samples, rate = SR) {
  const peak = peakDb(samples);
  const rms = rmsDb(samples);
  const win = Math.round(0.5 * rate), hop = Math.round(0.1 * rate);
  let floor = 0;
  const sq = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) sq[i + 1] = sq[i] + samples[i] * samples[i];
  let minRms = Infinity;
  for (let s = 0; s + win <= samples.length; s += hop) {
    const r = Math.sqrt((sq[s + win] - sq[s]) / win);
    if (r > 1e-6 && r < minRms) minRms = r; // ignore pure digital silence
  }
  floor = isFinite(minRms) ? toDb(minRms) : -100;
  const lufs = integratedLoudness(samples, rate);
  return {
    peak, rms, floor, lufs,
    peakOk: peak <= -3,
    rmsOk: rms >= -23 && rms <= -18,
    floorOk: floor <= -60,
    get pass() { return this.peakOk && this.rmsOk && this.floorOk; },
  };
}

// ---------- misc ----------

export function formatTime(sec, withMs = false) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const pad = (x) => String(x).padStart(2, '0');
  let t = (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  if (withMs) t += '.' + String(Math.floor((sec % 1) * 10));
  return t;
}

export function parseTime(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some((p) => isNaN(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
