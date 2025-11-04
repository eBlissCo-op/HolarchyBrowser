let currentId = null;
const pagesEl = document.getElementById('pages');
const titleEl = document.getElementById('title');
const contentEl = document.getElementById('content');
const newBtn = document.getElementById('newBtn');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');

const syncBtn = document.getElementById('syncBtn');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');
const lastSyncEl = document.getElementById('lastSync');

const OUTBOX_KEY = 'hb_outbox';
const LASTSYNC_KEY = 'hb_lastsync';

function readOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch(e){ return []; }
}
function writeOutbox(arr){ localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr)); }

function addToOutbox(item) {
  const out = readOutbox();
  out.push(item);
  writeOutbox(out);
}

// basic pages loader (hide deleted)
async function loadPages(){
  const res = await fetch('/api/pages');
  const pages = await res.json();
  pagesEl.innerHTML = '';
  pages.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.title || `#${p.id}`;
    li.dataset.id = p.id;
    li.addEventListener('click', () => loadPage(p.id));
    pagesEl.appendChild(li);
  });
}

async function loadPage(id){
  const res = await fetch('/api/pages/' + id);
  if (!res.ok) return;
  const p = await res.json();
  currentId = p.id;
  titleEl.value = p.title;
  contentEl.value = p.content;
}

// when saving, write locally and add to outbox for sync
saveBtn.addEventListener('click', async () => {
  const payload = { title: titleEl.value, content: contentEl.value, updated_at: new Date().toISOString() };
  if (!currentId) {
    const res = await fetch('/api/pages', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const p = await res.json();
    currentId = p.id;
    addToOutbox({ id: p.id, title: p.title, content: p.content, rev: p.rev || 1, deleted: 0, updated_at: p.updated_at || payload.updated_at });
  } else {
    await fetch('/api/pages/' + currentId, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    addToOutbox({ id: currentId, title: payload.title, content: payload.content, rev: null, deleted: 0, updated_at: payload.updated_at });
  }
  await loadPages();
  trySyncOutbox();
});

// delete -> soft delete + outbox
deleteBtn.addEventListener('click', async () => {
  if (!currentId) return;
  if (!confirm('Delete this page?')) return;
  await fetch('/api/pages/' + currentId, { method:'DELETE' });
  addToOutbox({ id: currentId, deleted: 1, updated_at: new Date().toISOString() });
  currentId = null;
  titleEl.value = '';
  contentEl.value = '';
  await loadPages();
  trySyncOutbox();
});

// create new
newBtn.addEventListener('click', async () => {
  const res = await fetch('/api/pages', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: 'New Page', content: '', updated_at: new Date().toISOString() })});
  const p = await res.json();
  await loadPages();
  loadPage(p.id);
  addToOutbox({ id: p.id, title: p.title, content: p.content, rev: p.rev || 1, deleted: 0, updated_at: p.updated_at || new Date().toISOString() });
  trySyncOutbox();
});

// sync logic: push outbox then pull changes since last sync
async function trySyncOutbox(){
  const out = readOutbox();
  if (out.length === 0) return;
  try {
    const res = await fetch('/api/sync/changes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(out) });
    if (!res.ok) throw new Error('push failed');
    writeOutbox([]);
    await pullChanges();
  } catch (err) {
    console.warn('sync push failed', err);
  }
}

async function pullChanges(){
  const lastSync = localStorage.getItem(LASTSYNC_KEY);
  const url = '/api/sync/changes' + (lastSync ? ('?since=' + encodeURIComponent(lastSync)) : '');
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    localStorage.setItem(LASTSYNC_KEY, data.serverTime || new Date().toISOString());
    lastSyncEl.textContent = localStorage.getItem(LASTSYNC_KEY);
    await loadPages();
  } catch (err) {
    console.warn('pull failed', err);
  }
}

// manual sync
syncBtn.addEventListener('click', async () => {
  await trySyncOutbox();
  await pullChanges();
});

// export -> download JSON
exportBtn.addEventListener('click', async () => {
  const res = await fetch('/api/export');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'holarchy-export.json';
  a.click();
  URL.revokeObjectURL(url);
});

// import -> read file and POST to /api/import
importFile.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const txt = await f.text();
  let data;
  try { data = JSON.parse(txt); } catch (err) { alert('invalid json'); return; }
  const rows = Array.isArray(data) ? data : (data.rows || []);
  const res = await fetch('/api/import', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(rows) });
  if (res.ok) {
    await loadPages();
    alert('imported');
  } else {
    alert('import failed');
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.key === 'i') importFile.click();
});

setInterval(() => {
  trySyncOutbox();
  pullChanges();
}, 10000);

loadPages();
lastSyncEl.textContent = localStorage.getItem(LASTSYNC_KEY) || 'never';