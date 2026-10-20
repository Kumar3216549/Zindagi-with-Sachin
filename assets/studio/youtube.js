// YouTube helpers for the Audiobook Studio:
//  1. makeVideo()     — cover photo + chapter title + animated sound bars → MP4 (or WebM)
//  2. makeThumbnail() — 1280×720 JPEG thumbnail
//  3. youtubeText()   — ready title, description and tags
//  4. uploadToYouTube() — optional direct upload with the owner's Google sign-in
// Everything is rendered in the browser with WebCodecs (Chrome / Edge).

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from './vendor/mp4-muxer.mjs';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from './vendor/webm-muxer.mjs';
import { SR } from './audio-utils.js';

const VW = 1280, VH = 720, FPS = 10;
export const SITE = 'https://zindagi-with-sachin.vercel.app';

// ---------------------------------------------------------------- images & fonts

export async function loadImage(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src, { cache: 'force-cache' })).blob();
  return createImageBitmap(blob);
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('800 64px Mukta'), document.fonts.load('600 30px Mukta'), document.fonts.load('700 28px Mukta'),
    ]);
  } catch (_) { /* system fonts are fine */ }
}
const FONT = "Mukta, 'Nirmala UI', Mangal, 'Noto Sans Devanagari', sans-serif";

function cover(g, img, x, y, w, h, focusY = 0.35) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) * focusY, dw, dh);
}
function contain(img, maxW, maxH) {
  const s = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * s, h: img.height * s };
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// word wrap that also works for Hindi (splits on spaces)
function wrap(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/); const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}

