import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

const maplibreDist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const sqlJsDist = dirname(require.resolve('sql.js'));

const jobs = [
  [join(maplibreDist, 'maplibre-gl-worker.mjs'), 'public/maplibre/maplibre-gl-worker.mjs'],
  [join(sqlJsDist, 'sql-wasm.wasm'), 'public/sql-wasm.wasm'],
  [join(sqlJsDist, 'sql-wasm-browser.wasm'), 'public/sql-wasm-browser.wasm'],
];

for (const [from, to] of jobs) {
  const target = join(root, to);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(from, target);
}
