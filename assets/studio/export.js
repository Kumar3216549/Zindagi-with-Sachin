// MP3 export (LAME, in the browser) + ID3 tags.
// Final files: 192 kbps CBR, 44.1 kHz, mono — the format Audible/ACX and
// Spotify accept for spoken word.

import { ID3Writer } from './vendor/browser-id3-writer.mjs';
import { SR, floatToInt16 } from './audio-utils.js';

let lamePromise = null;
function loadLame() {
  if (window.lamejs) return Promise.resolve(window.lamejs);
  if (lamePromise) return lamePromise;
  lamePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/studio/vendor/lame.min.js';
    s.onload = () => (window.lamejs ? resolve(window.lamejs) : reject(new Error('MP3 encoder failed to load')));
    s.onerror = () => reject(new Error('MP3 encoder could not be loaded. Reload the page.'));
    document.head.appendChild(s);
  });
  return lamePromise;
}

// Encodes in slices and yields to the browser so the page stays responsive.
export async function encodeMp3(samples, kbps = 192, onProgress = () => {}) {
  const lamejs = await loadLame();
  const enc = new lamejs.Mp3Encoder(1, SR, kbps);
  const pcm = floatToInt16(samples);
  const block = 1152, chunks = [];
  const sliceBlocks = 400; // ~10 s of audio per slice
  for (let i = 0; i < pcm.length; i += block * sliceBlocks) {
    const end = Math.min(pcm.length, i + block * sliceBlocks);
    for (let j = i; j < end; j += block) {
      const buf = enc.encodeBuffer(pcm.subarray(j, Math.min(end, j + block)));
      if (buf.length) chunks.push(new Uint8Array(buf));
    }
    onProgress(end / pcm.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  const last = enc.flush();
  if (last.length) chunks.push(new Uint8Array(last));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

// tags: { title, artist, album, track, year, language, comment, cover: ArrayBuffer|null, coverMime }
export async function tagMp3(mp3Blob, tags) {
  const writer = new ID3Writer(await mp3Blob.arrayBuffer());
  if (tags.title) writer.setFrame('TIT2', tags.title);
  if (tags.artist) writer.setFrame('TPE1', [tags.artist]);
  if (tags.narrator) writer.setFrame('TPE2', tags.narrator);
  if (tags.album) writer.setFrame('TALB', tags.album);
  if (tags.track) writer.setFrame('TRCK', String(tags.track));
  if (tags.year) writer.setFrame('TYER', Number(tags.year));
  writer.setFrame('TCON', ['Audiobook']);
  if (tags.language) writer.setFrame('TLAN', tags.language === 'english' ? 'eng' : 'hin');
  if (tags.comment) writer.setFrame('COMM', { description: '', text: tags.comment, language: tags.language === 'english' ? 'eng' : 'hin' });
  if (tags.cover) writer.setFrame('APIC', { type: 3, data: tags.cover, description: 'Cover', useUnicodeEncoding: false });
  writer.addTag();
  return writer.getBlob();
}

// Cover art: uploaded file, chapter cover from the site, or the site icon.
export async function loadCover(fileOrPath) {
  try {
    if (fileOrPath instanceof Blob) return await toJpeg(fileOrPath);
    const res = await fetch(fileOrPath, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await toJpeg(await res.blob());
  } catch (_) { return null; }
}

// ID3 players expect JPEG/PNG; re-encode anything else (webp etc.) as a square JPEG.
async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const size = Math.min(1400, Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, size, size);
  const s = Math.max(size / bmp.width, size / bmp.height);
  g.drawImage(bmp, (size - bmp.width * s) / 2, (size - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return out.arrayBuffer();
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
