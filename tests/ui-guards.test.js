import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('UI guards', () => {
  it('never uses native alert/confirm/prompt (they break typing in Electron on Windows)', () => {
    const offenders = [];
    for (const f of walk('src/renderer').filter((x) => /\.jsx?$/.test(x))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(line) && !/^\s*\/\//.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
