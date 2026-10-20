// Non-destructive edit model for one chapter.
// Audio "sources" (recording sessions, imported files, patches) are never
// changed. The edited voice track is a list of segments pointing into them,
// so cut / insert / undo / redo are instant even for long chapters.

import * as db from './db.js';
import { SR, decodeToMono } from './audio-utils.js';

export class Project {
  constructor(draft) {
    this.draft = draft;
    this.sources = new Map(); // srcId -> Float32Array
    this.segments = draft.segments ? draft.segments.map((s) => ({ ...s })) : [];
    this.undoStack = [];
    this.redoStack = [];
    this._cache = null;
  }

  // ----- loading -----

  // Decode every source of the draft. Closes any recording sessions that
  // were interrupted (tab closed while recording or paused).
  static async open(draft, onProgress = () => {}) {
    const p = new Project(draft);
    draft.sources = draft.sources || {};
    const newSegments = [];
    let offset = p.totalSamples();
    for (const s of draft.sessions || []) {
      const srcId = 'rec-' + s.id;
      if (!draft.sources[srcId]) {
        onProgress('Decoding recording part ' + s.id + '…');
        const blob = await db.sessionBlob(draft.chapterId, s.id, s.mime);
        if (!blob.size) continue;
        let samples;
        try { samples = await decodeToMono(blob); } catch (e) { console.warn('session decode failed', s.id, e); continue; }
        draft.sources[srcId] = { kind: 'rec', session: s.id };
        s.closed = true;
        p.sources.set(srcId, samples);
        newSegments.push({ src: srcId, start: 0, end: samples.length });
        // move live markers recorded in this session into source coordinates
        const secs = samples.length / SR;
        draft.markers = draft.markers || [];
        for (const t of draft.liveMarkers || []) {
          const local = t - offset / SR;
          if (local >= 0 && local <= secs) draft.markers.push({ src: srcId, pos: Math.round(local * SR) });
        }
        offset += samples.length;
      }
    }
    draft.liveMarkers = [];
    draft.liveSilences = [];
    for (const [srcId, info] of Object.entries(draft.sources)) {
      if (p.sources.has(srcId)) continue;
      onProgress('Loading ' + srcId + '…');
      let blob = null;
      if (info.kind === 'rec') blob = await db.sessionBlob(draft.chapterId, info.session, (draft.sessions.find((x) => x.id === info.session) || {}).mime);
      else if (info.blobKey) blob = await db.getBlob(info.blobKey);
      if (!blob || !blob.size) { console.warn('missing source', srcId); continue; }
      p.sources.set(srcId, await decodeToMono(blob));
    }
    // drop segments whose source vanished (e.g. storage cleared)
    p.segments = p.segments.filter((s) => p.sources.has(s.src));
    if (newSegments.length) p.segments.push(...newSegments);
    p.save();
    return p;
  }

  async addFileSource(blob, name) {
    const key = await db.putBlob(blob, name);
    const samples = await decodeToMono(blob);
    const srcId = 'file-' + key;
    this.draft.sources[srcId] = { kind: 'file', blobKey: key, name };
    this.sources.set(srcId, samples);
    return { srcId, length: samples.length };
  }

  // A patch recorded inside the editor is a normal recording session.
  async addSessionSource(sessionId, mime) {
    const blob = await db.sessionBlob(this.draft.chapterId, sessionId, mime);
    const samples = await decodeToMono(blob);
    const srcId = 'rec-' + sessionId;
    this.draft.sources[srcId] = { kind: 'rec', session: sessionId };
    this.sources.set(srcId, samples);
    return { srcId, length: samples.length };
  }

  // ----- timeline -----

  totalSamples() { return this.segments.reduce((a, s) => a + (s.end - s.start), 0); }
  get duration() { return this.totalSamples() / SR; }

  render() {
    if (this._cache) return this._cache;
    const out = new Float32Array(this.totalSamples());
    let o = 0;
    for (const s of this.segments) {
      const src = this.sources.get(s.src);
      out.set(src.subarray(s.start, s.end), o);
      o += s.end - s.start;
    }
    this._cache = out;
    return out;
  }

