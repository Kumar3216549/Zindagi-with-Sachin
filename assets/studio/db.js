// IndexedDB storage for drafts. Recording chunks are written every second,
// so a draft survives a closed tab, a crash or a dead battery.

const DB_NAME = 'zws-audiobook-studio';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'chapterId' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: ['draftId', 'session', 'seq'] });
        s.createIndex('bySession', ['draftId', 'session']);
        s.createIndex('byDraft', 'draftId');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Audiobook Studio tabs and reload.'));
  });
  return dbp;
}

function done(tx) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

// ---------- drafts ----------

export async function getDraft(chapterId) {
  const db = await open();
  return reqP(db.transaction('drafts').objectStore('drafts').get(chapterId));
}

export async function allDrafts() {
  const db = await open();
  return reqP(db.transaction('drafts').objectStore('drafts').getAll());
}

export async function putDraft(draft) {
  const db = await open();
  draft.updatedAt = Date.now();
  const tx = db.transaction('drafts', 'readwrite');
  tx.objectStore('drafts').put(draft);
  await done(tx);
  return draft;
}

export async function deleteDraft(chapterId) {
  const draft = await getDraft(chapterId);
  const db = await open();
  const tx = db.transaction(['drafts', 'chunks', 'blobs'], 'readwrite');
  tx.objectStore('drafts').delete(chapterId);
  const idx = tx.objectStore('chunks').index('byDraft');
  idx.openKeyCursor(IDBKeyRange.only(chapterId)).onsuccess = (e) => {
    const c = e.target.result;
    if (c) { tx.objectStore('chunks').delete(c.primaryKey); c.continue(); }
  };
  if (draft) for (const key of blobKeysOf(draft)) tx.objectStore('blobs').delete(key);
  await done(tx);
}

function blobKeysOf(d) {
  const keys = [];
  Object.values(d.sources || {}).forEach((s) => s.blobKey && keys.push(s.blobKey));
  if (d.bgm && d.bgm.blobKey) keys.push(d.bgm.blobKey);
  (d.sfx || []).forEach((s) => s.blobKey && keys.push(s.blobKey));
  return keys;
}

// ---------- recording chunks ----------

export async function putChunk(draftId, session, seq, blob) {
  const db = await open();
  const tx = db.transaction('chunks', 'readwrite');
  tx.objectStore('chunks').put({ draftId, session, seq, blob });
  await done(tx);
}

export async function sessionBlob(draftId, session, mime) {
  const db = await open();
  const rows = await reqP(db.transaction('chunks').objectStore('chunks').index('bySession')
    .getAll(IDBKeyRange.only([draftId, session])));
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(rows.map((r) => r.blob), { type: mime || (rows[0] && rows[0].blob.type) || 'audio/webm' });
}

export async function deleteSessions(draftId, sessions) {
  const db = await open();
  const tx = db.transaction('chunks', 'readwrite');
  const idx = tx.objectStore('chunks').index('bySession');
  for (const s of sessions) {
    idx.openKeyCursor(IDBKeyRange.only([draftId, s])).onsuccess = (e) => {
      const c = e.target.result;
      if (c) { tx.objectStore('chunks').delete(c.primaryKey); c.continue(); }
    };
  }
  await done(tx);
}

// ---------- blobs (imported files, bgm, sfx) ----------

export async function putBlob(blob, name) {
  const db = await open();
  const key = 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put({ key, blob, name: name || '', type: blob.type });
  await done(tx);
  return key;
}

export async function getBlob(key) {
  const db = await open();
  const row = await reqP(db.transaction('blobs').objectStore('blobs').get(key));
  return row ? row.blob : null;
}

export async function deleteBlob(key) {
  const db = await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete(key);
  await done(tx);
}

export async function estimate() {
  if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
  return null;
}

export async function persist() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch (_) { return false; }
  }
  return false;
}
