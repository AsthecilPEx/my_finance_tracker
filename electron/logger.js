import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;

/**
 * A small error log (errors and warnings only, never financial data) that friends can
 * attach to a bug report. Rotates at 512 KB, keeping one previous file.
 */
export function createLogger(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'pulse.log');
  const write = (level, parts) => {
    try {
      const text = parts.map((p) => (p instanceof Error ? `${p.message}\n${p.stack || ''}` : String(p))).join(' ').slice(0, 4000);
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch { /* logging must never break the app */ }
  };
  return {
    file,
    error: (...p) => write('ERROR', p),
    warn: (...p) => write('WARN', p),
    tail(lines = 40) {
      try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-lines).join('\n'); } catch { return ''; }
    },
  };
}
