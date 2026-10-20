// Track 2: background music + sound effects, mixed under the voice.
// BGM volume is 0–20 % and is ducked automatically while the voice speaks.

import { SR, samplesToAudioBuffer, denoise, normalizeLoudness, limit } from './audio-utils.js';

// Voice activity envelope in 50 ms frames (true = speaking).
function voiceActivity(voice, thresholdDb = -38) {
  const win = Math.round(0.05 * SR), thr = Math.pow(10, thresholdDb / 20);
  const frames = [];
  for (let s = 0; s < voice.length; s += win) {
    const e = Math.min(voice.length, s + win);
    let sum = 0;
    for (let i = s; i < e; i++) sum += voice[i] * voice[i];
    frames.push(Math.sqrt(sum / (e - s)) > thr);
  }
  // hold speech for 300 ms so the music does not pump between words
  const hold = 6;
  const out = frames.slice();
  for (let i = 0; i < frames.length; i++) if (frames[i]) for (let k = 1; k <= hold && i + k < out.length; k++) out[i + k] = true;
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

// Render voice + BGM + SFX into one mono 44.1 kHz track.
// bgm: { samples, volume (0..0.2), duck (bool), loop (bool) } | null
// sfx: [{ samples, time (s), volume (0..1) }]
export async function renderMix(voice, bgm, sfx = []) {
  const sfxEnd = sfx.reduce((m, s) => Math.max(m, s.time * SR + s.samples.length), 0);
  const length = Math.max(voice.length, Math.ceil(sfxEnd), 1);
  const off = new OfflineAudioContext(1, length, SR);

  const v = off.createBufferSource();
  v.buffer = samplesToAudioBuffer(voice);
  v.connect(off.destination);
  v.start(0);

  if (bgm && bgm.samples && bgm.volume > 0) {
    const b = off.createBufferSource();
    b.buffer = samplesToAudioBuffer(bgm.samples);
    b.loop = bgm.loop !== false;
    const g = off.createGain();
    const full = bgm.volume, ducked = bgm.volume * 0.3;
    g.gain.setValueAtTime(full, 0);
    if (bgm.duck !== false) {
      const { frames, win } = voiceActivity(voice);
      let cur = null;
      for (let i = 0; i < frames.length; i++) {
        const want = frames[i] ? ducked : full;
        if (want !== cur) {
          const t = (i * win) / SR;
          // fast duck down (80 ms), slow return (400 ms)
          g.gain.setTargetAtTime(want, t, want < (cur ?? full) ? 0.08 / 3 : 0.4 / 3);
          cur = want;
        }
      }
    }
    // gentle fade in / out of the music bed
    const fade = Math.min(2, length / SR / 4);
    const fg = off.createGain();
    fg.gain.setValueAtTime(0, 0);
    fg.gain.linearRampToValueAtTime(1, fade);
    fg.gain.setValueAtTime(1, Math.max(fade, length / SR - fade));
    fg.gain.linearRampToValueAtTime(0, length / SR);
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
    n.start(Math.max(0, s.time));
  }

  const out = await off.startRendering();
  return limit(out.getChannelData(0).slice(), -3.2);
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
    id: 'pad', name: 'Calm pad, A minor (loop)', kind: 'bgm', seconds: 16,
    make: () => renderGraph(16, (off) => {
      const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 207.65, 246.94]];
      chords.forEach((ch, ci) => ch.forEach((f) => {
        for (const det of [-4, 4]) {
          const o = off.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
          const g = off.createGain(); const t0 = ci * 4;
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.06, t0 + 1.2);
          g.gain.setValueAtTime(0.06, t0 + 3); g.gain.linearRampToValueAtTime(0, t0 + 4.2);
          const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
          o.connect(lp).connect(g).connect(off.destination); o.start(t0); o.stop(Math.min(16, t0 + 4.3));
        }
      }));
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
