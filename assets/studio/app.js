// Zindagi Writer Desk — Audiobook Studio: UI and workflow.

import WaveSurfer from './vendor/wavesurfer.esm.js';
import RegionsPlugin from './vendor/regions.esm.js';
import TimelinePlugin from './vendor/timeline.esm.js';

import * as gh from './github.js';
import * as db from './db.js';
import { ChapterRecorder } from './recorder.js';
import { Project } from './project.js';
import { LIBRARY, processVoice, renderMix } from './mixer.js';
import { encodeMp3, tagMp3, loadCover, download } from './export.js';
import * as yt from './youtube.js';
import {
  SR, decodeToMono, encodeWav, computePeaks, detectSilences, acxCheck, integratedLoudness,
  peakDb, formatTime, parseTime,
} from './audio-utils.js';

// ---------------------------------------------------------------- helpers
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = {
  recording: ['Recording', 'st-recording'], paused: ['Paused', 'st-paused'], draft: ['Draft Ready', 'st-draft'],
  edited: ['Edited', 'st-edited'], ready: ['Ready for Upload', 'st-ready'],
};
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let toastTimer;
function toast(msg, isErr = false, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', isErr); t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function busy(text, frac) {
  const b = $('#busy');
  if (text === false) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden'); $('#busyText').textContent = text;
  $('#busyBar').style.width = frac != null ? Math.round(frac * 100) + '%' : '100%';
}
async function guard(fn, label) {
  try { return await fn(); } catch (e) { console.error(e); busy(false); toast((label ? label + ': ' : '') + (e.message || e), true, 7000); }
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------- state
const S = {
  chapters: [], remote: {}, drafts: new Map(), current: null, project: null,
  recorder: null, patch: null, ws: null, regions: null, selection: null, silences: [],
  tab: 'record', audioCache: new Map(), coverBlob: null, waveUrl: null,
};

// ---------------------------------------------------------------- theme
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('zws.studio.theme', t); } catch (_) {}
  if (S.ws) S.ws.setOptions({ waveColor: cssVar('--wave'), progressColor: cssVar('--wave-progress'), cursorColor: cssVar('--text') });
  drawLane();
}
try { const t = localStorage.getItem('zws.studio.theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
$('#btnTheme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

// ---------------------------------------------------------------- GitHub
async function refreshGhPill() {
  const dot = $('#ghDot'), txt = $('#ghText');
  if (!gh.isConnected()) { dot.className = 'dot warn'; txt.textContent = 'GitHub: not connected'; return false; }
  dot.className = 'dot'; txt.textContent = 'GitHub: checking…';
  try {
    const u = await gh.verify();
    dot.className = 'dot ok'; txt.textContent = 'GitHub: ' + u.login; return true;
  } catch (e) {
    dot.className = 'dot err'; txt.textContent = 'GitHub: ' + (e.status === 401 ? 'token invalid' : 'error'); toast(e.message, true, 7000); return false;
  }
}

$('#ghPill').onclick = () => {
  $('#tokenInput').value = ''; $('#tokenMsg').textContent = gh.isConnected() ? 'A token is saved. Paste a new one to replace it.' : '';
  try { $('#uploadApi').value = localStorage.getItem('zws.studio.uploadApi') || ''; $('#googleClientId').value = localStorage.getItem('zws.studio.googleClientId') || ''; } catch (_) {}
  $('#dlgSettings').showModal();
};
$('#tokenSave').onclick = async () => {
  const t = $('#tokenInput').value.trim();
  try { localStorage.setItem('zws.studio.uploadApi', $('#uploadApi').value.trim()); localStorage.setItem('zws.studio.googleClientId', $('#googleClientId').value.trim()); } catch (_) {}
  if (!t) { if (gh.isConnected()) $('#dlgSettings').close(); else $('#tokenMsg').textContent = 'Paste the token first.'; return; }
  const old = gh.getToken();
  gh.setToken(t);
  $('#tokenMsg').textContent = 'Checking…';
  try {
    const u = await gh.verify();
    $('#tokenMsg').textContent = 'Connected as ' + u.login + '.';
    $('#dlgSettings').close(); refreshGhPill(); loadChapters();
  } catch (e) { gh.setToken(old); $('#tokenMsg').textContent = e.message; }
};
$('#tokenRemove').onclick = () => { gh.setToken(''); refreshGhPill(); $('#dlgSettings').close(); toast('GitHub token removed from this browser.'); };
document.querySelectorAll('dialog [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

// ---------------------------------------------------------------- chapters
async function loadChapters() {
  $('#chapterList').innerHTML = '<li class="muted small" style="padding:8px">Loading chapters from GitHub…</li>';
  try {
    const { chapters, remote } = await gh.loadChapters();
    S.chapters = chapters; S.remote = remote;
  } catch (e) {
    $('#chapterList').innerHTML = `<li class="muted small" style="padding:8px">${esc(e.message)}${gh.isConnected() ? '' : '<br>Connect GitHub (top right) to load chapters reliably.'}</li>`;
    return;
  }
  for (const d of await db.allDrafts()) S.drafts.set(d.chapterId, d);
  renderChapterList();
  if (S.current) {
    const fresh = S.chapters.find((c) => c.id === S.current.id);
    if (fresh) { S.current = fresh; renderScript(); }
  } else {
    const want = new URLSearchParams(location.hash.slice(1)).get('chapter');
    if (want && S.chapters.some((c) => c.id === want)) selectChapter(want);
  }
}
$('#btnReload').onclick = () => loadChapters();
$('#btnChapters').onclick = () => $('#leftPanel').classList.toggle('open');

function chapterStatus(id) {
  const d = S.drafts.get(id);
  if (d && STATUS[d.status]) return d.status;
  if (S.remote[id] && S.remote[id].final) return 'ready';
  if (S.remote[id] && S.remote[id].latestDraft) return 'draft';
  return '';
}

function renderChapterList() {
  const ul = $('#chapterList');
  if (!S.chapters.length) {
    ul.innerHTML = '<li class="muted small" style="padding:8px">No chapters yet. Add files like <code>chapters/chapter-1.md</code> (Writer\'s Desk → Audiobook chapters).</li>';
    return;
  }
  let html = '', book = null;
  for (const c of S.chapters) {
    if (c.book !== book) { book = c.book; html += `<li class="book">${esc(book)}</li>`; }
    const st = chapterStatus(c.id), d = S.drafts.get(c.id);
    const sub = [STATUS[st] ? STATUS[st][0] : 'Not recorded', d && d.duration ? formatTime(d.duration) : ''].filter(Boolean).join(' · ');
    html += `<li><button data-id="${esc(c.id)}" class="${S.current && S.current.id === c.id ? 'active' : ''}">
      <span class="dot ${STATUS[st] ? STATUS[st][1] : ''}"></span>
      <span><span class="t">${c.number != null ? esc(c.number) + '. ' : ''}${esc(c.title)}</span><span class="s">${esc(sub)}</span></span></button></li>`;
  }
  ul.innerHTML = html;
  ul.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => { $('#leftPanel').classList.remove('open'); selectChapter(b.dataset.id); }));
}

// very small, safe markdown → HTML for the script view
function renderMarkdown(md) {
  return md.split(/\n{2,}/).map((block) => {
    const b = block.trim(); if (!b) return '';
    const h = /^(#{1,3})\s+(.*)$/.exec(b);
    let inner = esc(h ? h[2] : b)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
    return h ? `<h${h[1].length + 1}>${inner}</h${h[1].length + 1}>` : `<p>${inner}</p>`;
  }).join('');
}

function renderScript() {
  const c = S.current;
  $('#chTitle').textContent = (c.number != null ? c.number + '. ' : '') + c.title + (c.titleHi ? ' · ' + c.titleHi : '');
  $('#chMeta').textContent = c.book + ' · ' + c.author;
  $('#scriptText').innerHTML = renderMarkdown(c.body) || '<p class="muted">This chapter file is empty.</p>';
  if (!$('#expDesc').value) $('#expDesc').value = c.description || '';
}

function setStatusChip() {
  const st = S.current ? chapterStatus(S.current.id) : '';
  $('#chStatus').textContent = STATUS[st] ? STATUS[st][0] : 'No draft';
  $('#chStatus').className = 'chip';
  renderChapterList();
}

async function selectChapter(id) {
  if (S.recorder && S.recorder.state !== 'idle') { toast('Stop the recording first.', true); return; }
  const c = S.chapters.find((x) => x.id === id); if (!c) return;
  S.current = c; S.project = null; S.selection = null;
  history.replaceState(null, '', '#chapter=' + encodeURIComponent(id));
  $('#emptyState').classList.add('hidden'); $('#workspace').classList.remove('hidden');
  renderScript();
  $('#script').scrollTop = 0;
  $('#checklist').innerHTML = ''; $('#expStep').textContent = ''; $('#measureOut').innerHTML = '';
  $('#previewAudio').classList.add('hidden');
  let d = await db.getDraft(id);
  if (d) S.drafts.set(id, d);
  loadMixUi(d);
  setStatusChip();
  updateRecordInfo();
  if (d && (d.status === 'paused' || d.status === 'recording') && unprocessedSessions(d).length) {
    showTab('record');
    askResume(d);
    return;
  }
  if (d && d.segments && d.segments.length) {
    await openProject(d);
    showTab('edit');
  } else {
    showTab('record');
  }
}

function unprocessedSessions(d) { return (d.sessions || []).filter((s) => !(d.sources || {})['rec-' + s.id]); }

function newDraft(c) {
  return {
    chapterId: c.id, title: c.title, number: c.number, status: 'draft', sessions: [], sources: {}, segments: [],
    markers: [], duration: 0, version: 0, mix: defaultMix(), createdAt: Date.now(),
  };
}
function defaultMix() { return { normalize: true, target: -16, denoise: false, bgm: null, sfx: [] }; }
function currentDraft() { return S.current ? S.drafts.get(S.current.id) : null; }

// ---------------------------------------------------------------- tabs & script tools
function showTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#recordDeck').classList.toggle('hidden', tab !== 'record');
  $('#editDeck').classList.toggle('hidden', tab !== 'edit');
  if (tab === 'edit') { if (S.project) refreshWave(); else showEditEmpty(); }
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  if (S.recorder && S.recorder.state !== 'idle') { toast('Stop the recording first.', true); return; }
  showTab(b.dataset.tab);
}));

