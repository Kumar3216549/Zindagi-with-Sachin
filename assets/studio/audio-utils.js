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

// =====================================================================
// Pro voice chain: EQ presets, de-esser, compressor, breath softener,
// stereo helpers. All offline, sample-accurate, no dependencies.
// =====================================================================

function peaking(fc, gainDb, Q, rate) {
  const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * fc / rate;
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
  return norm(1 + alpha * A, -2 * cw, 1 - alpha * A, 1 + alpha / A, -2 * cw, 1 - alpha / A);
}
function lowShelf(fc, gainDb, Q, rate) {
  const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * fc / rate;
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q), sA = Math.sqrt(A);
  return norm(
    A * ((A + 1) - (A - 1) * cw + 2 * sA * alpha),
    2 * A * ((A - 1) - (A + 1) * cw),
    A * ((A + 1) - (A - 1) * cw - 2 * sA * alpha),
    (A + 1) + (A - 1) * cw + 2 * sA * alpha,
    -2 * ((A - 1) + (A + 1) * cw),
    (A + 1) + (A - 1) * cw - 2 * sA * alpha);
}

export const VOICE_PRESETS = {
  none:  { name: 'Natural (no change)' },
  warm:  { name: 'Warm narrator', hp: 75, eq: [['ls', 150, 2], ['pk', 300, -2.5, 1], ['pk', 3500, 2, 0.9], ['hs', 10000, 1.5]], comp: { ratio: 3, below: 18 } },
  clear: { name: 'Clear & bright', hp: 90, eq: [['pk', 250, -3, 1], ['pk', 4000, 3, 0.9], ['hs', 9000, 2]], comp: { ratio: 2.5, below: 16 } },
  deep:  { name: 'Deep radio voice', hp: 60, eq: [['ls', 120, 3.5], ['pk', 400, -2, 1], ['pk', 2800, 1.5, 1]], comp: { ratio: 4, below: 20 } },
};

// De-esser: watches the 5.5 kHz+ band and turns only that band down when
// "s / sh" sounds jump out above the rest of the voice (up to −12 dB on that band).
export function deEss(samples, rate = SR, maxCutDb = 12) {
  const hf = biquad(biquad(samples, highPass(5500, 0.707, rate)), highPass(5500, 0.707, rate));
  const att = 1 - Math.exp(-1 / (0.002 * rate)), rel = 1 - Math.exp(-1 / (0.06 * rate));
  const out = new Float32Array(samples.length);
  let eH = 0, eF = 0, g = 1;
  const floor = fromDb(-50), minG = fromDb(-maxCutDb);
  for (let i = 0; i < samples.length; i++) {
    const h = Math.abs(hf[i]), f = Math.abs(samples[i]);
    eH += (h > eH ? att : rel) * (h - eH);
    eF += (f > eF ? att : rel) * (f - eF);
    // sibilant when the high band carries more than ~45 % of the energy
    let target = 1;
    if (eH > floor && eF > 0) { const r = eH / eF; if (r > 0.3) target = Math.max(minG, Math.pow(0.3 / r, 1.6)); }
    g += (target < g ? 0.2 : 0.002) * (target - g);
    out[i] = samples[i] - hf[i] * (1 - g);
  }
  return out;
}

// Smooth RMS compressor; threshold sits `below` dB under the voice loudness.
export function compress(samples, rate = SR, { ratio = 3, below = 18, attackMs = 6, releaseMs = 160, kneeDb = 6 } = {}) {
  const L = integratedLoudness(samples, rate);
  if (!isFinite(L)) return samples;
  const thr = L - below + 18; // L is LUFS; short-term RMS of speech peaks sits ~18 dB above the gate
  const att = 1 - Math.exp(-1 / (attackMs * 0.001 * rate)), rel = 1 - Math.exp(-1 / (releaseMs * 0.001 * rate));
  const out = new Float32Array(samples.length);
  let env = 0, grDb = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i] * samples[i];
    env += (p > env ? att : rel) * (p - env);
    const lvl = 10 * Math.log10(env + 1e-12);
    const over = lvl - thr;
    let gr = 0;
    if (over > kneeDb / 2) gr = over * (1 - 1 / ratio);
    else if (over > -kneeDb / 2) gr = ((over + kneeDb / 2) ** 2 / (2 * kneeDb)) * (1 - 1 / ratio);
    grDb = gr;
    out[i] = samples[i] * Math.pow(10, -grDb / 20);
  }
  return out;
}