// Shared layout: blurred photo background + sharp photo card on the left + text on the right.
function drawBase(g, img, info, { thumb = false } = {}) {
  g.save();
  g.filter = 'blur(22px) brightness(0.45) saturate(1.1)';
  cover(g, img, -40, -40, VW + 80, VH + 80);
  g.restore();
  const grad = g.createLinearGradient(0, 0, VW, VH);
  grad.addColorStop(0, 'rgba(13,23,48,.75)'); grad.addColorStop(0.6, 'rgba(42,27,61,.55)'); grad.addColorStop(1, 'rgba(75,42,31,.65)');
  g.fillStyle = grad; g.fillRect(0, 0, VW, VH);

  // photo card
  const box = thumb ? { x: 40, y: 40, w: 520, h: 640 } : { x: 70, y: 90, w: 430, h: 540 };
  const { w, h } = contain(img, box.w, box.h);
  const px = box.x + (box.w - w) / 2, py = box.y + (box.h - h) / 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 40; g.shadowOffsetY = 16;
  roundRect(g, px, py, w, h, 22); g.fillStyle = '#000'; g.fill();
  g.restore();
  g.save(); roundRect(g, px, py, w, h, 22); g.clip(); g.drawImage(img, px, py, w, h); g.restore();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,210,122,.85)'; roundRect(g, px, py, w, h, 22); g.stroke();

  // text block
  const tx = thumb ? 600 : 560, tw = VW - tx - 60;
  g.textBaseline = 'alphabetic';
  // badge
  g.font = `700 ${thumb ? 34 : 26}px ${FONT}`;
  const badge = '🎧 ' + (info.language === 'english' ? 'AUDIOBOOK' : 'ऑडियोबुक') + (info.number != null ? (info.language === 'english' ? ' · CHAPTER ' : ' · अध्याय ') + info.number : '');
  const bw = g.measureText(badge).width + 40, bh = thumb ? 56 : 46, by = thumb ? 90 : 120;
  g.fillStyle = '#f5a524'; roundRect(g, tx, by, bw, bh, bh / 2); g.fill();
  g.fillStyle = '#1a1203'; g.fillText(badge, tx + 20, by + bh * 0.7);
  // title
  const size = thumb ? (String(info.displayTitle).length < 22 ? 96 : 78) : 58;
  g.font = `800 ${size}px ${FONT}`;
  const lines = wrap(g, info.displayTitle, tw, thumb ? 4 : 3);
  let y = by + bh + (thumb ? 90 : 78);
  for (const l of lines) {
    if (thumb) { g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineJoin = 'round'; g.strokeText(l, tx, y); }
    g.fillStyle = '#ffffff'; g.fillText(l, tx, y); y += size * 1.22;
  }
  // book / author
  g.font = `600 ${thumb ? 32 : 26}px ${FONT}`;
  g.fillStyle = '#ffd27a';
  const hindi = info.language !== 'english';
  const sameBook = /^zindagi with sachin$/i.test((info.book || '').trim());
  const who = (hindi ? 'आवाज़: ' : 'Voice: ') + info.narrator;
  g.fillText(wrap(g, sameBook ? who : info.book + ' · ' + who, tw, 1)[0], tx, y + (thumb ? 10 : 4));
  if (thumb) {
    // static sound bars + tagline make the thumbnail read as "audio"
    const NB = 26, bw = Math.min(tw, 560) / NB, by2 = y + 110;
    for (let i = 0; i < NB; i++) {
      const h = 18 + 70 * Math.abs(Math.sin(i * 0.9)) * (0.5 + 0.5 * Math.sin((i / NB) * Math.PI));
      const grd = g.createLinearGradient(0, by2 + h / 2, 0, by2 - h / 2);
      grd.addColorStop(0, '#f58a24'); grd.addColorStop(1, '#ffd76a'); g.fillStyle = grd;
      roundRect(g, tx + i * bw + bw * 0.2, by2 - h / 2, bw * 0.6, h, Math.min(bw * 0.3, h / 2)); g.fill();
    }
    g.font = `700 34px ${FONT}`; g.fillStyle = '#ffffff';
    g.fillText(hindi ? 'सुनिए · सीखिए · आगे बढ़िए' : 'Listen · Learn · Grow', tx, by2 + 100);
  }
  // brand
  g.font = `700 ${thumb ? 30 : 24}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillText('✦ Zindagi with Sachin', tx, VH - (thumb ? 60 : 50));
  return { tx, tw, textBottom: y };
}

// ---------------------------------------------------------------- thumbnail

export async function makeThumbnail(img, info) {
  await fontsReady();
  const c = document.createElement('canvas'); c.width = VW; c.height = VH;
  const g = c.getContext('2d');
  drawBase(g, img, info, { thumb: true });
  let q = 0.9, blob;
  do { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.1; } while (blob.size > 1.9 * 1024 * 1024 && q > 0.4);
  return blob;
}

// ---------------------------------------------------------------- video

export function videoSupport() { return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined'; }

async function pickFormat() {
  const vAvc = { codec: 'avc1.640028', width: VW, height: VH, bitrate: 600_000, framerate: FPS, avc: { format: 'avc' } };
  const aAac = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 1, bitrate: 160_000 };
  try {
    if ((await VideoEncoder.isConfigSupported(vAvc)).supported && (await AudioEncoder.isConfigSupported(aAac)).supported) {
      return { kind: 'mp4', video: vAvc, audio: aAac, mime: 'video/mp4', ext: 'mp4' };
    }
  } catch (_) {}
  for (const codec of ['vp09.00.10.08', 'vp8']) {
    const v = { codec, width: VW, height: VH, bitrate: 600_000, framerate: FPS };
    const a = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 128_000 };
    try {
      if ((await VideoEncoder.isConfigSupported(v)).supported && (await AudioEncoder.isConfigSupported(a)).supported) {
        return { kind: 'webm', video: v, audio: a, mime: 'video/webm', ext: 'webm' };
      }
    } catch (_) {}
  }
  throw new Error('This browser cannot make videos. Please use Google Chrome or Microsoft Edge on a computer.');
}

async function resample(samples, rate) {
  if (rate === SR) return samples;
  const off = new OfflineAudioContext(1, Math.ceil(samples.length * rate / SR), rate);
  const b = off.createBuffer(1, samples.length, SR); b.copyToChannel(samples, 0);
  const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start();
  return (await off.startRendering()).getChannelData(0);
}

const fmt = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

// samples: final mixed mono Float32Array at 44.1 kHz
export async function makeVideo(samples, img, info, onProgress = () => {}) {
  await fontsReady();
  const format = await pickFormat();
  const duration = samples.length / SR;
  const frames = Math.max(1, Math.ceil(duration * FPS));

  // static layer, drawn once
  const base = document.createElement('canvas'); base.width = VW; base.height = VH;
  const layout = drawBase(base.getContext('2d'), img, info);
  const c = document.createElement('canvas'); c.width = VW; c.height = VH;
  const g = c.getContext('2d');

  // loudness per frame for the bars
  const hop = SR / FPS, env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0; const a = Math.floor(f * hop), b = Math.min(samples.length, Math.floor((f + 1) * hop));
    for (let i = a; i < b; i++) s += samples[i] * samples[i];
    env[f] = Math.min(1, Math.sqrt(s / Math.max(1, b - a)) * 5.5);
  }
  const NB = 34, phase = Array.from({ length: NB }, (_, i) => (i * 2.399) % (Math.PI * 2));
  const barsX = layout.tx, barsW = VW - layout.tx - 60, barsY = Math.min(VH - 170, layout.textBottom + 90);
  let smooth = 0;

  const target = format.kind === 'mp4' ? new Mp4Target() : new WebmTarget();
  const muxer = format.kind === 'mp4'
    ? new Mp4Muxer({ target, video: { codec: 'avc', width: VW, height: VH, frameRate: FPS }, audio: { codec: 'aac', sampleRate: SR, numberOfChannels: 1 }, fastStart: 'in-memory' })
    : new WebmMuxer({ target, video: { codec: format.video.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: VW, height: VH, frameRate: FPS }, audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 1 } });

  let failed = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
  venc.configure(format.video);
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e; } });
  aenc.configure(format.audio);

  // audio is fed in 1-second blocks, interleaved with the video frames
  const aRate = format.audio.sampleRate;
  const aud = await resample(samples, aRate);
  let aPos = 0;
  const feedAudio = (untilSec) => {
    while (aPos < aud.length && aPos / aRate <= untilSec) {
      const part = aud.slice(aPos, Math.min(aud.length, aPos + aRate));
      const ad = new AudioData({ format: 'f32-planar', sampleRate: aRate, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(aPos / aRate * 1e6), data: part });
      aenc.encode(ad); ad.close();
      aPos += aRate;
    }
  };

  for (let f = 0; f < frames; f++) {
    if (failed) throw failed;
    const t = f / FPS;
    smooth += (env[f] - smooth) * 0.5;
    g.drawImage(base, 0, 0);
    // bars
    const bw = barsW / NB;
    for (let i = 0; i < NB; i++) {
      const wobble = 0.55 + 0.45 * Math.sin(t * (3 + (i % 5)) + phase[i]);
      const h = 8 + smooth * 120 * wobble * (0.6 + 0.4 * Math.sin((i / NB) * Math.PI));
      const grd = g.createLinearGradient(0, barsY + h / 2, 0, barsY - h / 2);
      grd.addColorStop(0, '#f58a24'); grd.addColorStop(1, '#ffd76a');
      g.fillStyle = grd;
      roundRect(g, barsX + i * bw + bw * 0.2, barsY - h / 2, bw * 0.6, h, Math.min(bw * 0.3, h / 2)); g.fill();
    }
    // progress bar
    const py = VH - 105, pw = barsW;
    g.fillStyle = 'rgba(255,255,255,.18)'; roundRect(g, barsX, py, pw, 8, 4); g.fill();
    g.fillStyle = '#ffd27a'; roundRect(g, barsX, py, Math.max(8, pw * (t / duration)), 8, 4); g.fill();
    g.font = `600 22px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillText(fmt(t) + ' / ' + fmt(duration), barsX, py - 14);

    feedAudio(t + 1);
    const vf = new VideoFrame(c, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: f % (FPS * 5) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
    if (f % 25 === 0) { onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  feedAudio(Infinity);
  await venc.flush(); await aenc.flush();
  if (failed) throw failed;
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([target.buffer], { type: format.mime }), ext: format.ext };
}

