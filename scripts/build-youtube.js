// Refreshes youtube/index.json from the public YouTube feeds (no API key needed).
// Runs on every Vercel build and once a day from GitHub Actions (.github/workflows/youtube-sync.yml).
// Never fails the build: if YouTube can't be reached, the last saved list is kept.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'content', 'youtube.json');
const OUT = path.join(ROOT, 'youtube', 'index.json');

function listId(link) {
  const m = String(link || '').match(/[?&]list=([\w-]+)/);
  return m ? m[1] : (/^[\w-]{10,}$/.test(String(link || '').trim()) ? String(link).trim() : '');
}
function unescapeXml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const g = (re) => { const x = e.match(re); return x ? x[1] : ''; };
    return {
      id: g(/<yt:videoId>([^<]+)/),
      title: unescapeXml(g(/<title>([^<]*)<\/title>/)),
      published: g(/<published>([^<]+)/).slice(0, 10),
      short: /\/shorts\//.test(g(/<link rel="alternate" href="([^"]+)"/))
    };
  }).filter((v) => v.id);
}
async function getFeed(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?' + query, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return parseFeed(await r.text());
  } finally { clearTimeout(timer); }
}

(async () => {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { console.log('youtube: no content/youtube.json, skipping'); return; }
  let old = {};
  try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  const oldLists = {};
  (old.playlists || []).forEach((p) => { oldLists[p.id] = p.videos; });

  const out = {
    channel_url: cfg.channel_url || '', channel_id: cfg.channel_id || '',
    updated: old.updated || '', latest: old.latest || [], playlists: []
  };
  let fresh = false;
  if (cfg.channel_id) {
    try { out.latest = await getFeed('channel_id=' + encodeURIComponent(cfg.channel_id)); fresh = true; }
    catch (e) { console.log('youtube: channel feed failed (' + e.message + '), keeping old list'); }
  }
  for (const p of cfg.playlists || []) {
    const id = listId(p.link);
    if (!id || p.hide) continue;
    let videos = oldLists[id] || null;
    try { videos = await getFeed('playlist_id=' + encodeURIComponent(id)); fresh = true; }
    catch (e) { console.log('youtube: playlist ' + id + ' failed (' + e.message + ')'); }
    out.playlists.push({ id, title: p.title || '', title_hi: p.title_hi || '', category: p.category || '', videos });
  }
  // only change the date (and so only make a new commit) when the videos really changed
  const same = JSON.stringify(Object.assign({}, out, { updated: '' })) === JSON.stringify(Object.assign({}, old, { updated: '' }));
  out.updated = fresh && !same ? new Date().toISOString().slice(0, 10) : (old.updated || '');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log('youtube/index.json: ' + out.playlists.length + ' playlist(s), ' + out.latest.length + ' latest video(s)');
})().catch((e) => { console.log('youtube: skipped (' + e.message + ')'); });