// Breath softener: finds short, noisy, mid-level bursts between words
// (breaths, lip smacks) and turns them down by ~12 dB with soft edges.
export function softenBreaths(samples, rate = SR, cutDb = 12) {
  const win = Math.round(0.02 * rate), n = Math.floor(samples.length / win);
  if (n < 10) return samples;
  const L = integratedLoudness(samples, rate);
  if (!isFinite(L)) return samples;
  const rms = new Float32Array(n), zcr = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0, z = 0;
    for (let i = f * win; i < (f + 1) * win; i++) { s += samples[i] * samples[i]; if (i && (samples[i] >= 0) !== (samples[i - 1] >= 0)) z++; }
    rms[f] = toDb(Math.sqrt(s / win)); zcr[f] = z / win;
  }
  const sorted = Array.from(rms).filter((x) => x > -100).sort((a, b) => a - b);
  const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -80;
  const speechThr = L - 3, low = floor + 5;
  const mid = (f) => rms[f] > low && rms[f] < speechThr;
  const gain = new Float32Array(n).fill(1), cut = fromDb(-cutDb);
  let f = 0;
  while (f < n) {
    if (!mid(f)) { f++; continue; }
    let e = f; while (e < n && mid(e)) e++;
    const len = (e - f) * 0.02;
    let z = 0; for (let k = f; k < e; k++) z += zcr[k]; z /= (e - f);
    let pk = -100; for (let k = f; k < e; k++) pk = Math.max(pk, rms[k]);
    // breath: 0.12–0.9 s, noisy (high zero-crossing rate), clearly below speech peaks
    if (len >= 0.12 && len <= 0.9 && z > 0.1 && pk < L - 6) for (let k = f; k < e; k++) gain[k] = cut;
    f = e;
  }
  // smooth the per-frame gain into a per-sample curve (≈15 ms ramps)
  const out = new Float32Array(samples.length);
  let g = 1; const a = 1 - Math.exp(-1 / (0.015 * rate));
  for (let i = 0; i < samples.length; i++) {
    const t = gain[Math.min(n - 1, Math.floor(i / win))];
    g += a * (t - g);
    out[i] = samples[i] * g;
  }
  return out;
}

export function applyVoicePreset(samples, name, rate = SR) {
  const p = VOICE_PRESETS[name];
  if (!p || name === 'none') return samples;
  let x = biquad(samples, highPass(p.hp, 0.707, rate));
  for (const [t, fc, g, q] of p.eq) {
    x = biquad(x, t === 'ls' ? lowShelf(fc, g, 0.707, rate) : t === 'hs' ? highShelf(fc, g, 0.707, rate) : peaking(fc, g, q || 1, rate));
  }
  x = deEss(x, rate);
  x = compress(x, rate, p.comp);
  return x;
}

// ---------- stereo helpers ----------

// Decode keeping both channels (for music beds). Mono files are duplicated.
export async function decodeToStereo(input) {
  const ab = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const decoded = await ctx().decodeAudioData(ab.slice(0));
  const length = Math.max(1, Math.ceil(decoded.duration * SR));
  const off = new OfflineAudioContext(2, length, SR);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

// Linked stereo limiter (same gain on both channels keeps the image stable).
export function limitStereo(L, R, ceilingDb = -3, rate = SR, attackMs = 5, releaseMs = 120) {
  const ceil = fromDb(ceilingDb), n = L.length, env = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); env[i] = a > ceil ? ceil / a : 1; }
  const att = 1 - Math.exp(-1 / (attackMs * 0.001 * rate));
  for (let i = n - 2; i >= 0; i--) { const t = env[i + 1] + (1 - env[i + 1]) * att; if (t < env[i]) env[i] = t; }
  const rel = 1 - Math.exp(-1 / (releaseMs * 0.001 * rate));
  for (let i = 1; i < n; i++) { const t = env[i - 1] + (1 - env[i - 1]) * rel; if (t < env[i]) env[i] = t; }
  const oL = new Float32Array(n), oR = new Float32Array(n);
  for (let i = 0; i < n; i++) { oL[i] = L[i] * env[i]; oR[i] = R[i] * env[i]; }
  return [oL, oR];
}

export function encodeWavStereo(L, R, sampleRate = SR) {
  const n = L.length, buffer = new ArrayBuffer(44 + n * 4), v = new DataView(buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (const c of [L, R]) { const s = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([buffer], { type: 'audio/wav' });
}
