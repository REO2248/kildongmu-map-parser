import { useCallback, useEffect, useRef, useState } from 'react';
import MapView, { type PickedFeature } from './components/MapView';
import { loadCity, type LoadedCity } from './lib/pipeline';

type Status =
  | { state: 'idle' }
  | { state: 'loading'; step: string }
  | { state: 'ready' }
  | { state: 'error'; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [loaded, setLoaded] = useState<LoadedCity | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<PickedFeature[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef<LoadedCity | null>(null);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
      loadedRef.current?.dispose();
    };
  }, []);

  const open = useCallback(async (file: File) => {
    setStatus({ state: 'loading', step: 'parse' });
    setPicked([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const next = await loadCity(file, (step) => setStatus({ state: 'loading', step }));
      loadedRef.current?.dispose();
      if (import.meta.env.DEV) (window as unknown as { __style?: unknown }).__style = next.style;
      setLoaded(next);
      setVisibility(Object.fromEntries(next.overlays.map((o) => [o.table, o.kind !== 'circle'])));
      setStatus({ state: 'ready' });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) void open(file);
    },
    [open],
  );

  const reset = useCallback(() => {
    loadedRef.current?.dispose();
    setLoaded(null);
    setPicked([]);
    setVisibility({});
    setStatus({ state: 'idle' });
  }, []);

  return (
    <div
      className="relative h-full w-full select-none bg-[#0b0d10] text-white"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {loaded && (
        <MapView city={loaded} visibility={visibility} onPick={setPicked} />
      )}

      {!loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group flex flex-col items-center gap-4 outline-none"
          >
            <span className="grid h-28 w-28 place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[0.03] text-white/50 transition group-hover:border-cyan-300/60 group-hover:text-cyan-200">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="m7 14 5 5 5-5" />
                <path d="M4 21h16" />
              </svg>
            </span>
            <span className="text-[11px] font-semibold tracking-[0.45em] text-white/35 transition group-hover:text-white/60">
              DAT
            </span>
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".dat,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void open(file);
          e.target.value = '';
        }}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-cyan-300/50 bg-cyan-400/5">
          <div className="text-[11px] font-semibold tracking-[0.45em] text-cyan-100/80">DAT</div>
        </div>
      )}

      {status.state === 'loading' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50">
          <div className="h-0.5 w-full overflow-hidden bg-white/10">
            <div className="h-full w-full animate-pulse bg-cyan-400" />
          </div>
          <div className="mt-2 text-center text-[10px] uppercase tracking-[0.3em] text-white/50">
            {status.step}
          </div>
        </div>
      )}

      {loaded && (
        <>
          <div className="panel absolute left-3 top-3 z-30 rounded-xl px-3.5 py-2.5">
            <div className="text-[14px] font-semibold leading-tight">{loaded.city.city}</div>
            <div className="mt-0.5 text-[11px] text-white/45">{loaded.city.province}</div>
            <div className="mt-1.5 flex gap-2.5 text-[10px] text-white/35">
              <span>#{loaded.city.id}</span>
              <span>{loaded.city.alias}</span>
              <span>{loaded.overlays.reduce((n, o) => n + o.count, 0)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={reset}
            title="Load another file"
            className="panel absolute right-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-lg text-white/50 transition hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>

          <div className="panel absolute bottom-14 left-3 z-30 flex flex-col gap-1 rounded-xl p-1.5">
            {loaded.overlays.map((o) => {
              const on = !!visibility[o.table];
              return (
                <button
                  key={o.table}
                  type="button"
                  title={o.table}
                  onClick={() =>
                    setVisibility((v) => ({ ...v, [o.table]: !v[o.table] }))
                  }
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition ${
                    on ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/60'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      background: o.color,
                      opacity: on ? 1 : 0.35,
                      boxShadow: on ? `0 0 8px ${o.color}55` : 'none',
                    }}
                  />
                  <span className="tabular-nums">{o.count}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {picked.length > 0 && (
        <div className="panel scroll-thin absolute right-3 top-16 z-30 max-h-[60vh] w-72 overflow-auto rounded-xl p-3 text-[11px]">
          <button
            type="button"
            onClick={() => setPicked([])}
            className="absolute right-2 top-2 text-white/30 hover:text-white"
            title="Close"
          >
            ✕
          </button>
          {picked.map((feature, index) => (
            <div
              key={index}
              className="mb-2.5 border-b border-white/5 pb-2 last:mb-0 last:border-0 last:pb-0"
            >
              <div className="mb-1 pr-5 text-[10px] uppercase tracking-wider text-cyan-200/50">
                {feature.sourceLayer || feature.layer}
              </div>
              {Object.entries(feature.properties)
                .filter(([, value]) => typeof value !== 'object')
                .slice(0, 16)
                .map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-3 py-px">
                    <span className="shrink-0 text-white/35">{key}</span>
                    <span className="truncate text-right text-white/85">{String(value)}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {status.state === 'error' && (
        <div className="panel absolute bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-xl px-4 py-3 text-[11px] text-red-200">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-400" />
          <span className="break-all">{status.message}</span>
          <button
            type="button"
            onClick={() => setStatus(loaded ? { state: 'ready' } : { state: 'idle' })}
            className="ml-2 shrink-0 text-red-200/50 hover:text-red-100"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