// ---------------------------------------------------------------- text

export function youtubeText(ch, playlist, desc) {
  const hindi = ch.language !== 'english';
  const name = (hindi && ch.titleHi) ? ch.titleHi : ch.title;
  const chap = ch.number != null ? (hindi ? `अध्याय ${ch.number}` : `Chapter ${ch.number}`) : '';
  const book = /^zindagi with sachin$/i.test((ch.book || '').trim()) ? '' : ch.book;
  let title = [name, [book, hindi ? 'ऑडियोबुक' : 'Audiobook', chap].filter(Boolean).join(' '), 'Zindagi with Sachin'].join(' | ');
  if (title.length > 100) title = [name, chap, 'Zindagi with Sachin'].filter(Boolean).join(' | ');
  if (title.length > 100) title = title.slice(0, 99) + '…';
  const tagCat = playlist ? '#' + playlist.title.replace(/[^A-Za-z0-9]/g, '') : '';
  const lines = [
    desc || ch.description || '',
    '',
    hindi ? '🎧 सर्वाधिक महत्वपूर्ण किताबें, मेरी आवाज़ में — जो आपके स्तर को आसमान तक ले जाएँ।' : '🎧 The most important books, in my voice — to lift you higher.',
    '',
    (hindi ? '📚 पूरी ऑडियोबुक और कहानियाँ: ' : '📚 All audiobooks and stories: ') + SITE + '/audiobooks.html',
    playlist ? (hindi ? '▶ इस श्रेणी की प्लेलिस्ट: ' : '▶ Playlist: ') + playlist.link : '',
    (hindi ? '🔔 नए अध्यायों के लिए सब्सक्राइब करें: ' : '🔔 Subscribe for new chapters: ') + 'https://www.youtube.com/@sachinjha8890?sub_confirmation=1',
    '',
    (hindi ? 'आवाज़: ' : 'Narrated by: ') + ch.narrator + (ch.author && ch.author !== ch.narrator ? (hindi ? ' · लेखक: ' : ' · Written by: ') + ch.author : ''),
    '',
    ['#audiobook', hindi ? '#hindiaudiobook' : '', '#ZindagiWithSachin', tagCat].filter(Boolean).join(' '),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === ''));
  const tags = [ch.title, ch.titleHi, ch.book, 'audiobook', hindi ? 'hindi audiobook' : 'english audiobook', 'Zindagi with Sachin', 'Sachin Kumar Jha', playlist && playlist.title, playlist && playlist.title_hi, hindi ? 'ऑडियोबुक' : '']
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  return { title, description: lines.join('\n').trim(), tags };
}

