import fs from 'node:fs';
import path from 'node:path';
import { migrate } from '../src/engine/state.js';

const KEEP_BACKUPS = 14;

/** Small JSON file with atomic writes (write to .tmp, then rename) so a crash can't corrupt it. */
export class JsonFile {
  constructor(file, fallback = {}) {
    this.file = file;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = fallback; }
  }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; this.write(); }
  write() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}

/** The app's data file, with daily backups and recovery from the latest backup if the file is damaged. */
export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'pulse-data.json');
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.state = this.load();
    this.backup();
  }

  load() {
    if (!fs.existsSync(this.file)) return migrate(null);
    try {
      return migrate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      console.error('Data file unreadable, restoring latest backup', err);
      fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}`);
      for (const b of this.backups()) {
        try { return migrate(JSON.parse(fs.readFileSync(b, 'utf8'))); } catch { /* try the next one */ }
      }
      return migrate(null);
    }
  }

  backups() {
    return fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => path.join(this.backupDir, f));
  }

  backup() {
    if (!fs.existsSync(this.file)) return;
    const target = path.join(this.backupDir, `pulse-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
    for (const old of this.backups().slice(KEEP_BACKUPS)) fs.rmSync(old, { force: true });
  }

  get() { return this.state; }

  update(fn) {
    this.state = fn(this.state);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
    return this.state;
  }

  flush() {
    clearTimeout(this.timer);
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
