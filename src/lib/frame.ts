import type { Database } from './sqlite';

/**
 * The base map tiles and the geo.db overlay tables were produced in different
 * coordinate frames: tiles sit roughly 700 m south-west of the WGS84 points
 * stored in geo.db. The exported map.db carries a "city rect" layer that
 * duplicates the city outline in tile coordinates, so comparing its extent
 * with the CITYINFO bounds yields the translation between the two frames.
 */
export interface FrameDelta {
  lng: number;
  lat: number;
}

type Bounds = [[number, number], [number, number]];

const RECT_LAYERS = ['pg_city_rect', 'ln_city_rect'];
const ZOOMS = [12, 13, 10, 8];

export async function detectFrameDelta(db: Database, cityBounds: Bounds): Promise<FrameDelta | null> {
  const [[west, south], [east, north]] = cityBounds;
  if (!(east > west && north > south)) return null;

  for (const zoom of ZOOMS) {
    const rect = await readRectBounds(db, zoom);
    if (!rect) continue;
    const dlngA = rect.west - west;
    const dlngB = rect.east - east;
    const dlatA = rect.south - south;
    const dlatB = rect.north - north;
    // A pure translation keeps both edges equally displaced; anything else
    // means we picked up the wrong geometry.
    if (Math.abs(dlngA - dlngB) > 5e-4 || Math.abs(dlatA - dlatB) > 5e-4) continue;
    const delta = { lng: (dlngA + dlngB) / 2, lat: (dlatA + dlatB) / 2 };
    if (Math.abs(delta.lng) > 0.05 || Math.abs(delta.lat) > 0.05) continue;
    return negligible(delta) ? null : delta;
  }

  const meta = readMetadataDelta(db, cityBounds);
  return meta && !negligible(meta) ? meta : null;
}

function negligible(delta: FrameDelta): boolean {
  return Math.abs(delta.lng) < 1e-7 && Math.abs(delta.lat) < 1e-7;
}

interface RectBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

async function readRectBounds(db: Database, zoom: number): Promise<RectBounds | null> {
  const stmt = db.prepare('select tile_column, tile_row, tile_data from tiles where zoom_level = ?');
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  try {
    stmt.bind([zoom]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const data = await inflate(row.tile_data);
      if (!data) continue;
      const layers = parseTile(data);
      const layer =
        layers.find((l) => l.name === RECT_LAYERS[0]) ?? layers.find((l) => l.name === RECT_LAYERS[1]);
      if (!layer?.bbox) continue;
      const n = 2 ** zoom;
      const xyzY = n - 1 - Number(row.tile_row);
      const x = Number(row.tile_column);
      const [bx0, by0, bx1, by1] = layer.bbox;
      gx0 = Math.min(gx0, x + bx0 / layer.extent);
      gx1 = Math.max(gx1, x + bx1 / layer.extent);
      gy0 = Math.min(gy0, xyzY + by0 / layer.extent);
      gy1 = Math.max(gy1, xyzY + by1 / layer.extent);
    }
  } finally {
    stmt.free();
  }
  if (!Number.isFinite(gx0)) return null;
  return {
    west: lngAt(gx0, zoom),
    east: lngAt(gx1, zoom),
    north: latAt(gy0, zoom),
    south: latAt(gy1, zoom),
  };
}

const lngAt = (x: number, zoom: number) => (x / 2 ** zoom) * 360 - 180;

const latAt = (y: number, zoom: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) * 180) / Math.PI;

