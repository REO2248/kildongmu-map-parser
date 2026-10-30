import { decode_geometry, initWasm, Package } from './wasm';
import { loadSqlJs, type Database } from './sqlite';
import { buildStyle, fallbackStyle } from './style';
import { detectFrameDelta, type FrameDelta } from './frame';

export const ITERATIONS = 12345;

export interface CityInfo {
  id: number;
  city: string;
  province: string;
  alias: string;
  version: number;
  center: [number, number];
  bounds: [[number, number], [number, number]];
}

export type OverlayKind = 'line' | 'fill' | 'circle';

export interface Overlay {
  table: string;
  kind: OverlayKind;
  color: string;
  data: any;
  count: number;
}

export interface LoadedCity {
  city: CityInfo;
  style: any;
  overlays: Overlay[];
  mapDb: Database | null;
  dispose(): void;
}

type Frame = 'wgs' | 'tile';

const TABLES: Array<{ table: string; kind: OverlayKind; color: string; frame: Frame }> = [
  { table: 'ln_net', kind: 'line', color: '#38d6ff', frame: 'wgs' },
  { table: 'pg_area', kind: 'fill', color: '#7ee787', frame: 'wgs' },
  { table: 'pt_area', kind: 'circle', color: '#ffb454', frame: 'wgs' },
  { table: 'pt_obj', kind: 'circle', color: '#ff6b81', frame: 'tile' },
  { table: 'pt_ban', kind: 'circle', color: '#c792ea', frame: 'wgs' },
  { table: 'pt_node', kind: 'circle', color: '#e6edf3', frame: 'wgs' },
];

const WGS_TABLES = new Set(TABLES.filter((t) => t.frame === 'wgs').map((t) => t.table));

export async function loadCity(
  file: File,
  onStep: (step: string) => void,
): Promise<LoadedCity> {
  await initWasm();
  const sql = await loadSqlJs();

  onStep('parse');
  const raw = new Uint8Array(await file.arrayBuffer());
  const pkg = new Package(raw);
  const alias = pkg.alias ?? '';
  const base = import.meta.env.BASE_URL;

  onStep('keys');
  const cityDb = new sql.Database(pkg.city_db(ITERATIONS));
  const city = readCity(cityDb, alias);
  cityDb.close();
  // CITYINFO holds the city rectangle in the geo.db frame, which is what the
  // tile frame is compared against before any overlay bounds replace it.
  const infoBounds = city.bounds;

  onStep('geometry');
  const geoDb = new sql.Database(pkg.geo_db(city.id, ITERATIONS));
  let overlays: Overlay[] = [];
  try {
    overlays = readOverlays(geoDb);
  } finally {
    geoDb.close();
  }
  if (overlays.length) {
    const b = combinedBounds(overlays.filter((o) => WGS_TABLES.has(o.table)));
    if (b) city.bounds = b;
    if (!city.center[0] && !city.center[1] && validBounds(city.bounds)) {
      city.center = [
        (city.bounds[0][0] + city.bounds[1][0]) / 2,
        (city.bounds[0][1] + city.bounds[1][1]) / 2,
      ];
    }
  }

  onStep('tiles');
  let mapDb: Database | null = null;
  let style: any = fallbackStyle(base);
  let delta: FrameDelta | null = null;
  if (pkg.has('/map.db')) {
    mapDb = new sql.Database(pkg.map_db(ITERATIONS));
    const rawStyle = readStyle(mapDb);
    if (rawStyle) style = buildStyle(rawStyle, base, readZooms(mapDb), true);
    delta = await detectFrameDelta(mapDb, validBounds(infoBounds) ? infoBounds : city.bounds);
  }
  pkg.free();

  if (delta) applyFrameDelta(city, overlays, delta);

  return {
    city,
    style,
    overlays,
    mapDb,
    dispose() {
      mapDb?.close();
      mapDb = null;
    },
  };
}

