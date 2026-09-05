import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export class TaskStore {
  constructor(dataRoot) {
    const folder = path.join(dataRoot, '.fabu');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(folder, 'tasks.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL, document TEXT NOT NULL, plan TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_task ON events(task_id, seq);`);
    this.persist = this.db.transaction((task, event) => {
      this.db.prepare('UPDATE tasks SET document = ? WHERE id = ?').run(JSON.stringify(task), task.id);
      if (event) this.addEvent(task.id, event);
    });
    this.insert = this.db.transaction((task, plan, fingerprint, key) => {
      this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?)').run(task.id, key || null, fingerprint, task.created_at, JSON.stringify(task), JSON.stringify(plan));
      this.addEvent(task.id, { type: 'created', message: '任务已持久化，等待执行' });
    });
  }

  get(id) { const row = this.db.prepare('SELECT document FROM tasks WHERE id = ?').get(id); return row ? JSON.parse(row.document) : null; }
  plan(id) { const row = this.db.prepare('SELECT plan FROM tasks WHERE id = ?').get(id); return row ? JSON.parse(row.plan) : null; }
  byKey(key) { return key ? this.db.prepare('SELECT id, fingerprint FROM tasks WHERE idempotency_key = ?').get(key) : null; }
  list({ limit = 30, offset = 0 } = {}) { return this.db.prepare('SELECT document FROM tasks ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(limit, offset).map(r => JSON.parse(r.document)); }
  all() { return this.db.prepare('SELECT document FROM tasks').all().map(r => JSON.parse(r.document)); }
  addEvent(id, event) {
    const timestamp = new Date().toISOString();
    this.db.prepare('INSERT INTO events(task_id, timestamp, payload) VALUES (?, ?, ?)').run(id, timestamp, JSON.stringify(event));
  }
  events(id, after = 0, limit = 200) { return this.db.prepare('SELECT * FROM events WHERE task_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(id, after, limit).map(r => ({ seq: r.seq, timestamp: r.timestamp, ...JSON.parse(r.payload) })); }
  close() { this.db.close(); }
}
