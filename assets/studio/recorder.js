// Chapter recorder: MediaRecorder + live waveform + live silence marks.
// Every second of audio is written to IndexedDB, so pausing and closing the
// browser leaves a "Paused draft" that can be resumed later.

import * as db from './db.js';
import { audioContext } from './audio-utils.js';

function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  for (const t of types) if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

export class ChapterRecorder extends EventTarget {
  constructor({ canvas, silenceDb = -45, silenceMin = 0.7, noiseSuppression = false } = {}) {
    super();
    this.canvas = canvas;
    this.silenceDb = silenceDb;
    this.silenceMin = silenceMin;
    this.noiseSuppression = noiseSuppression;
    this.state = 'idle'; // idle | recording | paused
    this.history = [];   // rolling [min,max] pairs for the live waveform
  }

  // offset = seconds already recorded in earlier sessions of this draft
  async start(draft, offset = 0) {
    if (this.state !== 'idle') return;
    if (!window.MediaRecorder) throw new Error('This browser cannot record audio. Use Chrome, Edge or Firefox.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, autoGainControl: false, noiseSuppression: this.noiseSuppression },
    });
    this.draft = draft;
    this.mime = pickMime();
    this.session = (draft.sessions || []).reduce((m, s) => Math.max(m, s.id), 0) + 1;
    draft.sessions = [...(draft.sessions || []), { id: this.session, mime: this.mime, closed: false, startedAt: Date.now() }];
    draft.status = 'recording';
    await db.putDraft(draft);

    this.seq = 0;
    this.pending = Promise.resolve();
    this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 128000 } : undefined);
    this.mime = this.rec.mimeType || this.mime;
    this.rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const seq = this.seq++;
      // keep writes in order; a failed write must not stop the recording
      this.pending = this.pending.then(() => db.putChunk(draft.chapterId, this.session, seq, e.data))
        .catch((err) => this.dispatchEvent(new CustomEvent('error', { detail: err })));
    };
    this.rec.start(1000);

    const ac = audioContext();
    if (ac.state === 'suspended') await ac.resume();
    this.srcNode = ac.createMediaStreamSource(this.stream);
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 2048;
    this.srcNode.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);

    this.offset = offset;
    this.elapsed = 0;
    this.lastTick = performance.now();
    this.quietSince = null;
    this.silences = [];
    this.markers = [];
    this.level = -100;
    this.state = 'recording';
    this.loop();
    this.emit('state');
  }

  get time() { return this.offset + this.elapsed; }

  loop() {
    if (this.state === 'idle') return;
    const now = performance.now();
    if (this.state === 'recording') this.elapsed += (now - this.lastTick) / 1000;
    this.lastTick = now;

    this.analyser.getFloatTimeDomainData(this.buf);
    let mn = 0, mx = 0, sum = 0;
    for (let i = 0; i < this.buf.length; i++) { const x = this.buf[i]; if (x < mn) mn = x; if (x > mx) mx = x; sum += x * x; }
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = rms > 0 ? 20 * Math.log10(rms) : -100;

    if (this.state === 'recording') {
      this.history.push(mn, mx);
      if (this.history.length > 4000) this.history.splice(0, this.history.length - 4000);
      // live silence marking
      if (this.level < this.silenceDb) {
        if (this.quietSince == null) this.quietSince = this.time;
      } else if (this.quietSince != null) {
        if (this.time - this.quietSince >= this.silenceMin) {
          this.silences.push({ start: this.quietSince, end: this.time });
          this.emit('silence');
        }
        this.quietSince = null;
      }
    }
    this.draw();
    this.emit('tick');
    this.raf = requestAnimationFrame(() => this.loop());
  }

  draw() {
    const c = this.canvas; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(c);
    g.strokeStyle = css.getPropertyValue('--grid').trim() || 'rgba(255,255,255,.08)';
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    const pairs = this.history.length / 2, cols = Math.min(pairs, Math.floor(w / 2));
    g.fillStyle = this.state === 'paused' ? (css.getPropertyValue('--wave-paused').trim() || '#888') : (css.getPropertyValue('--wave-live').trim() || '#f59e0b');
    for (let i = 0; i < cols; i++) {
      const p = pairs - cols + i;
      const mn = this.history[p * 2], mx = this.history[p * 2 + 1];
      const y1 = h / 2 - mx * h * 0.48, y2 = h / 2 - mn * h * 0.48;
      g.fillRect(w - (cols - i) * 2, y1, 1.5, Math.max(1, y2 - y1));
    }
  }

  pause() {
    if (this.state !== 'recording') return;
    this.rec.pause();
    this.rec.requestData();
    this.state = 'paused';
    this.draft.status = 'paused';
    this.draft.recordedSeconds = this.time;
    db.putDraft(this.draft);
    this.emit('state');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.rec.resume();
    this.state = 'recording';
    this.draft.status = 'recording';
    db.putDraft(this.draft);
    this.lastTick = performance.now();
    this.emit('state');
  }

  toggle() { if (this.state === 'recording') this.pause(); else if (this.state === 'paused') this.resume(); }

  // Mark a mistake at the current moment (key M). Shown in the editor.
  mark() {
    if (this.state === 'idle') return;
    this.markers.push(this.time);
    this.emit('marker');
  }

  // Save progress without stopping (Ctrl+S during recording).
  async flush() {
    if (this.state === 'idle') return;
    this.rec.requestData();
    await new Promise((r) => setTimeout(r, 150));
    await this.pending;
    this.draft.recordedSeconds = this.time;
    this.draft.liveSilences = [...(this.draft.liveSilences || []), ...this.silences.splice(0)];
    this.draft.liveMarkers = [...(this.draft.liveMarkers || []), ...this.markers.splice(0)];
    await db.putDraft(this.draft);
  }

  // Stop and close this session. Returns the draft (still with raw sessions).
  async stop() {
    if (this.state === 'idle') return this.draft;
    const stopped = new Promise((r) => { this.rec.onstop = r; });
    this.rec.stop();
    await stopped;
    await this.pending;
    cancelAnimationFrame(this.raf);
    this.stream.getTracks().forEach((t) => t.stop());
    try { this.srcNode.disconnect(); } catch (_) {}
    const s = this.draft.sessions.find((x) => x.id === this.session);
    if (s) { s.closed = true; s.mime = this.mime; s.seconds = this.elapsed; }
    this.draft.recordedSeconds = this.time;
    this.draft.liveSilences = [...(this.draft.liveSilences || []), ...this.silences];
    this.draft.liveMarkers = [...(this.draft.liveMarkers || []), ...this.markers];
    this.state = 'idle';
    this.history = [];
    this.draw();
    await db.putDraft(this.draft);
    this.emit('state');
    return this.draft;
  }

  emit(type) { this.dispatchEvent(new Event(type)); }
}