function readMetadataDelta(db: Database, cityBounds: Bounds): FrameDelta | null {
  const res = db.exec("select value from metadata where name = 'bounds'");
  if (!res.length || !res[0].values.length) return null;
  const rect = String(res[0].values[0][0] ?? '')
    .split(',')
    .map(Number);
  if (rect.length !== 4 || rect.some((n) => !Number.isFinite(n))) return null;
  // Tile coverage is snapped to tile edges, so only the centre is meaningful;
  // this is a coarse fallback for styles without a city-rect layer.
  const [[west, south], [east, north]] = cityBounds;
  const delta = {
    lng: (rect[0] + rect[2]) / 2 - (west + east) / 2,
    lat: (rect[1] + rect[3]) / 2 - (south + north) / 2,
  };
  return Math.abs(delta.lng) > 0.05 || Math.abs(delta.lat) > 0.05 ? null : delta;
}

async function inflate(value: unknown): Promise<Uint8Array | null> {
  if (!(value instanceof Uint8Array)) return null;
  if (value.length > 2 && value[0] === 0x1f && value[1] === 0x8b) {
    const stream = new Blob([value as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return value;
}

interface TileLayer {
  name: string;
  extent: number;
  bbox: [number, number, number, number] | null;
}

const DEFAULT_EXTENT = 4096;

/** Minimal Mapbox Vector Tile reader: layer names and geometry extents only. */
function parseTile(buf: Uint8Array): TileLayer[] {
  const layers: TileLayer[] = [];
  walkFields(buf, (field, wire, value) => {
    if (field === 3 && wire === 2 && value instanceof Uint8Array) {
      const layer = parseLayer(value);
      if (layer) layers.push(layer);
    }
  });
  return layers;
}

function parseLayer(buf: Uint8Array): TileLayer | null {
  let name = '';
  let extent = DEFAULT_EXTENT;
  let bbox: TileLayer['bbox'] = null;
  walkFields(buf, (field, wire, value) => {
    if (field === 1 && wire === 2 && value instanceof Uint8Array) {
      name = new TextDecoder().decode(value);
    } else if (field === 5 && wire === 0 && typeof value === 'number') {
      extent = value;
    } else if (field === 2 && wire === 2 && value instanceof Uint8Array) {
      const feature = parseFeature(value);
      if (feature) bbox = unionBox(bbox, feature);
    }
  });
  return name ? { name, extent, bbox } : null;
}

function parseFeature(buf: Uint8Array): TileLayer['bbox'] {
  let bbox: TileLayer['bbox'] = null;
  walkFields(buf, (field, wire, value) => {
    if (field === 4 && wire === 2 && value instanceof Uint8Array) {
      const geom = geometryBox(value);
      if (geom) bbox = unionBox(bbox, geom);
    }
  });
  return bbox;
}

function geometryBox(geom: Uint8Array): TileLayer['bbox'] {
  let i = 0;
  let x = 0;
  let y = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  while (i < geom.length) {
    const [command, next] = readVarint(geom, i);
    i = next;
    const id = command & 7;
    const count = command >>> 3;
    if (id === 7) continue; // closePath carries no coordinates
    if (id !== 1 && id !== 2) return null;
    for (let k = 0; k < count; k++) {
      let dx: number;
      let dy: number;
      [dx, i] = readVarint(geom, i);
      [dy, i] = readVarint(geom, i);
      x += zigzag(dx);
      y += zigzag(dy);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

const zigzag = (n: number) => (n >>> 1) ^ -(n & 1);

function unionBox(
  a: TileLayer['bbox'],
  b: TileLayer['bbox'],
): TileLayer['bbox'] {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function readVarint(buf: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 1;
  let i = start;
  for (;;) {
    const byte = buf[i++];
    value += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) return [value, i];
    shift *= 128;
  }
}

function walkFields(
  buf: Uint8Array,
  visit: (field: number, wire: number, value: number | Uint8Array) => void,
): void {
  let i = 0;
  while (i < buf.length) {
    let key: number;
    [key, i] = readVarint(buf, i);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      let value: number;
      [value, i] = readVarint(buf, i);
      visit(field, wire, value);
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 2) {
      let length: number;
      [length, i] = readVarint(buf, i);
      visit(field, wire, buf.subarray(i, i + length));
      i += length;
    } else if (wire === 5) {
      i += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
}