// ---------------------------------------------------------------- direct upload (optional)

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise = null;
export function loadGoogle() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = GIS_SRC; s.async = true;
    s.onload = () => resolve(); s.onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not load. Check your internet.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

let cachedToken = null;
// Must be called directly from a click (the Google popup needs it).
export function googleToken(clientId) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return Promise.resolve(cachedToken.token);
  return new Promise((resolve, reject) => {
    if (!(window.google && window.google.accounts)) { reject(new Error('Google sign-in is still loading. Click again in a moment.')); return; }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
      callback: (r) => {
        if (r.error) { reject(new Error('Google sign-in: ' + r.error)); return; }
        cachedToken = { token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error('Google sign-in was closed' + (e && e.type ? ' (' + e.type + ')' : '') + '.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function gfetch(url, token, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.errors?.[0]?.reason)) || msg; } catch (_) {}
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return res;
}

function putWithProgress(url, token, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.setRequestHeader('Content-Type', blob.type);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error('Upload failed: ' + x.status + ' ' + x.responseText.slice(0, 200))));
    x.onerror = () => reject(new Error('Upload failed — check your internet and try again.'));
    x.send(blob);
  });
}

// returns { id, url, privacy, notes: [] }
export async function uploadToYouTube({ token, video, thumbnail, text, playlistId, privacy = 'public', language = 'hi', onProgress = () => {} }) {
  const meta = {
    snippet: { title: text.title, description: text.description, tags: text.tags, categoryId: '27', defaultLanguage: language, defaultAudioLanguage: language },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, embeddable: true },
  };
  onProgress(0, 'Starting upload…');
  const init = await gfetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(video.size), 'X-Upload-Content-Type': video.type },
    body: JSON.stringify(meta),
  });
  const loc = init.headers.get('Location');
  if (!loc) throw new Error('YouTube did not return an upload address. Try again.');
  const item = await putWithProgress(loc, token, video, (f) => onProgress(f * 0.9, 'Uploading video…'));
  const notes = [];
  if (thumbnail) {
    onProgress(0.93, 'Setting thumbnail…');
    try {
      await gfetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' + item.id, token, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: thumbnail });
    } catch (e) { notes.push('Thumbnail not set (' + e.message + '). Custom thumbnails need a verified YouTube channel: youtube.com/verify'); }
  }
  if (playlistId) {
    onProgress(0.97, 'Adding to playlist…');
    try {
      await gfetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: item.id } } }),
      });
    } catch (e) { notes.push('Not added to the playlist (' + e.message + ').'); }
  }
  onProgress(1, 'Done.');
  return { id: item.id, url: 'https://youtu.be/' + item.id, privacy: item.status && item.status.privacyStatus, notes };
}
