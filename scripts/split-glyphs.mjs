// Splits the single-range glyph PBF shipped in the APK ("0-65535.pbf") into
// the 256-codepoint chunks MapLibre requests via the {range} token.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'assets-src/fonts/Gothic/0-65535.pbf');
const outDir = join(root, 'public/fonts/Gothic');

function readVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  while (true) {
    const byte = buf[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, offset];
    shift += 7;
  }
}

function writeVarint(value) {
  const out = [];
  while (value > 0x7f) {
    out.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  out.push(value);
  return Buffer.from(out);
}

function field(tag, wire, payload) {
  return Buffer.concat([writeVarint((tag << 3) | wire), payload]);
}

function lengthField(tag, payload) {
  return field(tag, 2, Buffer.concat([writeVarint(payload.length), payload]));
}

function splitMessage(buf) {
  const fields = [];
  let offset = 0;
  while (offset < buf.length) {
    let key;
    [key, offset] = readVarint(buf, offset);
    const tag = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      const start = offset;
      let value;
      [value, offset] = readVarint(buf, offset);
      const raw = Buffer.concat([writeVarint(key), buf.subarray(start, offset)]);
      fields.push({ tag, raw, value });
      continue;
    }
    if (wire !== 2) throw new Error(`unsupported wire type ${wire}`);
    let len;
    [len, offset] = readVarint(buf, offset);
    const payload = buf.subarray(offset, offset + len);
    offset += len;
    const raw = Buffer.concat([writeVarint(key), writeVarint(len), payload]);
    fields.push({ tag, raw, payload });
  }
  return fields;
}

const file = await readFile(source);
const top = splitMessage(file);
const wrapper = top.find((f) => f.tag === 1);
if (!wrapper) throw new Error('unexpected glyph container');
const inner = splitMessage(wrapper.payload);
const name = inner.find((f) => f.tag === 1)?.raw;
if (!name) throw new Error('missing font name');

const ranges = new Map();
for (const f of inner) {
  if (f.tag !== 3) continue;
  const glyphFields = splitMessage(f.payload);
  const id = glyphFields.find((g) => g.tag === 1);
  if (!id) throw new Error('glyph without id');
  const code = id.value;
  const range = code >>> 8;
  if (!ranges.has(range)) ranges.set(range, []);
  ranges.get(range).push(f.raw);
}

await mkdir(outDir, { recursive: true });
for (const entry of await readdir(outDir)) {
  if (entry !== '.gitkeep') await rm(join(outDir, entry), { force: true });
}

let total = 0;
for (let range = 0; range < 256; range += 1) {
  const glyphs = ranges.get(range) ?? [];
  total += glyphs.length;
  const body = Buffer.concat([
    name,
    lengthField(2, Buffer.from(`${range * 256}-${range * 256 + 255}`)),
    ...glyphs,
  ]);
  const file_ = lengthField(1, body);
  await writeFile(join(outDir, `${range * 256}-${range * 256 + 255}.pbf`), file_);
}

console.log(`glyph ranges: ${ranges.size}, glyphs: ${total}`);
