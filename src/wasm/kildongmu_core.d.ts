/* tslint:disable */
/* eslint-disable */

export class Package {
    free(): void;
    [Symbol.dispose](): void;
    city_db(iterations: number): Uint8Array;
    city_key(): string | undefined;
    decrypt(name: string, passphrase: string, iterations: number): Uint8Array;
    entry(name: string): Uint8Array | undefined;
    geo_db(product_id: number, iterations: number): Uint8Array;
    has(name: string): boolean;
    map_db(iterations: number): Uint8Array;
    map_key(): string | undefined;
    /**
     * Entry names as a JSON array of strings.
     */
    names(): string;
    constructor(data: Uint8Array);
    /**
     * City name used to derive the key, taken from the city db entry name.
     */
    readonly alias: string | undefined;
    readonly version: number;
}

/**
 * Decode one SpatiaLite geometry blob to a GeoJSON geometry JSON string.
 */
export function decode_geometry(blob: Uint8Array): string | undefined;

export function derive_city_key(alias: string): string;

export function derive_geo_key(product_id: number): string;

export function derive_map_key(alias: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_package_free: (a: number, b: number) => void;
    readonly decode_geometry: (a: number, b: number) => [number, number];
    readonly derive_city_key: (a: number, b: number) => [number, number];
    readonly derive_geo_key: (a: number) => [number, number];
    readonly derive_map_key: (a: number, b: number) => [number, number];
    readonly package_alias: (a: number) => [number, number];
    readonly package_city_db: (a: number, b: number) => [number, number, number, number];
    readonly package_city_key: (a: number) => [number, number];
    readonly package_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly package_entry: (a: number, b: number, c: number) => [number, number];
    readonly package_geo_db: (a: number, b: number, c: number) => [number, number, number, number];
    readonly package_has: (a: number, b: number, c: number) => number;
    readonly package_map_db: (a: number, b: number) => [number, number, number, number];
    readonly package_map_key: (a: number) => [number, number];
    readonly package_names: (a: number) => [number, number];
    readonly package_new: (a: number, b: number) => [number, number, number];
    readonly package_version: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
