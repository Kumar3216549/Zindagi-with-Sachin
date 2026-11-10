// Track 2: background music + sound effects, mixed under the voice.
// The music is loudness-matched to the voice, looped seamlessly, gets a short
// intro/outro, and dips automatically (with look-ahead) while the voice speaks.

import { SR, samplesToAudioBuffer, denoise, normalizeLoudness, limit, integratedLoudness } from './audio-utils.js';

// Voice activity in 50 ms frames (true = speaking). The threshold follows the
// voice's own loudness, so ducking works even on quiet, un-normalised takes.
function voiceActivity(voice) {
  const win = Math.round(0.05 * SR);
  const L = integratedLoudness(voice);
  const thr = Math.pow(10, (isFinite(L) ? Math.max(-55, L - 24) : -40) / 20);
  const frames = [];
  for (let s = 0; s < voice.length; s += win) {
    const e = Math.min(voice.length, s + win);
    let sum = 0;
    for (let i = s; i < e; i++) sum += voice[i] * voice[i];
    frames.push(Math.sqrt(sum / (e - s)) > thr);
  }
  // hold speech for 450 ms so the music does not pump between words,
  // and start ducking 150 ms early (look-ahead) so the first syllable is clean
  const hold = 9, ahead = 3;
  const out = frames.slice();
  for (let i = 0; i < frames.length; i++) if (frames[i]) {
    for (let k = 1; k <= hold && i + k < out.length; k++) out[i + k] = true;
    for (let k = 1; k <= ahead && i - k >= 0; k++) out[i - k] = true;
  }
  return { frames: out, win };
}

// Processing chain for the voice before mixing.
export function processVoice(voice, settings) {
  let v = voice;
  if (settings.denoise) v = denoise(v);
  let loud = null;
  if (settings.normalize) {
    loud = normalizeLoudness(v, settings.target ?? -16, -3.2);
    v = loud.samples;
  }
  return { samples: v, loudness: loud };
}

// Music bed timing (seconds): music plays alone before the narration starts
// and rings out after it ends, like a professionally produced audiobook.
export const BGM_INTRO = 3, BGM_OUTRO = 4;
const DUCK_DB = -10;      // how far the music dips while the narrator speaks
const LOOP_XFADE = 1.5;   // seconds of cross-fade where a track loops

// Volume slider 0–20 → music level relative to the voice when NOT ducked.
// 1 → −24 dB, 8 (default) → −17 dB, 20 → −6 dB. Under speech it sits a further 10 dB lower.
export function bgmRelDb(vol) { return -24 + ((Math.min(20, Math.max(1, vol)) - 1) / 19) * 18; }

// Build a seamless bed of `length` samples: loudness-matched to the voice,
// looped with equal-power cross-fades instead of hard jumps.
function buildBed(src, length, loop, refLufs, relDb) {
  const srcL = integratedLoudness(src);
  const gain = isFinite(srcL) ? Math.pow(10, (refLufs + relDb - srcL) / 20) : 0;
  const bed = new Float32Array(length);
  const xf = Math.min(Math.round(LOOP_XFADE * SR), Math.floor(src.length / 3));
  if (!loop || src.length >= length || xf < 64) {
    const n = Math.min(length, src.length);
    for (let i = 0; i < n; i++) bed[i] = src[i] * gain;
    return bed;
  }
  const step = src.length - xf; // each repeat starts xf samples before the previous one ends
  for (let start = 0; start < length; start += step) {
    for (let j = 0; j < src.length && start + j < length; j++) {
      let w = 1;
      if (start > 0 && j < xf) w = Math.sin((j / xf) * Math.PI / 2);                // fade in over the tail of the last pass
      if (j >= step && start + step < length) w *= Math.cos(((j - step) / xf) * Math.PI / 2); // fade out under the next pass
      bed[start + j] += src[j] * gain * w;
    }
  }
  return bed;
}