  // Map a source position to the current timeline (seconds) or null if cut.
  sourceToTime(srcId, pos) {
    let o = 0;
    for (const s of this.segments) {
      if (s.src === srcId && pos >= s.start && pos <= s.end) return (o + pos - s.start) / SR;
      o += s.end - s.start;
    }
    return null;
  }

  // Map a timeline time to { src, pos }.
  timeToSource(t) {
    let target = Math.round(t * SR), o = 0;
    for (const s of this.segments) {
      const len = s.end - s.start;
      if (target <= o + len) return { src: s.src, pos: s.start + (target - o) };
      o += len;
    }
    return null;
  }

  snapshot() {
    this.undoStack.push(this.segments.map((s) => ({ ...s })));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  changed() { this._cache = null; this.save(); }

  // split the segment list at sample index (timeline coordinates)
  splitAt(sample) {
    let o = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i], len = s.end - s.start;
      if (sample > o && sample < o + len) {
        const cut = s.start + (sample - o);
        this.segments.splice(i, 1, { src: s.src, start: s.start, end: cut }, { src: s.src, start: cut, end: s.end });
        return i + 1;
      }
      if (sample === o) return i;
      o += len;
    }
    return this.segments.length;
  }

  deleteRange(t0, t1) {
    const a = Math.max(0, Math.round(Math.min(t0, t1) * SR)), b = Math.min(this.totalSamples(), Math.round(Math.max(t0, t1) * SR));
    if (b - a < 1) return false;
    this.snapshot();
    this.splitAt(a);
    this.splitAt(b);
    let o = 0;
    this.segments = this.segments.filter((s) => {
      const st = o; o += s.end - s.start;
      return !(st >= a && st < b);
    });
    this.changed();
    return true;
  }

  // keep only the selection (trim)
  trimTo(t0, t1) {
    const total = this.duration;
    this.snapshot();
    const keepUndo = this.undoStack.length;
    this.deleteRangeNoSnap(Math.max(t0, t1), total);
    this.deleteRangeNoSnap(0, Math.min(t0, t1));
    this.undoStack.length = keepUndo;
    this.changed();
  }

  deleteRangeNoSnap(t0, t1) {
    const a = Math.round(t0 * SR), b = Math.round(t1 * SR);
    if (b - a < 1) return;
    this.splitAt(a); this.splitAt(b);
    let o = 0;
    this.segments = this.segments.filter((s) => { const st = o; o += s.end - s.start; return !(st >= a && st < b); });
  }

  insertAt(t, srcId, start, end) {
    this.snapshot();
    const idx = this.splitAt(Math.round(Math.max(0, Math.min(t, this.duration)) * SR));
    this.segments.splice(idx, 0, { src: srcId, start, end });
    this.changed();
  }

  // replace the selection with a source (used for "re-record selection")
  replaceRange(t0, t1, srcId, start, end) {
    this.snapshot();
    const keep = this.undoStack.length;
    this.deleteRangeNoSnap(Math.min(t0, t1), Math.max(t0, t1));
    const idx = this.splitAt(Math.round(Math.min(t0, t1) * SR));
    this.segments.splice(idx, 0, { src: srcId, start, end });
    this.undoStack.length = keep;
    this.changed();
  }

  // Shorten every silence longer than maxSec to keepSec (one click tidy-up).
  tightenSilences(silences, maxSec = 1.2, keepSec = 0.6) {
    const cuts = silences.filter((s) => s.end - s.start > maxSec)
      .map((s) => ({ a: s.start + keepSec / 2, b: s.end - keepSec / 2 }))
      .sort((x, y) => y.a - x.a); // from the end so earlier times stay valid
    if (!cuts.length) return 0;
    this.snapshot();
    for (const c of cuts) this.deleteRangeNoSnap(c.a, c.b);
    this.changed();
    return cuts.length;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.segments.map((s) => ({ ...s })));
    this.segments = this.undoStack.pop();
    this.changed();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.segments.map((s) => ({ ...s })));
    this.segments = this.redoStack.pop();
    this.changed();
    return true;
  }

  // ----- persistence -----

  save() {
    this.draft.segments = this.segments.map((s) => ({ ...s }));
    this.draft.duration = this.duration;
    return db.putDraft(this.draft);
  }
}
