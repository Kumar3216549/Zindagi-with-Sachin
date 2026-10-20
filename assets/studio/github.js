// GitHub connection for the Audiobook Studio.
// Uses a fine-grained personal access token that stays in this browser only
// (localStorage). Only api.github.com is ever contacted with it.

export const REPO = { owner: 'Kumar3216549', repo: 'Zindagi-with-Sachin', branch: 'main' };
const API = 'https://api.github.com';
const TOKEN_KEY = 'zws.studio.githubToken';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t.trim()) : localStorage.removeItem(TOKEN_KEY); } catch (_) {}
}
export const isConnected = () => !!getToken();

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body, accept, auth = true, raw = false } = {}) {
  const headers = { Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = getToken();
  if (auth && token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch (e) {
    throw new GitHubError('Could not reach GitHub. Check your internet connection.', 0);
  }
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j.message) msg = j.message; } catch (_) {}
    if (res.status === 401) msg = 'GitHub token is invalid or expired. Paste a new token in Settings.';
    if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub rate limit reached. Try again in a few minutes.';
    if (res.status === 403 && !/rate limit/i.test(msg)) msg = 'This token cannot write to the repo. Give it "Contents: Read and write" for ' + REPO.repo + '.';
    throw new GitHubError(msg, res.status);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

const R = `/repos/${REPO.owner}/${REPO.repo}`;

// Checks the token and that it can push to the repo.
export async function verify() {
  const [user, repo] = await Promise.all([api('/user'), api(R)]);
  if (!repo.permissions || !repo.permissions.push) {
    throw new GitHubError('Token works, but it has no write access to ' + REPO.repo + '.', 403);
  }
  return { login: user.login, avatar: user.avatar_url };
}

// Whole repo file list in one call (cheap and fast).
export async function listTree() {
  const ref = await api(`${R}/git/ref/heads/${REPO.branch}`, { auth: isConnected() });
  const tree = await api(`${R}/git/trees/${ref.object.sha}?recursive=1`, { auth: isConnected() });
  return tree.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size, sha: t.sha }));
}

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function readText(path) {
  const j = await api(`${R}/contents/${encodePath(path)}?ref=${REPO.branch}`, { auth: isConnected() });
  return b64ToUtf8(j.content || '');
}

export async function readBinary(path) {
  const res = await api(`${R}/contents/${encodePath(path)}?ref=${REPO.branch}`,
    { accept: 'application/vnd.github.raw+json', raw: true, auth: isConnected() });
  return res.arrayBuffer();
}

function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Commit several files at once (text or binary) on top of the latest main.
// files: [{ path, blob } | { path, text }]. Retries if main moved meanwhile.
export async function commitFiles(files, message, onProgress = () => {}) {
  if (!isConnected()) throw new GitHubError('Connect GitHub first (Settings).', 401);
  for (const f of files) {
    const size = f.blob ? f.blob.size : new Blob([f.text]).size;
    if (size > 95 * 1024 * 1024) throw new GitHubError(f.path + ' is larger than GitHub allows (100 MB). Split the chapter.', 413);
  }
  const blobs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(`Uploading ${f.path.split('/').pop()} (${i + 1}/${files.length})…`);
    const content = f.blob ? await blobToBase64(f.blob) : f.text;
    const b = await api(`${R}/git/blobs`, { method: 'POST', body: { content, encoding: f.blob ? 'base64' : 'utf-8' } });
    blobs.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    onProgress('Creating commit…');
    const ref = await api(`${R}/git/ref/heads/${REPO.branch}`);
    const head = await api(`${R}/git/commits/${ref.object.sha}`);
    const tree = await api(`${R}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree: blobs } });
    const commit = await api(`${R}/git/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [head.sha] } });
    try {
      await api(`${R}/git/refs/heads/${REPO.branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      onProgress('Saved to GitHub.');
      return { sha: commit.sha, url: `https://github.com/${REPO.owner}/${REPO.repo}/commit/${commit.sha}` };
    } catch (e) {
      if (e.status !== 422 || attempt === 3) throw e; // 422 = main moved; rebuild on the new head
    }
  }
}

export function fileUrl(path) { return `https://github.com/${REPO.owner}/${REPO.repo}/blob/${REPO.branch}/${encodePath(path)}`; }
export function siteUrl(path) { return `https://zindagi-with-sachin.vercel.app/${encodePath(path)}`; }

// ---------- chapters ----------

// Minimal front-matter reader (key: value, quoted strings, numbers).
export function parseChapter(path, text) {
  let meta = {}, body = text;
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (!kv) continue;
      let v = kv[2].trim();
      if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      meta[kv[1]] = v;
    }
  }
  const file = path.split('/').pop().replace(/\.md$/i, '');
  const folder = path.split('/').slice(1, -1).join('/');
  const num = meta.chapter != null ? Number(meta.chapter) : Number((/(\d+)/.exec(file) || [])[1]);
  const id = (folder ? folder.replace(/\//g, '-') + '-' : '') + file;
  return {
    id, path, file, folder,
    number: isFinite(num) ? num : null,
    title: meta.title || file.replace(/[-_]/g, ' '),
    titleHi: meta.title_hi || '',
    book: meta.book || (folder ? folder.replace(/[-_]/g, ' ') : 'Zindagi with Sachin'),
    author: meta.author || 'Sachin Kumar Jha',
    narrator: meta.narrator || meta.author || 'Sachin Kumar Jha',
    language: meta.language || 'hindi',
    cover: meta.cover || '',
    description: meta.description || '',
    body: body.trim(),
  };
}

export async function loadChapters() {
  const tree = await listTree();
  const mdFiles = tree.filter((f) => /^chapters\/.+\.md$/i.test(f.path) && !/\/README\.md$/i.test(f.path) && !/(^|\/)_/.test(f.path));
  const chapters = await Promise.all(mdFiles.map(async (f) => parseChapter(f.path, await readText(f.path))));
  chapters.sort((a, b) => (a.book || '').localeCompare(b.book || '') || (a.number ?? 1e9) - (b.number ?? 1e9) || a.file.localeCompare(b.file));
  const remote = {};
  for (const ch of chapters) {
    const drafts = tree.filter((f) => f.path.startsWith(`audiobook/drafts/${ch.id}/`) && /draft_v(\d+)\.(mp3|webm|wav)$/.test(f.path))
      .map((f) => ({ ...f, v: Number(/draft_v(\d+)/.exec(f.path)[1]) })).sort((a, b) => b.v - a.v);
    const final = tree.find((f) => f.path === `audiobook/final/${ch.id}.mp3`);
    remote[ch.id] = { latestDraft: drafts[0] || null, draftCount: drafts.length, final: final || null };
  }
  return { chapters, remote };
}