// Render voice + BGM + SFX into one mono 44.1 kHz track.
// bgm: { samples, volume (0..20 slider value or legacy 0..0.2), duck (bool), loop (bool) } | null
// sfx: [{ samples, time (s, on the narration timeline), volume (0..1) }]
// The returned array carries .voiceOffset = seconds of music intro before the narration.
export async function renderMix(voice, bgm, sfx = []) {
  const useBgm = !!(bgm && bgm.samples && bgm.samples.length && bgm.volume > 0);
  const pre = useBgm ? Math.round(BGM_INTRO * SR) : 0;
  const post = useBgm ? Math.round(BGM_OUTRO * SR) : 0;
  const sfxEnd = sfx.reduce((m, s) => Math.max(m, pre + s.time * SR + s.samples.length), 0);
  const length = Math.max(pre + voice.length + post, Math.ceil(sfxEnd), 1);
  const off = new OfflineAudioContext(1, length, SR);

  const v = off.createBufferSource();
  v.buffer = samplesToAudioBuffer(voice);
  v.connect(off.destination);
  v.start(pre / SR);

  if (useBgm) {
    const vol = bgm.volume <= 0.2 ? bgm.volume * 100 : bgm.volume; // accept both 0.08 and 8
    const vL = integratedLoudness(voice);
    const ref = isFinite(vL) ? vL : -16;
    const b = off.createBufferSource();
    b.buffer = samplesToAudioBuffer(buildBed(bgm.samples, length, bgm.loop !== false, ref, bgmRelDb(vol)));
    const g = off.createGain();
    const ducked = Math.pow(10, DUCK_DB / 20);
    g.gain.setValueAtTime(1, 0);
    if (bgm.duck !== false) {
      const { frames, win } = voiceActivity(voice);
      let cur = 1;
      for (let i = 0; i < frames.length; i++) {
        const want = frames[i] ? ducked : 1;
        if (want !== cur) {
          const t = (pre + i * win) / SR;
          // smooth dip (≈200 ms) and a slow, natural swell back (≈700 ms)
          g.gain.setTargetAtTime(want, t, want < cur ? 0.07 : 0.25);
          cur = want;
        }
      }
    }
    // fade the bed in at the start and out over the outro
    const total = length / SR, fin = Math.min(1.5, total / 4), fout = Math.min(BGM_OUTRO, total / 4);
    const fg = off.createGain();
    fg.gain.setValueAtTime(0, 0);
    fg.gain.linearRampToValueAtTime(1, fin);
    fg.gain.setValueAtTime(1, Math.max(fin, total - fout));
    fg.gain.linearRampToValueAtTime(0, total);
    b.connect(g).connect(fg).connect(off.destination);
    b.start(0);
  }

  for (const s of sfx) {
    if (!s.samples || !s.samples.length) continue;
    const n = off.createBufferSource();
    n.buffer = samplesToAudioBuffer(s.samples);
    const g = off.createGain();
    g.gain.value = s.volume ?? 0.5;
    n.connect(g).connect(off.destination);
    n.start(Math.max(0, pre / SR + s.time));
  }

  const out = await off.startRendering();
  const res = limit(out.getChannelData(0).slice(), -3.2);
  res.voiceOffset = pre / SR;
  return res;
}

// ---------- free built-in library (generated, so no licence issues) ----------

function noise(n) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; return a; }

async function renderGraph(seconds, build) {
  const off = new OfflineAudioContext(1, Math.round(seconds * SR), SR);
  build(off);
  const b = await off.startRendering();
  return b.getChannelData(0).slice();
}

function noiseSource(off, seconds) {
  const src = off.createBufferSource();
  src.buffer = samplesToAudioBuffer(noise(Math.round(seconds * SR)));
  return src;
}

