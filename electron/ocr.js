// Offline receipt reading with Tesseract. The English model ships with the app
// (@tesseract.js-data/eng), so receipt photos never leave the computer.
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let workerPromise = null;
let idleTimer = null;

// Packaged builds keep these modules outside app.asar (see "asarUnpack" in package.json).
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function langPath() {
  return unpacked(path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int'));
}

export async function recognise(file, cachePath) {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('eng', 1, { langPath: langPath(), cachePath, gzip: true, cacheMethod: 'none' });
  }
  clearTimeout(idleTimer);
  const worker = await workerPromise;
  try {
    // Never leave the UI waiting on a stuck engine.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Couldn't read that photo in time. Type the items instead.")), 60_000));
    const { data } = await Promise.race([worker.recognize(file), timeout]);
    return data.text;
  } catch (err) {
    workerPromise = null;
    throw err;
  } finally {
    // Free the ~100MB engine when receipts haven't been scanned for a while.
    idleTimer = setTimeout(async () => {
      const w = await workerPromise;
      workerPromise = null;
      await w.terminate();
    }, 5 * 60 * 1000);
  }
}
