const fs = require('fs');
const path = require('path');
const express = require('express');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Try sqlite first; if missing or fails, use JSON file store
let useSqlite = false;
let sqliteDB = null;
try {
  const Database = require('better-sqlite3');
  const DB_PATH = path.join(DATA_DIR, 'browser.db');
  sqliteDB = new Database(DB_PATH);
  sqliteDB.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    rev INTEGER DEFAULT 1,
    deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `);
  useSqlite = true;
  console.log('Using better-sqlite3 persistence at', DB_PATH);
} catch (err) {
  useSqlite = false;
  console.log('better-sqlite3 not available, falling back to JSON file DB');
}

// JSON-file DB helpers
const JSON_DB_PATH = path.join(DATA_DIR, 'browser.json');
function loadJsonDb() {
  if (!fs.existsSync(JSON_DB_PATH)) {
    const init = { nextId: 1, pages: [] };
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
  } catch (e) {
    // corrupt file -> reset
    const init = { nextId: 1, pages: [] };
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
}
function saveJsonDb(db) {
  fs.writeFileSync(JSON_DB_PATH, JSON.stringify(db, null, 2));
}

// Unified DB API
function listPages() {
  if (useSqlite) {
    return sqliteDB.prepare('SELECT id, title, created_at, updated_at FROM pages WHERE deleted = 0 ORDER BY updated_at DESC').all();
  } else {
    const db = loadJsonDb();
    return db.pages.filter(p => !p.deleted).sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at)).map(({id,title,created_at,updated_at}) => ({id,title,created_at,updated_at}));
  }
}
function getPage(id) {
  if (useSqlite) {
    return sqliteDB.prepare('SELECT * FROM pages WHERE id = ? AND deleted = 0').get(id);
  } else {
    const db = loadJsonDb();
    return db.pages.find(p => p.id === Number(id) && !p.deleted) || null;
  }
}
function createPage({ title = 'Untitled', content = '' }) {
  const now = new Date().toISOString();
  if (useSqlite) {
    const info = sqliteDB.prepare('INSERT INTO pages (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)').run(title, content, now, now);
    return sqliteDB.prepare('SELECT * FROM pages WHERE id = ?').get(info.lastInsertRowid);
  } else {
    const db = loadJsonDb();
    const id = db.nextId++;
    const row = { id, title, content, rev: 1, deleted: 0, created_at: now, updated_at: now };
    db.pages.push(row);
    saveJsonDb(db);
    return row;
  }
}
function updatePage(id, { title, content, updated_at }) {
  const now = updated_at || new Date().toISOString();
  if (useSqlite) {
    const stmt = sqliteDB.prepare('UPDATE pages SET title = COALESCE(?, title), content = COALESCE(?, content), rev = rev + 1, updated_at = ? WHERE id = ?');
    const info = stmt.run(title, content, now, id);
    if (info.changes === 0) return null;
    return sqliteDB.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  } else {
    const db = loadJsonDb();
    const p = db.pages.find(x => x.id === Number(id));
    if (!p) return null;
    if (title !== undefined) p.title = title;
    if (content !== undefined) p.content = content;
    p.rev = (p.rev || 1) + 1;
    p.updated_at = now;
    saveJsonDb(db);
    return p;
  }
}
function softDelete(id) {
  const now = new Date().toISOString();
  if (useSqlite) {
    const info = sqliteDB.prepare('UPDATE pages SET deleted = 1, rev = rev + 1, updated_at = ? WHERE id = ?').run(now, id);
    return info.changes > 0;
  } else {
    const db = loadJsonDb();
    const p = db.pages.find(x => x.id === Number(id));
    if (!p) return false;
    p.deleted = 1;
    p.rev = (p.rev || 1) + 1;
    p.updated_at = now;
    saveJsonDb(db);
    return true;
  }
}
function getChangesSince(since) {
  if (useSqlite) {
    if (since) return sqliteDB.prepare('SELECT * FROM pages WHERE updated_at > ? ORDER BY updated_at ASC').all(since);
    return sqliteDB.prepare('SELECT * FROM pages ORDER BY updated_at ASC').all();
  } else {
    const db = loadJsonDb();
    const rows = db.pages.slice().sort((a,b) => new Date(a.updated_at) - new Date(b.updated_at));
    if (since) return rows.filter(r => new Date(r.updated_at) > new Date(since));
    return rows;
  }
}
function upsertPages(items) {
  if (useSqlite) {
    const upsertStmt = sqliteDB.prepare(`
      INSERT INTO pages (id, title, content, rev, deleted, created_at, updated_at)
      VALUES (@id, @title, @content, COALESCE(@rev,1), COALESCE(@deleted,0), COALESCE(@created_at, CURRENT_TIMESTAMP), @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        title = CASE WHEN excluded.updated_at > pages.updated_at THEN excluded.title ELSE pages.title END,
        content = CASE WHEN excluded.updated_at > pages.updated_at THEN excluded.content ELSE pages.content END,
        rev = CASE WHEN excluded.updated_at > pages.updated_at THEN excluded.rev ELSE pages.rev END,
        deleted = CASE WHEN excluded.updated_at > pages.updated_at THEN excluded.deleted ELSE pages.deleted END,
        updated_at = CASE WHEN excluded.updated_at > pages.updated_at THEN excluded.updated_at ELSE pages.updated_at END
    `);
    const insert = sqliteDB.transaction((rows) => {
      for (const r of rows) {
        if (!r.updated_at) r.updated_at = new Date().toISOString();
        upsertStmt.run(r);
      }
    });
    insert(items);
  } else {
    const db = loadJsonDb();
    for (const r of items) {
      if (!r.updated_at) r.updated_at = new Date().toISOString();
      const existing = db.pages.find(p => p.id === Number(r.id));
      if (existing) {
        // last-write-wins by updated_at
        if (new Date(r.updated_at) > new Date(existing.updated_at)) {
          existing.title = r.title !== undefined ? r.title : existing.title;
          existing.content = r.content !== undefined ? r.content : existing.content;
          existing.rev = r.rev !== undefined ? r.rev : existing.rev;
          existing.deleted = r.deleted !== undefined ? r.deleted : existing.deleted;
          existing.updated_at = r.updated_at;
        }
      } else {
        const id = Number(r.id) || db.nextId++;
        const row = {
          id,
          title: r.title || 'Untitled',
          content: r.content || '',
          rev: r.rev || 1,
          deleted: r.deleted || 0,
          created_at: r.created_at || r.updated_at || new Date().toISOString(),
          updated_at: r.updated_at
        };
        db.pages.push(row);
        if (id >= db.nextId) db.nextId = id + 1;
      }
    }
    saveJsonDb(db);
  }
}
function exportRows() {
  if (useSqlite) return sqliteDB.prepare('SELECT * FROM pages ORDER BY id').all();
  const db = loadJsonDb(); return db.pages.slice().sort((a,b)=>a.id-b.id);
}
function importRows(rows, replace = false) {
  if (useSqlite) {
    if (replace) sqliteDB.prepare('DELETE FROM pages').run();
    const upsert = sqliteDB.prepare(`
      INSERT INTO pages (id, title, content, rev, deleted, created_at, updated_at)
      VALUES (@id, @title, @content, COALESCE(@rev,1), COALESCE(@deleted,0), COALESCE(@created_at, CURRENT_TIMESTAMP), @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        rev = excluded.rev,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at
    `);
    const insert = sqliteDB.transaction((rs) => { for (const r of rs) { if (!r.updated_at) r.updated_at = new Date().toISOString(); upsert.run(r); }});
    insert(rows);
  } else {
    const db = loadJsonDb();
    if (replace) { db.pages = []; db.nextId = 1; }
    for (const r of rows) {
      if (!r.updated_at) r.updated_at = new Date().toISOString();
      const existing = db.pages.find(p => p.id === Number(r.id));
      if (existing) {
        existing.title = r.title;
        existing.content = r.content;
        existing.rev = r.rev;
        existing.deleted = r.deleted;
        existing.updated_at = r.updated_at;
      } else {
        const id = Number(r.id) || db.nextId++;
        db.pages.push({
          id,
          title: r.title || 'Untitled',
          content: r.content || '',
          rev: r.rev || 1,
          deleted: r.deleted || 0,
          created_at: r.created_at || r.updated_at,
          updated_at: r.updated_at
        });
        if (id >= db.nextId) db.nextId = id + 1;
      }
    }
    saveJsonDb(db);
  }
}

// Express app + SSE (kept same behavior)
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE clients
const sseClients = new Set();
function broadcastEvent(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) {}
  }
}
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`retry: 10000\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// API endpoints using unified DB API
app.get('/api/pages', (req, res) => res.json(listPages()));

app.get('/api/pages/:id', (req, res) => {
  const row = getPage(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/pages', (req, res) => {
  const { title, content } = req.body || {};
  const page = createPage({ title, content });
  res.status(201).json(page);
  broadcastEvent({ type: 'page', action: 'created', row: page, serverTime: new Date().toISOString() });
});

app.put('/api/pages/:id', (req, res) => {
  const updated = updatePage(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
  broadcastEvent({ type: 'page', action: 'updated', row: updated, serverTime: new Date().toISOString() });
});

app.delete('/api/pages/:id', (req, res) => {
  const ok = softDelete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
  broadcastEvent({ type: 'page', action: 'deleted', id: Number(req.params.id), serverTime: new Date().toISOString() });
});

// Sync endpoints
app.get('/api/sync/changes', (req, res) => {
  const since = req.query.since;
  res.json({ serverTime: new Date().toISOString(), changes: getChangesSince(since) });
});

app.post('/api/sync/changes', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body.changes || []);
  try {
    upsertPages(items);
    const serverTime = new Date().toISOString();
    res.json({ ok: true, serverTime });
    broadcastEvent({ type: 'sync', serverTime });
  } catch (err) {
    console.error('sync import error', err);
    res.status(500).json({ error: 'sync failed' });
  }
});

app.get('/api/export', (req, res) => res.json({ exportedAt: new Date().toISOString(), rows: exportRows() }));

app.post('/api/import', (req, res) => {
  const replace = req.query.replace === '1';
  const rows = Array.isArray(req.body) ? req.body : (req.body.rows || []);
  try {
    importRows(rows, replace);
    const serverTime = new Date().toISOString();
    res.json({ ok: true });
    broadcastEvent({ type: 'import', serverTime });
  } catch (err) {
    console.error('import error', err);
    res.status(500).json({ error: 'import failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Holarchy Browser server running on http://localhost:${PORT}`);
  if (!useSqlite) console.log('JSON DB at', JSON_DB_PATH);
});