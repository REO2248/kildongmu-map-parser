import init, { Package, decode_geometry } from '../wasm/kildongmu_core';

let pending: Promise<void> | undefined;

export function initWasm(): Promise<void> {
  pending ??= init().then(() => undefined);
  return pending;
}

export { Package, decode_geometry };
