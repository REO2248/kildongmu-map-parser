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
