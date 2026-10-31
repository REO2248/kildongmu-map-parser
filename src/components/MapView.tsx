import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { LoadedCity, Overlay } from '../lib/pipeline';
import { installTileProtocol, releaseTileDb, useTileDb } from '../lib/tiles';

export interface PickedFeature {
  layer: string;
  sourceLayer: string;
  properties: Record<string, unknown>;
}

interface Props {
  city: LoadedCity;
  visibility: Record<string, boolean>;
  onPick: (features: PickedFeature[]) => void;
}

const layerId = (o: Overlay) => `geo-${o.table}`;

const LABELS: Record<
  string,
  { field: string; minzoom: number; size: number; color: string; offset?: [number, number] }
> = {
  pg_area: { field: 'name', minzoom: 12, size: 13, color: '#3a6060' },
  pt_area: { field: 'name', minzoom: 12, size: 13, color: '#3a6060' },
  pt_obj: { field: 'name', minzoom: 14, size: 12, color: '#333333', offset: [0, 1] },
  pt_ban: { field: 'ban', minzoom: 16, size: 10, color: '#5b6472' },
};

function overlayLayers(o: Overlay) {
  const id = layerId(o);
  const layers: any[] = [];
  if (o.kind === 'line') {
    layers.push({
      id,
      type: 'line' as const,
      source: id,
      paint: { 'line-color': o.color, 'line-width': 1.8, 'line-opacity': 0.9 },
    });
  } else if (o.kind === 'fill') {
    layers.push({
      id,
      type: 'fill' as const,
      source: id,
      paint: {
        'fill-color': o.color,
        'fill-opacity': 0.22,
        'fill-outline-color': o.color,
      },
    });
  } else {
    layers.push({
      id,
      type: 'circle' as const,
      source: id,
      paint: {
        'circle-color': o.color,
        'circle-radius': 3,
        'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 0.7,
      },
    });
  }
  const label = LABELS[o.table];
  if (label) {
    layers.push({
      id: `${id}-label`,
      type: 'symbol' as const,
      source: id,
      minzoom: label.minzoom,
      layout: {
        'text-font': ['Gothic'],
        'text-field': ['to-string', ['coalesce', ['get', label.field], '']],
        'text-size': label.size,
        'text-offset': label.offset ?? [0, 0.6],
        'text-anchor': label.offset ? 'top' : 'bottom',
      },
      paint: {
        'text-color': label.color,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    });
  }
  return layers;
}

function applyVisibility(map: maplibregl.Map, overlays: Overlay[], visibility: Record<string, boolean>) {
  for (const o of overlays) {
    const ids = [layerId(o), `${layerId(o)}-label`];
    for (const id of ids) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, 'visibility', visibility[o.table] ? 'visible' : 'none');
    }
  }
}

export default function MapView({ city, visibility, onPick }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [tilted, setTilted] = useState(false);
  const visibilityRef = useRef(visibility);
  const pickRef = useRef(onPick);
  visibilityRef.current = visibility;
  pickRef.current = onPick;

  useEffect(() => {
    installTileProtocol();
    // Vite's dev transform cannot serve maplibre's worker chunk reliably, so
    // the worker is served verbatim from public/.
    maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);
    if (city.mapDb) useTileDb(city.mapDb);

    const map = new maplibregl.Map({
      container: holder.current!,
      style: city.style,
      center: city.city.center,
      zoom: 13,
      minZoom: 5,
      maxZoom: 19,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) {
      const debug = window as unknown as { __map?: maplibregl.Map; __ml?: typeof maplibregl; __mapErrors?: string[] };
      debug.__map = map;
      debug.__ml = maplibregl;
      debug.__mapErrors = [];
      map.on('error', (event) => debug.__mapErrors?.push(String(event.error ?? event)));
    }
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      'bottom-right',
    );
    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      for (const o of city.overlays) {
        map.addSource(layerId(o), { type: 'geojson', data: o.data });
        for (const layer of overlayLayers(o)) map.addLayer(layer);
      }
      applyVisibility(map, city.overlays, visibilityRef.current);

      const [[minX, minY], [maxX, maxY]] = city.city.bounds;
      if (maxX > minX && maxY > minY) {
        map.fitBounds([minX, minY, maxX, maxY], { padding: 48, duration: 0 });
      }
    });

    map.on('click', (event: maplibregl.MapMouseEvent) => {
      const seen = new Set<string>();
      const picked: PickedFeature[] = [];
      for (const feature of map.queryRenderedFeatures(event.point)) {
        if (feature.layer.id.endsWith('-label')) continue;
        const properties = feature.properties ?? {};
        if (!Object.keys(properties).length) continue;
        const key = `${feature.layer.id}/${feature.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push({
          layer: feature.layer.id,
          sourceLayer: (feature as unknown as { sourceLayer?: string }).sourceLayer ?? '',
          properties: { ...properties },
        });
        if (picked.length >= 6) break;
      }
      pickRef.current(picked);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      releaseTileDb();
    };
  }, [city]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => applyVisibility(map, city.overlays, visibility);
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [visibility, city]);

  const toggleTilt = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = map.getPitch() > 10 ? 0 : 55;
    map.easeTo({ pitch: next, duration: 600 });
    setTilted(next > 0);
  };

  // The map container needs an explicit height: maplibre's own
  // `.maplibregl-map { position: relative }` overrides the absolute inset.
  return (
    <div className="absolute inset-0">
      <div ref={holder} className="h-full w-full" />
      <button
        type="button"
        onClick={toggleTilt}
        title="3D"
        className={`panel absolute bottom-28 right-3 z-30 grid h-9 w-9 place-items-center rounded-lg text-[10px] font-semibold tracking-wider transition ${
          tilted ? 'text-cyan-200' : 'text-white/50 hover:text-white'
        }`}
      >
        3D
      </button>
    </div>
  );
}