export const LIBRARY = [
  {
    id: 'rain', name: 'Rain (loop)', kind: 'both', seconds: 20,
    make: () => renderGraph(20, (off) => {
      const n = noiseSource(off, 20);
      const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
      const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const g = off.createGain(); g.gain.value = 0.35;
      n.connect(hp).connect(lp).connect(g).connect(off.destination); n.start();
      for (let i = 0; i < 260; i++) { // drops
        const t = Math.random() * 19.8, d = off.createBufferSource();
        d.buffer = samplesToAudioBuffer(noise(300));
        const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2000 + Math.random() * 4000;
        const dg = off.createGain(); dg.gain.value = 0.15 + Math.random() * 0.25;
        d.connect(bp).connect(dg).connect(off.destination); d.start(t);
      }
    }),
  },
  {
    id: 'wind', name: 'Soft wind (loop)', kind: 'both', seconds: 20,
    make: () => renderGraph(20, (off) => {
      const n = noiseSource(off, 20);
      const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.value = 500;
      const lfo = off.createOscillator(); lfo.frequency.value = 0.12;
      const lg = off.createGain(); lg.gain.value = 300;
      lfo.connect(lg).connect(bp.frequency); lfo.start();
      const g = off.createGain(); g.gain.value = 0.6;
      n.connect(bp).connect(g).connect(off.destination); n.start();
    }),
  },
  {
    id: 'pad', name: 'Calm pad, A minor (loop)', kind: 'bgm', seconds: 20,
    make: () => renderGraph(20, (off) => {
      // overlapping chords (no gaps between them) through a soft low-pass
      const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 207.65, 246.94]];
      const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.3;
      lp.connect(off.destination);
      chords.forEach((ch, ci) => ch.forEach((f) => {
        for (const det of [-5, 5]) {
          const o = off.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
          const g = off.createGain(); const t0 = ci * 5;
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.055, t0 + 1.5);
          g.gain.setValueAtTime(0.055, t0 + 4.8); g.gain.linearRampToValueAtTime(0, t0 + 6.4);
          o.connect(g).connect(lp); o.start(t0); o.stop(Math.min(20, t0 + 6.5));
        }
      }));
    }),
  },
  {
    id: 'tanpura', name: 'Tanpura drone, Sa–Pa (loop)', kind: 'bgm', seconds: 16,
    make: () => renderGraph(16, (off) => {
      // four plucked strings (Pa, Sa', Sa', Sa) every 4 s, rich "jawari" overtones
      const sa = 130.81, strings = [sa * 0.75, sa * 2, sa * 2, sa];
      const bus = off.createGain(); bus.gain.value = 0.5;
      const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
      bus.connect(lp).connect(off.destination);
      for (let cyc = 0; cyc < 4; cyc++) strings.forEach((f, si) => {
        const t = cyc * 4 + si * 1.0;
        for (let h = 1; h <= 10; h++) {
          const o = off.createOscillator(); o.frequency.value = f * h; o.detune.value = (h % 2 ? 2 : -2);
          const g = off.createGain(); const a = 0.09 / Math.pow(h, 0.9) * (h > 3 ? 1.3 : 1);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.04 + h * 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, Math.min(16, t + 4.5));
          o.connect(g).connect(bus); o.start(t); o.stop(Math.min(16, t + 4.6));
        }
      });
    }),
  },
  {
    id: 'bell', name: 'Temple bell', kind: 'sfx', seconds: 5,
    make: () => renderGraph(5, (off) => {
      [[523.25, 1], [1046.5, 0.5], [1568, 0.25], [2637, 0.12]].forEach(([f, a]) => {
        const o = off.createOscillator(); o.frequency.value = f;
        const g = off.createGain(); g.gain.setValueAtTime(0.0001, 0);
        g.gain.exponentialRampToValueAtTime(0.4 * a, 0.01); g.gain.exponentialRampToValueAtTime(0.0001, 4.8);
        o.connect(g).connect(off.destination); o.start();
      });
    }),
  },
  {
    id: 'heartbeat', name: 'Heartbeat', kind: 'sfx', seconds: 4,
    make: () => renderGraph(4, (off) => {
      for (let b = 0; b < 4; b++) for (const [dt, a] of [[0, 1], [0.28, 0.7]]) {
        const t = b * 0.9 + dt, o = off.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        const g = off.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8 * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(off.destination); o.start(t); o.stop(t + 0.25);
      }
    }),
  },
  {
    id: 'page', name: 'Page turn', kind: 'sfx', seconds: 1,
    make: () => renderGraph(1, (off) => {
      const n = noiseSource(off, 1);
      const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1500, 0); bp.frequency.linearRampToValueAtTime(5000, 0.35);
      const g = off.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.5, 0.08); g.gain.linearRampToValueAtTime(0.15, 0.25); g.gain.linearRampToValueAtTime(0, 0.5);
      n.connect(bp).connect(g).connect(off.destination); n.start();
    }),
  },
];
