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

const FONT = 'Gothic';

const roadWidth = (base: number, stops: Array<[number, number]>) => ({
  base,
  stops,
});

/**
 * Overlay-only MBTiles (tile-join output) carry no style table, only the
 * vector layer list in metadata. Recreate the app's own palette from the
 * reference style shipped in older packages (light background, blue water,
 * green vegetation, beige major roads, sprite icons and Gothic labels).
 */
export function inferredStyle(base: string, zooms: ZoomRange, vectorLayers: string[]) {
  const has = new Set(vectorLayers);
  const used = new Set<string>();
  const layers: any[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#eef1f8' } },
  ];
  const emit = (sourceLayer: string, ...specs: any[]) => {
    if (!has.has(sourceLayer)) return;
    used.add(sourceLayer);
    for (const spec of specs) layers.push({ source: 'base', 'source-layer': sourceLayer, ...spec });
  };

  emit('pg_city_rect', {
    id: 'pg_rect',
    type: 'fill',
    paint: { 'fill-color': '#eef1f8' },
  });

  emit(
    'pg_background',
    {
      id: 'pg_water',
      type: 'fill',
      filter: ['in', 'fcod', 'DA01', 'DA02', 'DA03', 'DA04', 'DA05', 'DB00', 'HF03', 'GE05'],
      paint: { 'fill-color': '#98c0f4' },
    },
    { id: 'pg_wood', type: 'fill', filter: ['==', 'fcod', 'FB01'], paint: { 'fill-color': '#cde093' } },
    {
      id: 'pg_beach',
      type: 'fill',
      filter: ['in', 'fcod', 'CC02', 'EF02'],
      paint: { 'fill-color': '#eef1f8' },
    },
    { id: 'pg_urban', type: 'fill', filter: ['==', 'fcod', 'GD01'], paint: { 'fill-color': '#eef1f8' } },
    {
      id: 'pg_food',
      type: 'fill',
      filter: ['in', 'fcod', 'FA01', 'FA02'],
      paint: { 'fill-color': '#eef1f8' },
    },
    { id: 'pg_island', type: 'fill', filter: ['==', 'fcod', 'CA30'], paint: { 'fill-color': '#eef1f8' } },
    {
      id: 'pg_ground',
      type: 'fill',
      minzoom: 13,
      filter: ['in', 'fcod', 'IC01', 'IA13', 'FC01', 'FC02', 'IC03'],
      paint: { 'fill-color': '#cde093' },
    },
  );

  emit('ln_line', {
    id: 'ln_line_river',
    type: 'line',
    minzoom: 8,
    filter: ['==', 'fcod', 'DA01'],
    paint: { 'line-color': '#98c0f4', 'line-width': roadWidth(1, [[0, 0.9], [22, 2]]) },
  });

  emit(
    'ln_railway',
    {
      id: 'ln_railway',
      type: 'line',
      minzoom: 12,
      filter: ['==', 'fcod', 'EA01'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#b66', 'line-width': roadWidth(1, [[0, 0.5], [22, 4.2]]) },
    },
    {
      id: 'ln_railway_tunnel',
      type: 'line',
      minzoom: 12,
      filter: ['==', 'fcod', 'EB03'],
      paint: {
        'line-offset': { stops: [[12, 0], [22, 8]] },
        'line-dasharray': [3, 2],
        'line-width': 2,
        'line-color': '#88909f',
      },
    },
    {
      id: 'ln_railway_bridge',
      type: 'line',
      minzoom: 12,
      filter: ['==', 'fcod', 'EB01'],
      paint: { 'line-width': roadWidth(1, [[0, 0.5], [22, 5.2]]), 'line-color': '#b66' },
    },
  );

  emit('pg_road', {
    id: 'pg_road',
    type: 'fill',
    minzoom: 15,
    paint: { 'fill-color': '#fff' },
  });

  emit('ln_road1', {
    id: 'ln_road1',
    type: 'line',
    minzoom: 10,
    paint: { 'line-color': '#afa26a', 'line-width': roadWidth(1, [[0, 0.9], [22, 7]]) },
  });

  emit('ln_road2', {
    id: 'ln_road2',
    type: 'line',
    minzoom: 12,
    paint: { 'line-color': '#98a0af', 'line-width': roadWidth(1, [[0, 0.8], [22, 6]]) },
  });

  emit(
    'ln_road_outline',
    {
      id: 'ln_road_bridge_outline',
      type: 'line',
      minzoom: 15,
      filter: ['==', 'fcod', 'ED02'],
      paint: { 'line-color': '#88909f', 'line-width': roadWidth(1, [[0, 0.5], [22, 1]]) },
    },
    {
      id: 'ln_road_tunnel_outline',
      type: 'line',
      minzoom: 15,
      filter: ['==', 'fcod', 'ED11'],
      paint: {
        'line-color': '#88909f',
        'line-dasharray': [5, 2],
        'line-width': roadWidth(1, [[0, 0.5], [22, 1]]),
      },
    },
    {
      id: 'ln_road_outline',
      type: 'line',
      minzoom: 15,
      filter: ['in', 'fcod', 'EC03', 'EC04'],
      paint: { 'line-color': '#d9d3c9', 'line-width': roadWidth(1, [[0, 0.5], [22, 1]]) },
    },
  );

  emit(
    'pg_building',
    {
      id: 'pg_building',
      type: 'fill',
      minzoom: 13,
      paint: {
        'fill-color': '#ffffff',
        'fill-outline-color': '#d8dbe2',
        'fill-opacity': { base: 1.2, stops: [[14.5, 1], [14.6, 0.5], [14.7, 0]] },
      },
    },
    {
      id: 'pg_building_1',
      type: 'fill-extrusion',
      minzoom: 14.5,
      paint: {
        'fill-extrusion-color': '#f7faff',
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'hei'],
        'fill-extrusion-opacity': { stops: [[16, 0.8], [19, 0.4]] },
      },
    },
  );

  emit(
    'ln_line',
    {
      id: 'ln_line_bridge',
      type: 'line',
      minzoom: 15,
      filter: ['==', 'fcod', 'ED02'],
      paint: { 'line-color': '#88909f' },
    },
    {
      id: 'ln_line_ground',
      type: 'line',
      minzoom: 13,
      filter: ['==', 'fcod', 'GC01'],
      paint: { 'line-color': '#bbb' },
    },
    {
      id: 'ln_line_playground',
      type: 'line',
      minzoom: 13,
      filter: ['in', 'fcod', 'IC03'],
      paint: { 'line-color': '#eee' },
    },
  );

  emit('ln_river_string', {
    id: 'ln_river_string',
    type: 'symbol',
    minzoom: 14,
    filter: ['==', 'fcod', 'DA01'],
    layout: {
      'text-font': [FONT],
      'text-field': ['coalesce', ['get', 'name'], ''],
      'text-size': 16,
      'symbol-spacing': 300,
      'symbol-placement': 'line',
      'text-letter-spacing': 2,
      'text-rotate': -1,
    },
    paint: { 'text-color': '#0050A4' },
  });

  emit('pt_area', {
    id: 'pt_area',
    type: 'symbol',
    minzoom: 10,
    filter: ['==', 'fcod', 'GA04'],
    layout: {
      'text-font': [FONT],
      'text-field': ['coalesce', ['get', 'name'], ''],
      'text-size': 16,
    },
    paint: { 'text-color': '#3a6060', 'text-halo-color': '#eee', 'text-halo-width': 0.5, 'text-halo-blur': 1 },
  });

  const objectLayer = (id: string, minzoom: number) => ({
    id: `pt_obj_${id.slice(-1)}`,
    type: 'symbol',
    minzoom,
    layout: {
      'text-font': [FONT],
      'text-field': ['coalesce', ['get', 'name'], ''],
      'text-size': 14,
      'text-offset': [0, 1],
      'text-anchor': 'top',
      'text-optional': true,
      'icon-image': ['get', 'symbol'],
    },
    paint: {
      'text-color': {
        property: 'color',
        stops: [
          [4, '#0050A4'],
          [12, '#0050A4'],
          [32, '#45483c'],
          [33, '#ec008c'],
          [35, '#0087FF'],
        ],
      },
      'text-halo-color': '#fff',
      'text-halo-width': 0.5,
      'text-halo-blur': 1,
    },
  });
  emit('pt_obj1', objectLayer('pt_obj1', 11));
  emit('pt_obj2', objectLayer('pt_obj2', 12));
  emit('pt_obj3', objectLayer('pt_obj3', 14));
  emit('pt_obj4', objectLayer('pt_obj4', 15));

  emit('ln_city_rect', { id: 'ln_city_rect', type: 'line', paint: { 'line-color': '#232' } });

  // Anything newer than the reference style still gets a readable fallback.
  for (const id of vectorLayers) {
    if (used.has(id)) continue;
    if (id.startsWith('pg_')) {
      layers.push({
        id: `base-${id}`,
        source: 'base',
        'source-layer': id,
        type: 'fill',
        paint: { 'fill-color': '#eef1f8', 'fill-outline-color': '#d8dbe2' },
      });
    } else if (id.startsWith('ln_')) {
      layers.push({
        id: `base-${id}`,
        source: 'base',
        'source-layer': id,
        type: 'line',
        paint: { 'line-color': '#bbb' },
      });
    } else {
      layers.push({
        id: `base-${id}`,
        source: 'base',
        'source-layer': id,
        type: 'circle',
        paint: { 'circle-radius': 2.5, 'circle-color': '#45483c' },
      });
    }
  }

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
    layers,
  };
}