function showEditEmpty() {
  const r = S.current && S.remote[S.current.id];
  if (r && r.latestDraft) {
    $('#markerList').innerHTML = `<span class="muted small">No local recording on this computer. </span><button class="btn" id="loadRemote">⤓ Load draft v${r.latestDraft.v} from GitHub</button>`;
    $('#loadRemote').onclick = () => guard(loadRemoteDraft, 'Load draft');
  } else {
    $('#markerList').innerHTML = '<span class="muted small">Record this chapter first (Record tab).</span>';
  }
}

let fontSize = Number(localStorage.getItem('zws.studio.font') || 22);
function setFont(n) { fontSize = Math.max(14, Math.min(44, n)); $('#script').style.setProperty('--script-size', fontSize + 'px'); try { localStorage.setItem('zws.studio.font', fontSize); } catch (_) {} }
setFont(fontSize);
$('#fontUp').onclick = () => setFont(fontSize + 2);
$('#fontDown').onclick = () => setFont(fontSize - 2);
$('#autoScroll').onchange = () => $('#script').classList.toggle('prompter', $('#autoScroll').checked);
(function prompterLoop() {
  let last = performance.now(), acc = 0;
  const step = (now) => {
    const dt = (now - last) / 1000; last = now;
    if ($('#autoScroll').checked && S.recorder && S.recorder.state === 'recording') {
      acc += dt * Number($('#scrollSpeed').value);
      if (acc >= 1) { const px = Math.floor(acc); acc -= px; $('#script').style.scrollBehavior = 'auto'; $('#script').scrollTop += px; }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})();

// ---------------------------------------------------------------- recording
const liveCanvas = $('#liveWave');

function recorderFor() {
  const r = new ChapterRecorder({ canvas: liveCanvas });
  r.addEventListener('tick', () => {
    $('#recTimer').textContent = formatTime(r.time);
    $('#meter').style.width = Math.max(0, Math.min(100, (r.level + 60) / 60 * 100)) + '%';
  });
  r.addEventListener('state', updateRecordButtons);
  r.addEventListener('silence', updateRecordInfo);
  r.addEventListener('marker', () => { updateRecordInfo(); toast('Mistake marked at ' + formatTime(r.time)); });
  r.addEventListener('error', (e) => toast('Could not save audio: ' + (e.detail && e.detail.message), true, 8000));
  return r;
}

function updateRecordButtons() {
  const st = S.recorder ? S.recorder.state : 'idle';
  $('#btnRecord').classList.toggle('hidden', st !== 'idle');
  $('#btnPause').classList.toggle('hidden', st === 'idle');
  $('#btnStop').classList.toggle('hidden', st === 'idle');
  $('#btnMark').classList.toggle('hidden', st === 'idle');
  $('#btnPause').textContent = st === 'paused' ? '● Resume' : '❚❚ Pause';
  $('#btnPause').classList.toggle('rec', st === 'paused');
  if (st !== 'idle') setStatusChip();
}

function updateRecordInfo() {
  const d = currentDraft(), r = S.recorder;
  const parts = [];
  if (d && d.duration) parts.push('Recorded so far: ' + formatTime(d.duration) + ' (new takes are added at the end)');
  if (r && r.state !== 'idle') parts.push('Pauses detected: ' + r.silences.length, 'Mistake marks: ' + r.markers.length);
  $('#recInfo').textContent = parts.join(' · ');
}

async function startRecording(resumeDraft) {
  const c = S.current; if (!c) return;
  let d = resumeDraft || currentDraft();
  if (!d) { d = newDraft(c); S.drafts.set(c.id, d); }
  const offset = unprocessedSessions(d).length ? (d.recordedSeconds || 0) : (d.duration || 0);
  S.recorder = recorderFor();
  try {
    await S.recorder.start(d, offset);
  } catch (e) {
    S.recorder = null;
    toast(e.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in the address bar and try again.' : e.message, true, 8000);
    return;
  }
  db.persist();
  updateRecordButtons(); updateRecordInfo();
}

async function stopRecording() {
  if (!S.recorder || S.recorder.state === 'idle') return;
  const d = await S.recorder.stop();
  S.recorder = null;
  updateRecordButtons();
  await openProject(d);
  d.status = 'draft';
  await S.project.save();
  setStatusChip();
  showTab('edit');
  toast('Recording saved as a draft. You can edit it now.');
  if ($('#optSync').checked && gh.isConnected()) guard(syncDraft, 'GitHub');
}

$('#btnRecord').onclick = () => startRecording();
$('#btnPause').onclick = () => S.recorder && S.recorder.toggle();
$('#btnStop').onclick = () => guard(stopRecording, 'Stop');
$('#btnMark').onclick = () => S.recorder && S.recorder.mark();

// resume prompt for interrupted drafts
function askResume(d) {
  const secs = d.recordedSeconds || 0;
  $('#resumeText').innerHTML = `<b>${esc(d.title)}</b> has a recording that was paused or interrupted at <b>${formatTime(secs)}</b>. Every second up to that point is safe on this computer.`;
  const dlg = $('#dlgResume');
  $('#resumeGo').onclick = () => { dlg.close(); startRecording(d); };
  $('#resumeFinish').onclick = () => guard(async () => {
    dlg.close();
    await openProject(d);
    d.status = 'draft'; await S.project.save(); setStatusChip(); showTab('edit');
  }, 'Finish draft');
  $('#resumeDiscard').onclick = () => guard(async () => {
    if (!confirm('Delete the unfinished recording? This cannot be undone.')) return;
    dlg.close();
    const dead = unprocessedSessions(d).map((s) => s.id);
    await db.deleteSessions(d.chapterId, dead);
    d.sessions = d.sessions.filter((s) => !dead.includes(s.id));
    d.liveMarkers = []; d.liveSilences = [];
    if (!d.segments || !d.segments.length) { await db.deleteDraft(d.chapterId); S.drafts.delete(d.chapterId); }
    else { d.status = 'edited'; await db.putDraft(d); await openProject(d); }
    setStatusChip(); updateRecordInfo();
  }, 'Discard');
  dlg.showModal();
}

// ---------------------------------------------------------------- editor
async function openProject(d) {
  busy('Preparing audio…');
  try {
    S.project = await Project.open(d, (t) => busy(t));
    S.drafts.set(d.chapterId, d);
  } finally { busy(false); }
  return S.project;
}

function ensureWave() {
  if (S.ws) return;
  S.regions = RegionsPlugin.create();
  S.ws = WaveSurfer.create({
    container: '#waveform', height: 150, normalize: true, autoScroll: true, dragToSeek: false,
    waveColor: cssVar('--wave'), progressColor: cssVar('--wave-progress'), cursorColor: cssVar('--text'), cursorWidth: 2,
    plugins: [S.regions, TimelinePlugin.create({ height: 16, style: { fontSize: '10px', color: cssVar('--muted') } })],
  });
  S.regions.enableDragSelection({ color: 'rgba(245,165,36,.28)' });
  S.regions.on('region-created', (r) => {
    if (String(r.id).startsWith('sil-') || String(r.id).startsWith('mk-')) return;
    if (S.selection && S.selection !== r) S.selection.remove();
    S.selection = r;
  });
  S.regions.on('region-clicked', (r, e) => {
    if (String(r.id).startsWith('sil-') || String(r.id).startsWith('mk-')) { e.stopPropagation(); S.ws.setTime(r.start); }
  });
  S.ws.on('interaction', () => { if (S.selection) { S.selection.remove(); S.selection = null; } });
  S.ws.on('timeupdate', (t) => { $('#edPos').textContent = formatTime(t, true) + ' / ' + formatTime(S.ws.getDuration()); });
  S.ws.on('play', () => ($('#edPlay').textContent = '❚❚ Pause'));
  S.ws.on('pause', () => ($('#edPlay').textContent = '▶ Play'));
}

async function refreshWave(keepTime) {
  if (!S.project) return;
  ensureWave();
  const samples = S.project.render();
  const dur = samples.length / SR;
  const t = keepTime != null ? keepTime : (S.ws.getCurrentTime() || 0);
  if (S.waveUrl) URL.revokeObjectURL(S.waveUrl);
  S.waveUrl = URL.createObjectURL(encodeWav(samples));
  const peaks = computePeaks(samples, Math.min(20000, Math.max(2000, Math.round(dur * 50))));
  S.selection = null;
  await S.ws.load(S.waveUrl, [peaks], dur);
  S.ws.setTime(Math.min(t, dur));
  S.regions.clearRegions();
  S.silences = detectSilences(samples);
  S.silences.forEach((s, i) => S.regions.addRegion({ id: 'sil-' + i, start: s.start, end: s.end, color: 'rgba(147,160,180,.16)', drag: false, resize: false }));
  renderMarkers();
  drawLane();
  $('#edPos').textContent = formatTime(S.ws.getCurrentTime(), true) + ' / ' + formatTime(dur);
}

function markerTimes() {
  const d = currentDraft();
  return (d && d.markers ? d.markers : []).map((m, i) => ({ i, t: S.project.sourceToTime(m.src, m.pos) })).filter((m) => m.t != null);
}

function renderMarkers() {
  const list = $('#markerList');
  const ms = markerTimes();
  ms.forEach((m) => S.regions.addRegion({ id: 'mk-' + m.i, start: m.t, color: cssVar('--red'), content: '⚑', drag: false, resize: false }));
  list.innerHTML = ms.length ? ms.map((m) => `<span class="m">⚑ ${formatTime(m.t)} <button data-mk="${m.i}" title="Cut the phrase before this mark">✕ cut</button><button data-skip="${m.i}" title="Remove the flag only">keep</button></span>`).join('') : '';
  list.querySelectorAll('[data-mk]').forEach((b) => (b.onclick = () => cutMistake(Number(b.dataset.mk))));
  list.querySelectorAll('[data-skip]').forEach((b) => (b.onclick = () => { removeMarker(Number(b.dataset.skip)); refreshWave(); }));
}

function removeMarker(i) { const d = currentDraft(); d.markers.splice(i, 1); db.putDraft(d); }

// One-click mistake removal: cut from the end of the pause before the mark to the mark.
function cutMistake(i) {
  const m = markerTimes().find((x) => x.i === i); if (!m) return;
  const before = S.silences.filter((s) => s.end <= m.t - 0.2).pop();
  const start = before ? Math.max(before.end - 0.15, m.t - 30) : Math.max(0, m.t - 3);
  removeMarker(i);
  if (S.project.deleteRange(start, m.t + 0.1)) { markEdited(); refreshWave(start); toast('Cut ' + formatTime(m.t - start, true) + ' (undo with Ctrl+Z).'); }
}

function markEdited() {
  const d = currentDraft();
  if (d && d.status !== 'recording' && d.status !== 'paused') { d.status = 'edited'; db.putDraft(d); setStatusChip(); }
}

function sel() { return S.selection ? { a: S.selection.start, b: S.selection.end } : null; }
function cursor() { return S.ws ? S.ws.getCurrentTime() : 0; }

$('#edPlay').onclick = () => S.ws && S.ws.playPause();
$('#edUndo').onclick = () => { if (S.project && S.project.undo()) { markEdited(); refreshWave(); } };
$('#edRedo').onclick = () => { if (S.project && S.project.redo()) { markEdited(); refreshWave(); } };
$('#edDelete').onclick = () => {
  const s = sel(); if (!s) { toast('Drag on the waveform to select what to delete.'); return; }
  if (S.project.deleteRange(s.a, s.b)) { markEdited(); refreshWave(Math.min(s.a, s.b)); }
};
$('#edTrim').onclick = () => {
  const s = sel(); if (!s) { toast('Select the part you want to keep.'); return; }
  S.project.trimTo(s.a, s.b); markEdited(); refreshWave(0);
};
$('#edInsert').onclick = () => { if (!S.project) return toast('Record or load a draft first.'); $('#insertFile').click(); };
$('#insertFile').onchange = () => guard(async () => {
  const f = $('#insertFile').files[0]; $('#insertFile').value = ''; if (!f) return;
  busy('Decoding ' + f.name + '…');
  const at = cursor(), s = sel();
  const { srcId, length } = await S.project.addFileSource(f, f.name);
  if (s) S.project.replaceRange(s.a, s.b, srcId, 0, length); else S.project.insertAt(at, srcId, 0, length);
  busy(false); markEdited(); refreshWave(at);
  toast((s ? 'Replaced selection with ' : 'Inserted ') + f.name);
}, 'Insert');

$('#edPatch').onclick = () => guard(async () => {
  if (!S.project) return toast('Record the chapter first.');
  const btn = $('#edPatch');
  if (S.patch) { // stop patch
    const { rec, at, s } = S.patch; S.patch = null;
    const d = await rec.stop();
    btn.textContent = '● Record patch'; btn.classList.remove('rec');
    const session = d.sessions[d.sessions.length - 1];
    d.liveMarkers = []; d.liveSilences = [];
    busy('Adding patch…');
    const { srcId, length } = await S.project.addSessionSource(session.id, session.mime);
    if (s) S.project.replaceRange(s.a, s.b, srcId, 0, length); else S.project.insertAt(at, srcId, 0, length);
    d.status = 'edited'; await S.project.save();
    busy(false); setStatusChip(); refreshWave(at);
    toast(s ? 'Selection replaced with the new take.' : 'Patch added at ' + formatTime(at) + '.');
    return;
  }
  if (S.ws.isPlaying()) S.ws.pause();
  const d = currentDraft();
  const rec = new ChapterRecorder({ canvas: null });
  await rec.start(d, 0);
  S.patch = { rec, at: cursor(), s: sel() };
  btn.textContent = '■ Stop patch'; btn.classList.add('rec');
  toast(S.patch.s ? 'Recording a replacement for the selection… press Stop patch when done.' : 'Recording a patch at ' + formatTime(S.patch.at) + '… press Stop patch when done.', false, 6000);
}, 'Patch');

$('#edSilence').onclick = () => {
  if (!S.project) return;
  const n = S.project.tightenSilences(S.silences);
  if (n) { markEdited(); refreshWave(0); toast(n + ' long pause(s) shortened. Undo with Ctrl+Z.'); } else toast('No pauses longer than 1.2 s.');
};
$('#edZoom').oninput = () => S.ws && S.ws.zoom(Number($('#edZoom').value));

async function loadRemoteDraft() {
  const c = S.current, r = S.remote[c.id];
  busy('Downloading ' + r.latestDraft.path.split('/').pop() + '…');
  const buf = await gh.readBinary(r.latestDraft.path);
  let d = currentDraft() || newDraft(c);
  S.drafts.set(c.id, d);
  try {
    const meta = JSON.parse(await gh.readText(`audiobook/drafts/${c.id}/draft.json`));
    if (meta.mix) d.mix = { ...defaultMix(), ...meta.mix, bgm: null, sfx: [] };
  } catch (_) { /* no settings file — fine */ }
  d.version = r.latestDraft.v;
  await db.putDraft(d);
  S.project = await Project.open(d);
  const { srcId, length } = await S.project.addFileSource(new Blob([buf], { type: 'audio/mpeg' }), r.latestDraft.path.split('/').pop());
  S.project.segments = [{ src: srcId, start: 0, end: length }];
  S.project.changed();
  d.status = 'draft'; await S.project.save();
  busy(false); loadMixUi(d); setStatusChip(); refreshWave(0);
}

// ---------------------------------------------------------------- track 2 (BGM / SFX)
LIBRARY.forEach((l) => {
  if (l.kind !== 'sfx') $('#bgmSelect').insertAdjacentHTML('beforeend', `<option value="lib:${l.id}">${esc(l.name)}</option>`);
  $('#sfxSelect').insertAdjacentHTML('beforeend', `<option value="lib:${l.id}">${esc(l.name)}</option>`);
});

async function audioFor(ref) {
  if (!ref) return null;
  if (S.audioCache.has(ref)) return S.audioCache.get(ref);
  let p;
  if (ref.startsWith('lib:')) { const l = LIBRARY.find((x) => 'lib:' + x.id === ref); p = l ? l.make() : Promise.resolve(null); }
  else p = db.getBlob(ref).then((b) => (b ? decodeToMono(b) : null));
  S.audioCache.set(ref, p);
  return p;
}
function refName(ref) { const l = LIBRARY.find((x) => 'lib:' + x.id === ref); return l ? l.name : ''; }

function loadMixUi(d) {
  const m = (d && d.mix) || defaultMix();
  $('#optNormalize').checked = m.normalize; $('#optTarget').value = String(m.target); $('#optDenoise').checked = m.denoise;
  const bgm = m.bgm;
  if (bgm && bgm.ref && !bgm.ref.startsWith('lib:') && !$(`#bgmSelect option[value="${bgm.ref}"]`)) {
    $('#bgmSelect').insertAdjacentHTML('beforeend', `<option value="${esc(bgm.ref)}">${esc(bgm.name || 'Uploaded music')}</option>`);
  }
  $('#bgmSelect').value = bgm ? bgm.ref : '';
  $('#bgmVol').value = bgm ? bgm.volume : 8; $('#bgmVolOut').textContent = $('#bgmVol').value + '%';
  $('#bgmDuck').checked = bgm ? bgm.duck !== false : true;
  $('#bgmName').textContent = '';
  renderSfx(); drawLane();
}

function mixOf() { const d = currentDraft(); if (!d) return null; d.mix = d.mix || defaultMix(); return d.mix; }
function saveMix() { const d = currentDraft(); if (d) { db.putDraft(d); drawLane(); } }

['optNormalize', 'optTarget', 'optDenoise'].forEach((id) => ($('#' + id).onchange = () => {
  const m = mixOf(); if (!m) return;
  m.normalize = $('#optNormalize').checked; m.target = Number($('#optTarget').value); m.denoise = $('#optDenoise').checked; saveMix();
}));
function bgmChanged() {
  const m = mixOf(); if (!m) return;
  const ref = $('#bgmSelect').value;
  m.bgm = ref ? { ref, name: $('#bgmSelect').selectedOptions[0].textContent, volume: Number($('#bgmVol').value), duck: $('#bgmDuck').checked } : null;
  $('#bgmVolOut').textContent = $('#bgmVol').value + '%';
  saveMix();
}
$('#bgmSelect').onchange = bgmChanged; $('#bgmVol').oninput = bgmChanged; $('#bgmDuck').onchange = bgmChanged;
$('#bgmUpload').onclick = () => { if (!currentDraft()) return toast('Record or open a chapter draft first.'); $('#bgmFile').click(); };
$('#bgmFile').onchange = () => guard(async () => {
  const f = $('#bgmFile').files[0]; $('#bgmFile').value = ''; if (!f) return;
  const key = await db.putBlob(f, f.name);
  $('#bgmSelect').insertAdjacentHTML('beforeend', `<option value="${key}">${esc(f.name)}</option>`);
  $('#bgmSelect').value = key; bgmChanged();
}, 'Upload');

function renderSfx() {
  const m = mixOf(), ul = $('#sfxList');
  const list = m ? m.sfx : [];
  ul.innerHTML = list.map((s, i) => `<li><span title="${esc(s.name)}">${esc(s.name)}</span>
    <input type="text" value="${formatTime(s.time, true)}" data-t="${i}" title="Time">
    <input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" data-v="${i}" title="Volume">
    <button class="btn icon danger" data-x="${i}" title="Remove">✕</button></li>`).join('');
  ul.querySelectorAll('[data-t]').forEach((el) => (el.onchange = () => { const t = parseTime(el.value); if (isFinite(t)) { list[el.dataset.t].time = t; saveMix(); } }));
  ul.querySelectorAll('[data-v]').forEach((el) => (el.oninput = () => { list[el.dataset.v].volume = el.value / 100; saveMix(); }));
  ul.querySelectorAll('[data-x]').forEach((el) => (el.onclick = () => { list.splice(el.dataset.x, 1); saveMix(); renderSfx(); }));
}
function addSfx(ref, name, time) {
  const m = mixOf(); if (!m) return toast('Record or open a chapter draft first.');
  if (!isFinite(time) || time < 0) return toast('Time must look like 2:15', true);
  m.sfx.push({ ref, name, time, volume: 0.6 }); m.sfx.sort((a, b) => a.time - b.time);
  saveMix(); renderSfx();
}
$('#sfxAdd').onclick = () => addSfx($('#sfxSelect').value, $('#sfxSelect').selectedOptions[0].textContent, parseTime($('#sfxTime').value));
$('#sfxAddCursor').onclick = () => addSfx($('#sfxSelect').value, $('#sfxSelect').selectedOptions[0].textContent, cursor());
$('#sfxUpload').onclick = () => { if (!currentDraft()) return toast('Record or open a chapter draft first.'); $('#sfxFile').click(); };
$('#sfxFile').onchange = () => guard(async () => {
  const f = $('#sfxFile').files[0]; $('#sfxFile').value = ''; if (!f) return;
  const key = await db.putBlob(f, f.name);
  addSfx(key, f.name, parseTime($('#sfxTime').value) || cursor());
}, 'Upload');

function drawLane() {
  const c = $('#lane2'); if (!c) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const m = mixOf(); const dur = S.project ? S.project.duration : 0;
  g.font = '11px Mukta, sans-serif';
  if (!m || !dur) { g.fillStyle = cssVar('--muted'); g.fillText('Nothing on track 2 yet', 8, h / 2 + 4); return; }
  if (m.bgm) {
    g.fillStyle = cssVar('--blue'); g.globalAlpha = 0.25 + m.bgm.volume / 20 * 0.5;
    g.fillRect(0, 6, w, 14); g.globalAlpha = 1; g.fillStyle = cssVar('--text');
    g.fillText('♪ ' + m.bgm.name + ' · ' + m.bgm.volume + '%' + (m.bgm.duck !== false ? ' · ducking' : ''), 6, 17);
  }
  for (const s of m.sfx) {
    const x = (s.time / dur) * w;
    g.fillStyle = cssVar('--accent'); g.fillRect(x, 24, Math.max(3, w * 0.01), 16);
    g.fillStyle = cssVar('--text'); g.fillText(s.name.replace(/\s*\(.*\)$/, ''), Math.min(x + 6, w - 70), 36);
  }
}
window.addEventListener('resize', drawLane);

// ---------------------------------------------------------------- mix, measure, preview
async function buildMix(withProgress = true) {
  const voice = S.project.render();
  const m = mixOf();
  if (withProgress) busy('Processing voice…', 0.2);
  await nextFrame();
  const pv = processVoice(voice, m);
  if (withProgress) busy('Mixing background…', 0.5);
  const bgm = m.bgm ? { samples: await audioFor(m.bgm.ref), volume: m.bgm.volume / 100, duck: m.bgm.duck !== false } : null;
  const sfx = [];
  for (const s of m.sfx) sfx.push({ samples: await audioFor(s.ref), time: s.time, volume: s.volume });
  const mixed = await renderMix(pv.samples, bgm, sfx);
  return { mixed, voiceLoudness: pv.loudness };
}

$('#btnMeasure').onclick = () => guard(async () => {
  if (!S.project) return toast('Nothing recorded yet.');
  const raw = S.project.render();
  const { mixed } = await buildMix();
  const a = acxCheck(mixed);
  busy(false);
  const row = (k, v, ok) => `<span>${k}</span><b class="${ok == null ? '' : ok ? 'ok-text' : 'bad-text'}">${v}</b>`;
  $('#measureOut').innerHTML =
    row('Raw loudness', integratedLoudness(raw).toFixed(1) + ' LUFS') + row('Raw peak', peakDb(raw).toFixed(1) + ' dB') +
    row('Final loudness', a.lufs.toFixed(1) + ' LUFS') +
    row('Peak (≤ −3)', a.peak.toFixed(1) + ' dB', a.peakOk) + row('RMS (−23…−18)', a.rms.toFixed(1) + ' dB', a.rmsOk) +
    row('Noise floor (≤ −60)', a.floor.toFixed(1) + ' dB', a.floorOk) + row('ACX check', a.pass ? 'PASS' : 'FAIL', a.pass);
}, 'Measure');

$('#btnPreview').onclick = () => guard(async () => {
  if (!S.project) return toast('Nothing recorded yet.');
  const { mixed } = await buildMix(); busy(false);
  const el = $('#previewAudio');
  if (el.src) URL.revokeObjectURL(el.src);
  el.src = URL.createObjectURL(encodeWav(mixed));
  el.currentTime = S.ws ? S.ws.getCurrentTime() : 0;
  el.classList.remove('hidden'); el.play();
}, 'Preview');

// ---------------------------------------------------------------- save draft / GitHub sync
function chapterLabel(c) { return c.number != null ? String(c.number) : c.id; }
function stamp() { const d = new Date(); return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }

async function saveDraft() {
  if (S.recorder && S.recorder.state !== 'idle') {
    await S.recorder.flush();
    toast('Saved on this computer (' + formatTime(S.recorder.time) + '). Stop the recording to upload it.');
    return;
  }
  if (!S.project) { toast('Nothing to save yet.'); return; }
  await S.project.save();
  $('#saveInfo').textContent = 'Saved on this computer at ' + new Date().toLocaleTimeString();
  if ($('#optSync').checked && gh.isConnected()) await syncDraft();
  else toast('Draft saved on this computer.');
}

async function syncDraft() {
  const c = S.current, d = currentDraft();
  if (!S.project || !S.project.duration) return;
  const sig = JSON.stringify([d.segments, d.mix]);
  if (d.syncedSig === sig) { $('#saveInfo').textContent = 'GitHub already has this version (draft v' + d.version + ').'; return; }
  const v = Math.max(d.version || 0, (S.remote[c.id] && S.remote[c.id].latestDraft ? S.remote[c.id].latestDraft.v : 0)) + 1;
  busy('Encoding draft MP3…', 0);
  const mp3 = await encodeMp3(S.project.render(), 128, (f) => busy('Encoding draft MP3…', f * 0.8));
  const base = `audiobook/drafts/${c.id}`;
  const meta = {
    chapter: c.id, title: c.title, number: c.number, version: v, duration: S.project.duration,
    status: d.status, mix: { ...d.mix, bgm: d.mix.bgm && d.mix.bgm.ref.startsWith('lib:') ? d.mix.bgm : null, sfx: d.mix.sfx.filter((s) => s.ref.startsWith('lib:')) },
    savedAt: new Date().toISOString(),
  };
  const res = await gh.commitFiles(
    [{ path: `${base}/draft_v${v}.mp3`, blob: mp3 }, { path: `${base}/draft.json`, text: JSON.stringify(meta, null, 2) + '\n' }],
    `audiobook: draft recording chapter ${chapterLabel(c)} - [${stamp()}]`,
    (t) => busy(t, 0.9));
  busy(false);
  d.version = v; d.syncedSig = sig; d.lastSync = Date.now(); await db.putDraft(d);
  S.remote[c.id] = { ...(S.remote[c.id] || {}), latestDraft: { path: `${base}/draft_v${v}.mp3`, v } };
  $('#saveInfo').innerHTML = `Draft v${v} saved to GitHub · <a href="${res.url}" target="_blank" rel="noopener">commit</a>`;
  toast('Draft v' + v + ' saved to GitHub.');
}
$('#btnSave').onclick = () => guard(saveDraft, 'Save');

// ---------------------------------------------------------------- final export
$('#coverBtn').onclick = () => $('#coverFile').click();
$('#coverFile').onchange = () => { const f = $('#coverFile').files[0]; if (f) { S.coverBlob = f; $('#coverName').textContent = f.name; } };

function setProgress(frac, text) {
  $('#expProgress').classList.remove('hidden');
  $('#expProgress i').style.width = Math.round(frac * 100) + '%';
  if (text) $('#expStep').textContent = text;
}

async function makeReady() {
  const c = S.current, d = currentDraft();
  if (!S.project || !S.project.duration) return toast('Record this chapter first.');
  if (S.recorder && S.recorder.state !== 'idle') return toast('Stop the recording first.');
  const items = [];
  const li = (ok, text) => items.push(`<li>${ok === true ? '✅' : ok === false ? '❌' : '⏳'} ${text}</li>`);

  setProgress(0.05, 'Processing voice and mixing…');
  const { mixed } = await buildMix(false);
  busy(false);
  setProgress(0.3, 'Running ACX loudness check…');
  await nextFrame();
  const acx = acxCheck(mixed);
  setProgress(0.35, 'Encoding MP3 192 kbps, 44.1 kHz, mono…');
  const mp3 = await encodeMp3(mixed, 192, (f) => setProgress(0.35 + f * 0.45));
  setProgress(0.82, 'Writing ID3 tags…');
  const cover = await loadCover(S.coverBlob || (c.cover ? c.cover.replace(/^\//, '') : 'assets/img/apple-touch-icon.png'));
  const tagged = await tagMp3(mp3, {
    title: (c.number != null ? 'Chapter ' + c.number + ': ' : '') + c.title,
    artist: c.author, narrator: c.narrator, album: c.book, track: c.number ?? '', year: new Date().getFullYear(),
    language: c.language, comment: $('#expDesc').value.trim(), cover,
  });
  const path = `audiobook/final/${c.id}.mp3`;
  let committed = null;
  if (gh.isConnected()) {
    setProgress(0.88, 'Saving to GitHub…');
    const meta = {
      chapter: c.id, title: c.title, title_hi: c.titleHi, book: c.book, author: c.author, narrator: c.narrator,
      number: c.number, description: $('#expDesc').value.trim(), duration: +(mixed.length / SR).toFixed(2),
      format: 'MP3 192 kbps CBR, 44.1 kHz, mono', loudness_lufs: +acx.lufs.toFixed(1),
      acx: { peak: +acx.peak.toFixed(1), rms: +acx.rms.toFixed(1), noise_floor: +acx.floor.toFixed(1), pass: acx.pass },
      created: new Date().toISOString(),
    };
    committed = await gh.commitFiles(
      [{ path, blob: tagged }, { path: `audiobook/final/${c.id}.json`, text: JSON.stringify(meta, null, 2) + '\n' }],
      `audiobook: final chapter ${chapterLabel(c)} ready`, (t) => setProgress(0.92, t));
    S.remote[c.id] = { ...(S.remote[c.id] || {}), final: { path } };
  }
  d.status = 'ready'; d.finalAt = Date.now(); await db.putDraft(d);
  setStatusChip();
  setProgress(1, 'Done.');

  const mb = (tagged.size / 1048576).toFixed(1);
  li(!!c.title, 'Title: <b>' + esc(c.title) + '</b>');
  li($('#expDesc').value.trim().length > 0 ? true : false, 'Description' + ($('#expDesc').value.trim() ? '' : ' — add one above'));
  li(true, `File ready: ${esc(c.id)}.mp3 · ${formatTime(mixed.length / SR)} · ${mb} MB`);
  li(acx.peakOk, 'Peak ' + acx.peak.toFixed(1) + ' dB (ACX ≤ −3)');
  li(acx.rmsOk, 'RMS ' + acx.rms.toFixed(1) + ' dB (ACX −23 to −18)' + (acx.rmsOk ? '' : ' — for Audible choose “−20 LUFS (ACX safe)”'));
  li(acx.floorOk, 'Noise floor ' + acx.floor.toFixed(1) + ' dB (ACX ≤ −60)' + (acx.floorOk ? '' : ' — try Noise reduction'));
  li(!!cover, 'Cover image embedded');
  if (committed) li(true, `Saved to GitHub: <a href="${gh.fileUrl(path)}" target="_blank" rel="noopener">${path}</a> (on the website in ~1 min: <a href="${gh.siteUrl(path)}" target="_blank" rel="noopener">link</a>)`);
  else li(false, 'Not saved to GitHub — connect GitHub (top right) and run again');
  $('#checklist').innerHTML = items.join('') +
    `<li style="margin-top:8px"><button class="btn" id="dlFinal">⤓ Download MP3</button> <button class="btn" id="upApi">⇪ Send to my upload API</button></li>`;
  $('#dlFinal').onclick = () => download(tagged, `${c.id}.mp3`);
  $('#upApi').onclick = () => guard(() => sendToApi(tagged, c), 'Upload API');
}
$('#btnFinal').onclick = () => guard(makeReady, 'Export');

async function sendToApi(blob, c) {
  let url = '';
  try { url = localStorage.getItem('zws.studio.uploadApi') || ''; } catch (_) {}
  if (!url) { toast('Add your upload API URL in GitHub settings (top right).'); return; }
  const fd = new FormData();
  fd.append('file', blob, c.id + '.mp3'); fd.append('title', c.title); fd.append('description', $('#expDesc').value.trim()); fd.append('chapter', c.id);
  busy('Sending to your upload API…');
  const res = await fetch(url, { method: 'POST', body: fd });
  busy(false);
  if (!res.ok) throw new Error('Server answered ' + res.status);
  toast('Uploaded to your API.');
}


// ---------------------------------------------------------------- YouTube
const YT = { photo: null, photoName: '', playlists: [], video: null, thumb: null, ext: 'mp4' };
const DEFAULT_YT_PHOTO = 'assets/img/hero/sachin-books-v2.webp';
function googleClientId() { try { return localStorage.getItem('zws.studio.googleClientId') || ''; } catch (_) { return ''; } }

async function loadPlaylists() {
  if (YT.playlists.length) return YT.playlists;
  try {
    const j = await (await fetch('content/youtube.json', { cache: 'no-store' })).json();
    YT.playlists = (j.playlists || []).map((p) => ({ ...p, id: (/[?&]list=([^&]+)/.exec(p.link) || [])[1] || '' }));
  } catch (_) { YT.playlists = []; }
  return YT.playlists;
}

function ytFillText() {
  const c = S.current;
  const pl = YT.playlists.find((p) => p.id === $('#ytPlaylist').value) || null;
  const tx = yt.youtubeText(c, pl, $('#expDesc').value.trim());
  $('#ytTitle').value = tx.title; $('#ytDesc').value = tx.description; $('#ytTags').value = tx.tags.join(', ');
  $('#ytTitleCount').textContent = '(' + tx.title.length + '/100)';
}
function ytText() {
  return { title: $('#ytTitle').value.trim().slice(0, 100), description: $('#ytDesc').value.trim().slice(0, 4900),
    tags: $('#ytTags').value.split(',').map((s) => s.trim()).filter(Boolean) };
}
function ytInfo() {
  const c = S.current, hindi = c.language !== 'english';
  return { displayTitle: (hindi && c.titleHi) ? c.titleHi : c.title, number: c.number, book: c.book, narrator: c.narrator, language: c.language };
}
async function ytPreviewThumb() {
  const img = await yt.loadImage(YT.photo || DEFAULT_YT_PHOTO);
  YT.thumb = await yt.makeThumbnail(img, ytInfo());
  const el = $('#ytThumbPreview'); if (el.src) URL.revokeObjectURL(el.src);
  el.src = URL.createObjectURL(YT.thumb);
}

$('#btnYT').onclick = () => guard(async () => {
  if (!S.current) return toast('Pick a chapter first.');
  if (!S.project || !S.project.duration) return toast('Record this chapter first.');
  const pls = await loadPlaylists();
  const sel = $('#ytPlaylist');
  sel.innerHTML = '<option value="">— no playlist —</option>' + pls.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} / ${esc(p.title_hi || '')}</option>`).join('');
  const d = currentDraft();
  const want = (d && d.youtube && d.youtube.playlist) || (pls.find((p) => p.category === S.current.category) || {}).id || '';
  sel.value = want;
  YT.video = null; $('#ytFiles').classList.add('hidden'); $('#ytProgress').classList.add('hidden'); $('#ytStep').textContent = '';
  ytFillText();
  const cid = googleClientId();
  $('#ytUpload').disabled = true;
  $('#ytDirectInfo').innerHTML = cid ? 'Make the video first, then upload.' : 'For one-click upload, add your Google Client ID in Settings (GitHub button, top right). Steps are in the <a href="studio-guide.html#youtube" target="_blank">guide</a>.';
  if (cid) yt.loadGoogle().catch(() => {});
  if (d && d.youtube && d.youtube.url) $('#ytDirectInfo').innerHTML += `<br>Last upload: <a href="${esc(d.youtube.url)}" target="_blank" rel="noopener">${esc(d.youtube.url)}</a>`;
  $('#dlgYT').showModal();
  await ytPreviewThumb();
  if (!yt.videoSupport()) $('#ytStep').textContent = 'This browser cannot make videos — please use Google Chrome or Microsoft Edge.';
}, 'YouTube');

$('#ytPlaylist').onchange = () => { ytFillText(); const d = currentDraft(); if (d) { d.youtube = { ...(d.youtube || {}), playlist: $('#ytPlaylist').value }; db.putDraft(d); } };
$('#ytTitle').oninput = () => ($('#ytTitleCount').textContent = '(' + $('#ytTitle').value.length + '/100)');
$('#ytPhotoBtn').onclick = () => $('#ytPhotoFile').click();
$('#ytPhotoFile').onchange = () => guard(async () => {
  const f = $('#ytPhotoFile').files[0]; $('#ytPhotoFile').value = ''; if (!f) return;
  YT.photo = f; $('#ytPhotoName').textContent = f.name; YT.video = null; $('#ytFiles').classList.add('hidden');
  await ytPreviewThumb();
}, 'Photo');
async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast(what + ' copied.'); } catch (_) { toast('Could not copy — select and copy by hand.', true); } }
$('#ytCopyTitle').onclick = () => copy($('#ytTitle').value, 'Title');
$('#ytCopyDesc').onclick = () => copy($('#ytDesc').value, 'Description');
$('#ytCopyTags').onclick = () => copy($('#ytTags').value, 'Tags');

function ytProgress(frac, text) {
  $('#ytProgress').classList.remove('hidden'); $('#ytProgress i').style.width = Math.round(frac * 100) + '%';
  if (text) $('#ytStep').textContent = text;
}

$('#ytMake').onclick = () => guard(async () => {
  if (!yt.videoSupport()) return toast('Please use Google Chrome or Microsoft Edge to make the video.', true);
  $('#ytMake').disabled = true;
  try {
    ytProgress(0.02, 'Mixing the final audio…');
    const { mixed } = await buildMix(false); busy(false);
    const img = await yt.loadImage(YT.photo || DEFAULT_YT_PHOTO);
    if (!YT.thumb) await ytPreviewThumb();
    const t0 = performance.now();
    const res = await yt.makeVideo(mixed, img, ytInfo(), (f) => {
      const el = (performance.now() - t0) / 1000, left = f > 0.03 ? el / f - el : 0;
      ytProgress(0.05 + f * 0.95, 'Making video… ' + Math.round(f * 100) + '%' + (left > 3 ? ' · about ' + formatTime(left) + ' left' : ''));
    });
    YT.video = res.blob; YT.ext = res.ext;
    ytProgress(1, `Ready: ${formatTime(mixed.length / SR)} video, ${(res.blob.size / 1048576).toFixed(1)} MB (${res.ext.toUpperCase()}).`);
    $('#ytFiles').classList.remove('hidden');
    if (googleClientId()) { $('#ytUpload').disabled = false; $('#ytDirectInfo').textContent = 'Ready to upload. You will be asked to sign in with Google the first time.'; }
    const d = currentDraft(); if (d) { d.youtube = { ...(d.youtube || {}), madeAt: Date.now(), playlist: $('#ytPlaylist').value }; db.putDraft(d); }
  } finally { $('#ytMake').disabled = false; }
}, 'YouTube video');

$('#ytDlVideo').onclick = () => YT.video && download(YT.video, `${S.current.id}-youtube.${YT.ext}`);
$('#ytDlThumb').onclick = () => YT.thumb && download(YT.thumb, `${S.current.id}-thumbnail.jpg`);

$('#ytUpload').onclick = () => {
  const cid = googleClientId();
  if (!cid) return toast('Add your Google Client ID in Settings first.', true);
  if (!YT.video) return toast('Make the video first.', true);
  // the sign-in popup must open straight from this click
  const tokenP = yt.googleToken(cid);
  guard(async () => {
    $('#ytUpload').disabled = true;
    try {
      const token = await tokenP;
      const c = S.current;
      const res = await yt.uploadToYouTube({
        token, video: YT.video, thumbnail: YT.thumb, text: ytText(), playlistId: $('#ytPlaylist').value,
        privacy: $('#ytPrivacy').value, language: c.language === 'english' ? 'en' : 'hi',
        onProgress: (f, s) => ytProgress(f, s + ' ' + Math.round(f * 100) + '%'),
      });
      const d = currentDraft(); if (d) { d.youtube = { ...(d.youtube || {}), id: res.id, url: res.url, uploadedAt: Date.now() }; db.putDraft(d); }
      let html = `✅ Uploaded: <a href="${res.url}" target="_blank" rel="noopener">${res.url}</a> · <a href="https://studio.youtube.com/video/${res.id}/edit" target="_blank" rel="noopener">edit in YouTube Studio</a>`;
      if (res.privacy && res.privacy !== $('#ytPrivacy').value) html += `<br>⚠️ YouTube kept it <b>${esc(res.privacy)}</b> (new Google apps upload as private until Google reviews them). Open YouTube Studio → Visibility → Public.`;
      res.notes.forEach((n) => (html += '<br>⚠️ ' + esc(n)));
      $('#ytDirectInfo').innerHTML = html;
      $('#ytCardInfo').innerHTML = `Last upload: <a href="${res.url}" target="_blank" rel="noopener">${res.url}</a>`;
      toast('Uploaded to YouTube.');
    } finally { $('#ytUpload').disabled = false; }
  }, 'YouTube upload');
};

// ---------------------------------------------------------------- dashboard
$('#btnDashboard').onclick = () => guard(openDashboard, 'Dashboard');
async function openDashboard() {
  for (const d of await db.allDrafts()) S.drafts.set(d.chapterId, d);
  const ids = new Set([...S.chapters.map((c) => c.id), ...S.drafts.keys()]);
  const rows = [...ids].map((id) => {
    const c = S.chapters.find((x) => x.id === id), d = S.drafts.get(id), st = chapterStatus(id);
    if (!d && !st) return '';
    const name = c ? (c.number != null ? c.number + '. ' : '') + c.title : (d && d.title) || id;
    return `<tr><td>${esc(name)}</td>
      <td><span class="dot ${STATUS[st] ? STATUS[st][1] : ''}"></span> ${STATUS[st] ? STATUS[st][0] : '—'}${d ? '' : ' <span class="muted small">(GitHub)</span>'}</td>
      <td>${d && d.duration ? formatTime(d.duration) : d && d.recordedSeconds ? formatTime(d.recordedSeconds) : '—'}</td>
      <td>${d ? new Date(d.updatedAt).toLocaleString() : '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn" data-a="play" data-id="${esc(id)}">▶ Play</button>
        <button class="btn" data-a="edit" data-id="${esc(id)}">Edit</button>
        <button class="btn" data-a="rerec" data-id="${esc(id)}">Re-record</button>
        <button class="btn primary" data-a="final" data-id="${esc(id)}">Move to Final</button></td></tr>`;
  }).join('');
  $('#dashBody').innerHTML = rows || '<tr><td colspan="5" class="muted">No drafts yet. Pick a chapter and press Record.</td></tr>';
  const est = await db.estimate();
  $('#dashStorage').textContent = est ? `Drafts use ${(est.usage / 1048576).toFixed(0)} MB of ${(est.quota / 1048576).toFixed(0)} MB browser storage on this computer.` : '';
  $('#dashBody').querySelectorAll('button[data-a]').forEach((b) => (b.onclick = () => guard(() => dashAction(b.dataset.a, b.dataset.id), 'Dashboard')));
  if (!$('#dlgDash').open) $('#dlgDash').showModal();
}

async function dashAction(a, id) {
  if (a === 'rerec') {
    if (!confirm('Start this chapter again from zero? The current local draft will be deleted (versions already on GitHub stay there).')) return;
    await db.deleteDraft(id); S.drafts.delete(id);
    if (S.current && S.current.id === id) { S.project = null; S.current = null; }
    $('#dlgDash').close(); await selectChapter(id); showTab('record'); return;
  }
  $('#dlgDash').close();
  await selectChapter(id);
  if (a === 'edit') { showTab('edit'); return; }
  if (!S.project) { toast('This chapter has no local audio yet. Use “Load draft from GitHub” in the Edit tab.'); showTab('edit'); return; }
  if (a === 'play') { showTab('edit'); setTimeout(() => S.ws && S.ws.play(), 300); }
  if (a === 'final') await makeReady();
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guard(saveDraft, 'Save'); return; }
  if (typing || document.querySelector('dialog[open]')) return;
  const recActive = S.recorder && S.recorder.state !== 'idle';
  if (e.code === 'Space') {
    if (recActive) { e.preventDefault(); S.recorder.toggle(); }
    else if (S.tab === 'edit' && S.ws) { e.preventDefault(); S.ws.playPause(); }
    return;
  }
  if (e.key.toLowerCase() === 'm' && recActive) { S.recorder.mark(); return; }
  if (S.tab !== 'edit' || !S.project) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('#edRedo') : $('#edUndo')).click(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('#edRedo').click(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (S.selection) { e.preventDefault(); $('#edDelete').click(); } }
});

window.addEventListener('beforeunload', (e) => {
  if ((S.recorder && S.recorder.state !== 'idle') || S.patch) {
    try { (S.recorder || S.patch.rec).rec.requestData(); } catch (_) {}
    e.preventDefault(); e.returnValue = '';
  }
});

// ---------------------------------------------------------------- start
(async function init() {
  if (!window.isSecureContext || !navigator.mediaDevices) toast('Recording needs a secure (https) page.', true, 8000);
  refreshGhPill();
  await loadChapters();
  // any interrupted recording? offer to resume it right away
  if (!S.current) {
    const waiting = [...S.drafts.values()].find((d) => (d.status === 'paused' || d.status === 'recording') && unprocessedSessions(d).length);
    if (waiting && S.chapters.some((c) => c.id === waiting.chapterId)) selectChapter(waiting.chapterId);
  }
})();