function readCity(db: Database, alias: string): CityInfo {
  const res = db.exec(
    'select ID, CITY_NAME, PROV_NAME, START_LATLNG, MIN_LATLNG, MAX_LATLNG, ALIAS_NAME, VERSION from CITYINFO limit 1',
  );
  const row: Record<string, any> = {};
  if (res.length) {
    const { columns, values } = res[0];
    columns.forEach((c, i) => (row[c] = values[0][i]));
  }
  const start = parseLatLng(row.START_LATLNG);
  const min = parseLatLng(row.MIN_LATLNG);
  const max = parseLatLng(row.MAX_LATLNG);
  return {
    id: Number(row.ID ?? 0),
    city: String(row.CITY_NAME ?? alias),
    province: String(row.PROV_NAME ?? ''),
    alias: String(row.ALIAS_NAME ?? alias),
    version: Number(row.VERSION ?? 0),
    center: start ?? [0, 0],
    bounds: min && max ? [min, max] : [[0, 0], [0, 0]],
  };
}

/** Values are stored as "lat,lng"; MapLibre wants [lng, lat]. */
function parseLatLng(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const [lat, lng] = value.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

function readOverlays(db: Database): Overlay[] {
  const overlays: Overlay[] = [];
  for (const spec of TABLES) {
    let stmt;
    try {
      stmt = db.prepare(`select * from "${spec.table}"`);
    } catch {
      continue;
    }
    const features: any[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const blob = row.geom;
        if (!(blob instanceof Uint8Array)) continue;
        const decoded = decode_geometry(blob);
        if (!decoded) continue;
        const properties: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== 'geom' && typeof v !== 'object') properties[k] = v;
        }
        features.push({ type: 'Feature', geometry: JSON.parse(decoded), properties });
      }
    } finally {
      stmt.free();
    }
    if (!features.length) continue;
    overlays.push({
      table: spec.table,
      kind: spec.kind,
      color: spec.color,
      count: features.length,
      data: { type: 'FeatureCollection', features },
    });
  }
  return overlays;
}

function combinedBounds(overlays: Overlay[]): CityInfo['bounds'] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coords: any): void => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const o of overlays) {
    for (const f of o.data.features) visit(f.geometry.coordinates);
  }
  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function validBounds(bounds: CityInfo['bounds']): boolean {
  return bounds[1][0] > bounds[0][0] && bounds[1][1] > bounds[0][1];
}

/**
 * Tiles and pt_obj already share the tile frame; the remaining geo.db tables
 * (and the CITYINFO rectangle) are WGS84 and have to move onto the tiles.
 */
function applyFrameDelta(city: CityInfo, overlays: Overlay[], delta: FrameDelta): void {
  for (const o of overlays) {
    if (!WGS_TABLES.has(o.table)) continue;
    for (const feature of o.data.features) {
      feature.geometry.coordinates = translate(feature.geometry.coordinates, delta);
    }
  }
  if (validBounds(city.bounds)) {
    const [[w, s], [e, n]] = city.bounds;
    city.bounds = [
      [w + delta.lng, s + delta.lat],
      [e + delta.lng, n + delta.lat],
    ];
  }
  if (city.center[0] || city.center[1]) {
    city.center = [city.center[0] + delta.lng, city.center[1] + delta.lat];
  }
}

function translate(coords: any, delta: FrameDelta): any {
  if (typeof coords[0] === 'number') return [coords[0] + delta.lng, coords[1] + delta.lat];
  return coords.map((c: any) => translate(c, delta));
}

function readStyle(db: Database): any | null {
  const preferred = db.exec('select style from styles where id = 2');
  const rows = preferred.length ? preferred : db.exec('select style from styles order by id limit 1');
  if (!rows.length || !rows[0].values.length) return null;
  const raw = rows[0].values[0][0];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readZooms(db: Database): { min: number; max: number } {
  const zooms = { min: 8, max: 16 };
  const res = db.exec("select name, value from metadata where name in ('minzoom','maxzoom')");
  if (res.length) {
    for (const [name, value] of res[0].values) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (name === 'minzoom') zooms.min = n;
      if (name === 'maxzoom') zooms.max = n;
    }
  }
  return zooms;
}
