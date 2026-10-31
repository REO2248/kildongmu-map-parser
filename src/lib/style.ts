import { TILE_SCHEME } from './tiles';

const absolute = (path: string) => new URL(path, window.location.href).href;

// Built without URL parsing so the {fontstack}/{range} tokens survive.
const glyphsUrl = (base: string, raw?: string) => {
  const root = new URL(base, window.location.href).href;
  const path = raw
    ? raw
        .replace('asset://utils/fonts/', 'fonts/')
        .replace(/\/0-65535\.pbf$/, '/{range}.pbf')
        .replace(/^\/+/, '')
    : 'fonts/{fontstack}/{range}.pbf';
  return path.includes('{range}') ? root + path : `${root}fonts/{fontstack}/{range}.pbf`;
};

interface ZoomRange {
  min: number;
  max: number;
}

/**
 * The app ships a style with no sources and legacy "ref" layers, so we resolve
 * refs, inject the vector source for our tile protocol and redirect sprite and
 * glyph URLs to the local asset copies.
 */
export function buildStyle(raw: any, base: string, zooms: ZoomRange, withTiles: boolean) {
  const byId = new Map<string, any>();
  const layers: any[] = [];

  for (const layer of raw.layers ?? []) {
    if (layer.ref) {
      const target = byId.get(layer.ref);
      if (!target) continue;
      const merged = structuredClone(target);
      merged.id = layer.id;
      merged.paint = { ...(target.paint ?? {}), ...(layer.paint ?? {}) };
      layers.push(merged);
    } else {
      byId.set(layer.id, layer);
      layers.push(structuredClone(layer));
    }
  }

  const sources: Record<string, any> = {};
  if (withTiles) {
    for (const name of new Set(layers.map((l) => l.source).filter(Boolean))) {
      sources[name] = {
        type: 'vector',
        tiles: [`${TILE_SCHEME}://tiles/{z}/{x}/{y}`],
        minzoom: zooms.min,
        maxzoom: zooms.max,
      };
    }
  }

  return {
    version: 8,
    sources,
    sprite: absolute(`${base}sprite/symbol`),
    // The app's font PBF holds every codepoint in one file; MapLibre requires
    // per-256 range files, so the path is templated and the font split at build.
    glyphs: glyphsUrl(base, raw.glyphs),
    light: raw.light,
    layers: layers.filter((l) => !l.source || sources[l.source]),
  };
}

export function fallbackStyle(base: string) {
  return {
    version: 8,
    sources: {},
    sprite: absolute(`${base}sprite/symbol`),
    glyphs: glyphsUrl(base),
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0d1117' },
      },
    ],
  };
}

const FILL_COLORS: Record<string, string> = {
  pg_background: '#151a21',
  pg_city_rect: '#21262d',
  pg_area: '#7ee787',
  pg_building: '#2d333b',
  pg_road: '#3d444d',
};

const LINE_COLORS: Record<string, string> = {
  ln_city_rect: '#30363d',
  ln_line: '#8b949e',
  ln_railway: '#d29922',
  ln_river_string: '#1f6feb',
  ln_road1: '#58a6ff',
  ln_road2: '#58a6ff',
  ln_road_outline: '#0d1117',
};

const LAYER_RANK: Record<string, number> = {
  pg_background: 0,
  pg_city_rect: 10,
  pg_area: 20,
  pg_building: 30,
  pg_road: 35,
  ln_city_rect: 38,
  ln_river_string: 40,
  ln_line: 45,
  ln_railway: 46,
  ln_road_outline: 49,
  ln_road2: 50,
  ln_road1: 51,
  pt_area: 60,
};

function rank(id: string): number {
  if (id in LAYER_RANK) return LAYER_RANK[id];
  if (id.startsWith('pt_obj')) return 70;
  if (id.startsWith('pt_')) return 65;
  if (id.startsWith('ln_')) return 45;
  if (id.startsWith('pg_')) return 25;
  return 45;
}

function visualsFor(id: string) {
  if (id.startsWith('pg_')) {
    return {
      type: 'fill' as const,
      paint: {
        'fill-color': FILL_COLORS[id] ?? '#30363d',
        'fill-opacity': id === 'pg_area' ? 0.2 : 1,
        'fill-outline-color': FILL_COLORS[id] ?? '#30363d',
      },
    };
  }
  if (id.startsWith('ln_')) {
    return {
      type: 'line' as const,
      paint: {
        'line-color': LINE_COLORS[id] ?? '#8b949e',
        'line-width':
          id === 'ln_road_outline' ? 3.4 : id === 'ln_road1' || id === 'ln_road2' ? 1.4 : 1,
        'line-opacity': id === 'ln_city_rect' ? 0.6 : 0.9,
      },
    };
  }
  return {
    type: 'circle' as const,
    paint: {
      'circle-color': id === 'pt_area' ? '#ffb454' : '#ff6b81',
      'circle-radius': id === 'pt_area' ? 2.4 : 3,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#05070a',
      'circle-stroke-width': 0.6,
    },
  };
}

/**
 * Overlay-only MBTiles (tile-join output) carry no style table, only the
 * vector layer list in metadata. Render them with a neutral dark palette.
 */
export function inferredStyle(base: string, zooms: ZoomRange, vectorLayers: string[]) {
  const layers = [...vectorLayers].sort((a, b) => rank(a) - rank(b));
  return {
    version: 8,
    sources: {
      base: {
        type: 'vector',
        tiles: [`${TILE_SCHEME}://tiles/{z}/{x}/{y}`],
        minzoom: zooms.min,
        maxzoom: zooms.max,
      },
    },
    sprite: absolute(`${base}sprite/symbol`),
    glyphs: glyphsUrl(base),
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0b0f14' },
      },
      ...layers.map((id) => ({
        id: `base-${id}`,
        source: 'base',
        'source-layer': id,
        ...visualsFor(id),
      })),
    ],
  };
}
