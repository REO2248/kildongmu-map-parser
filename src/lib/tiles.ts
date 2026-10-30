import * as maplibregl from 'maplibre-gl';
import type { Database, Statement } from 'sql.js';

let db: Database | null = null;
let stmt: Statement | null = null;
let installed = false;

export const TILE_SCHEME = 'kdp';

export function installTileProtocol(): void {
  if (installed) return;
  installed = true;
  maplibregl.addProtocol(TILE_SCHEME, async (params: maplibregl.RequestParameters) => {
    // A null body means "no content" (204) at runtime; MBTiles only stores
    // tiles that contain features, but the typings refuse a null here.
    return { data: (await tileFor(params.url)) as ArrayBuffer };
  });
}

export function useTileDb(database: Database): void {
  stmt?.free();
  stmt = null;
  db = database;
}

export function releaseTileDb(): void {
  stmt?.free();
  stmt = null;
  db = null;
}

async function tileFor(url: string): Promise<ArrayBuffer | null> {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __tileCalls?: string[] };
    w.__tileCalls ??= [];
    w.__tileCalls.push(url);
  }
  const m = /^kdp:\/\/tiles\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  if (!m || !db) return null;
  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  // MBTiles stores TMS rows; MapLibre requests XYZ.
  const row = (1 << z) - 1 - y;
  stmt ??= db.prepare('select tile_data from tiles where zoom_level=? and tile_column=? and tile_row=?');
  stmt.reset();
  stmt.bind([z, x, row]);
  let bytes: Uint8Array | null = null;
  if (stmt.step()) {
    const value = stmt.getAsObject().tile_data;
    if (value instanceof Uint8Array) bytes = value;
  }
  stmt.reset();
  if (!bytes) return null;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzip(bytes);
  return toArrayBuffer(bytes);
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
