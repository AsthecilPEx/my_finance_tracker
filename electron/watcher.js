import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseStatement } from '../src/engine/csv.js';

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Watches a folder for bank statement CSVs and imports them automatically.
 * Each file is fingerprinted so it's only processed once; row-level de-duplication
 * in the importer makes overlapping statements safe as well.
 */
export class FolderWatcher {
  constructor({ onRows, processed, log = console.log }) {
    this.onRows = onRows;
    this.processed = processed; // JsonFile
    this.log = log;
    this.watcher = null;
    this.folder = '';
    this.pending = new Map();
  }

  configure(folder, enabled) {
    if (this.watcher && folder === this.folder && enabled) return;
    this.stop();
    this.folder = folder;
    if (!enabled || !folder || !fs.existsSync(folder)) return;
    try {
      this.watcher = fs.watch(folder, (_event, name) => {
        if (!name || !name.toLowerCase().endsWith('.csv')) return;
        clearTimeout(this.pending.get(name));
        // Wait for the download/copy to finish before reading.
        this.pending.set(name, setTimeout(() => this.processFile(path.join(folder, name)), 2000));
      });
      this.scan();
    } catch (err) {
      this.log('Folder watch failed', err);
    }
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  status() {
    return { active: !!this.watcher, folder: this.folder };
  }

  async scan() {
    if (!this.folder || !fs.existsSync(this.folder)) return { imported: 0 };
    let imported = 0;
    for (const name of fs.readdirSync(this.folder)) {
      if (name.toLowerCase().endsWith('.csv') && (await this.processFile(path.join(this.folder, name)))) imported++;
    }
    return { imported };
  }

  async processFile(file) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return false;
      const buf = fs.readFileSync(file);
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      const done = this.processed.get('files') || {};
      if (done[hash]) return false;
      const markDone = () => this.processed.set('files', { ...done, [hash]: { name: path.basename(file), at: new Date().toISOString() } });
      let parsed;
      try { parsed = parseStatement(buf.toString('utf8')); } catch { markDone(); return false; } // not a bank statement
      // Ignore CSVs that merely happen to have date and amount columns.
      const described = parsed.rows.filter((r) => r.description && r.description !== 'Unknown').length;
      if (parsed.rows.length < 2 || described / parsed.rows.length < 0.6) { markDone(); return false; }
      // Files from banks Pulse doesn't recognise are named after the file (minus dates), so a card
      // export (e.g. "barclaycard_2026-09.csv") becomes its own account and Pulse can ask about it.
      const fallback = path.basename(file).replace(/\.csv$/i, '').replace(/[\d_.-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported statements';
      const rows = parsed.rows.map((r) => (r.account ? r : { ...r, account: fallback.replace(/\b\w/g, (c) => c.toUpperCase()) }));
      await this.onRows(rows, path.basename(file));
      markDone();
      return true;
    } catch (err) {
      this.log('Could not import', file, err);
      return false;
    }
  }
}
