import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
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

function overlayLayer(o: Overlay) {
  const id = layerId(o);
  if (o.kind === 'line') {
    return {
      id,
      type: 'line' as const,
      source: id,
      paint: { 'line-color': o.color, 'line-width': 1.8, 'line-opacity': 0.9 },
    };
  }
  if (o.kind === 'fill') {
    return {
      id,
      type: 'fill' as const,
      source: id,
      paint: {
        'fill-color': o.color,
        'fill-opacity': 0.22,
        'fill-outline-color': o.color,
      },
    };
  }
  return {
    id,
    type: 'circle' as const,
    source: id,
    paint: {
      'circle-color': o.color,
      'circle-radius': 3,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#05070a',
      'circle-stroke-width': 0.7,
    },
  };
}

function applyVisibility(map: maplibregl.Map, overlays: Overlay[], visibility: Record<string, boolean>) {
  for (const o of overlays) {
    if (!map.getLayer(layerId(o))) continue;
    map.setLayoutProperty(layerId(o), 'visibility', visibility[o.table] ? 'visible' : 'none');
  }
}

export default function MapView({ city, visibility, onPick }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
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
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) {
      const debug = window as unknown as { __map?: maplibregl.Map; __ml?: typeof maplibregl; __mapErrors?: string[] };
      debug.__map = map;
      debug.__ml = maplibregl;
      debug.__mapErrors = [];
      map.on('error', (event) => debug.__mapErrors?.push(String(event.error ?? event)));
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      for (const o of city.overlays) {
        map.addSource(layerId(o), { type: 'geojson', data: o.data });
        map.addLayer(overlayLayer(o));
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

  // The map container needs an explicit height: maplibre's own
  // `.maplibregl-map { position: relative }` overrides the absolute inset.
  return (
    <div className="absolute inset-0">
      <div ref={holder} className="h-full w-full" />
    </div>
  );
}
