import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { describe, expect, it } from 'vitest';
import { CREATURE, bodyHeight, creatureModel } from './creature';
import { jobFor, measure } from './roles';

// Integration: real STL bytes, laid out the way Tinkercad exports them (Z up, millimetres), through the real import code.
const stl = (w: number, d: number, h: number, ascii = false): ArrayBuffer => {
  const g = new THREE.BoxGeometry(w, d, h); g.translate(0, 0, h / 2);            // Tinkercad: sits on z = 0, height along z
  const out = new STLExporter().parse(new THREE.Mesh(g), { binary: !ascii }) as DataView | string;
  if (typeof out === 'string') return new TextEncoder().encode(out).buffer as ArrayBuffer;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-3);

describe('importing a Tinkercad STL', () => {
  it("Tinkercad's 20 mm box comes out 1 unit tall, standing on the ground and centred", () => {
    const m = creatureModel(stl(20, 20, 20)); m.geo.computeBoundingBox(); const b = m.geo.boundingBox!;
    near(m.size.y, 1); near(b.min.y, 0); near((b.min.x + b.max.x) / 2, 0); near((b.min.z + b.max.z) / 2, 0);
  });
  it('a tall pole (60 mm up in Tinkercad) stands upright and becomes a courier', () => {
    const m = creatureModel(stl(10, 10, 60));
    expect(m.size.y).toBeGreaterThan(m.size.x * 4); expect(jobFor(measure(m.geo))).toBe('courier');
  });
  it('a flat name tag (1 mm thick in Tinkercad) lies flat and becomes a bridge', () => {
    const m = creatureModel(stl(50, 50, 1));
    expect(m.size.y).toBeLessThan(m.size.x / 20); expect(jobFor(measure(m.geo))).toBe('bridge');
    expect(bodyHeight(m)).toBeGreaterThanOrEqual(0.25 * m.size.x);              // so it still wakes up and walks at a sensible pace
  });
  it('reads text (ASCII) STL files too', () => near(creatureModel(stl(20, 20, 20, true)).size.y, 1));
  it('keeps tiny and huge models creature-sized', () => {
    near(creatureModel(stl(2, 2, 2)).size.y, CREATURE.minSize);
    near(creatureModel(stl(500, 500, 500)).size.y, CREATURE.maxSize);
  });
});

describe('bad files are turned away with a message a kid can read', () => {
  it('an empty file', () => expect(() => creatureModel(new ArrayBuffer(0))).toThrow("doesn't look like an STL"));
  it('a text file that is not an STL', () => expect(() => creatureModel(new TextEncoder().encode('hello, not a model').buffer as ArrayBuffer)).toThrow());
  it('a model with no size (every point in one place)', () => {
    const b = new ArrayBuffer(84 + 50); new DataView(b).setUint32(80, 1, true);
    expect(() => creatureModel(b)).toThrow('no size');
  });
});
