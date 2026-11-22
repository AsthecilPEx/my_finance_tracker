import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Lucide from 'lucide-react';
import { DEFAULT_CATEGORIES } from '../src/engine/categories.js';
import { LEGACY, GOAL_ICONS, iconName } from '../src/engine/icons.js';
import { TIERS, SECTIONS } from '../src/engine/receipts.js';
import { migrate } from '../src/engine/state.js';

// The rules in CLAUDE.md: no emojis or GIFs in the UI; icons come from lucide-react.
const ROOTS = ['src', 'electron'];
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? files(p) : [p];
});
const source = ROOTS.flatMap(files).filter((f) => /\.(jsx?|cjs|mjs|css|html)$/.test(f));
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{23F3}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}]/u;

describe('Icons (CLAUDE.md rules)', () => {
  it('has no emojis or symbol-icons anywhere in the app source', () => {
    const found = [];
    for (const f of source) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // Arrows inside plain sentences ("A → B") are typography, not icons.
        const m = line.replace(/→/g, '').match(EMOJI);
        if (m) found.push(`${f}:${i + 1}: ${m[0]}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('uses no .gif files', () => {
    expect(ROOTS.flatMap(files).filter((f) => f.endsWith('.gif'))).toEqual([]);
    expect(source.filter((f) => /\.gif\b/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('every icon name used exists in lucide-react and is registered in Icon.jsx', () => {
    const iconJsx = fs.readFileSync('src/renderer/components/Icon.jsx', 'utf8');
    const registered = new Set(iconJsx.match(/export const ICONS = \{([\s\S]*?)\};/)[1].split(/[\s,]+/).filter(Boolean));
    const used = new Set([
      ...DEFAULT_CATEGORIES.map((c) => c.icon), ...Object.values(LEGACY), ...GOAL_ICONS,
      ...Object.values(TIERS).map((t) => t.icon), ...Object.values(SECTIONS).map((s) => s.icon),
    ]);
    // Icon names written in the code: name="X", name={... 'X' ...}, icon: 'X', i: 'X'.
    for (const f of source.filter((x) => x.startsWith('src'))) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/name="([A-Z][A-Za-z0-9]+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/(?:icon|\bi): '([A-Z][A-Za-z0-9]+)'/g)) used.add(m[1]);
      for (const m of text.matchAll(/name=\{[^}]*\}/g)) for (const n of m[0].matchAll(/'([A-Z][A-Za-z0-9]+)'/g)) used.add(n[1]);
      for (const m of text.matchAll(/HISTORY_ICON = \{[^}]*\}/g)) for (const n of m[0].matchAll(/'([A-Z][A-Za-z0-9]+)'/g)) used.add(n[1]);
    }
    const missing = [...used].filter((n) => !registered.has(n) || !Lucide[n]);
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(50);
  });

  it('translates icons saved by older versions', () => {
    expect(iconName('\u{1F3E0}')).toBe('House');
    expect(iconName('\u{1F6E1}\u{FE0F}')).toBe('Shield');
    expect(iconName('Wallet')).toBe('Wallet');
    expect(iconName('unknown!', 'Target')).toBe('Target');
    const old = migrate({
      categories: [{ id: 'groceries', name: 'Groceries', icon: '\u{1F6D2}' }, { id: 'mine', name: 'Pets', icon: '\u{1F436}' }],
      goals: [{ id: 'g', name: 'Fund', icon: '\u{1F6DF}' }, { id: 'h', name: 'Odd', icon: 'x' }],
    });
    expect(old.categories.find((c) => c.id === 'groceries').icon).toBe('ShoppingCart');
    expect(old.categories.find((c) => c.id === 'mine').icon).toBe('Dog');
    expect(old.goals.map((g) => g.icon)).toEqual(['LifeBuoy', 'Target']);
  });
});
