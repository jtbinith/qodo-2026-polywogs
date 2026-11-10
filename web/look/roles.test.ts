import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FILL, fillOf, jobFor, measure, scores, statsFor, type Job, type Shape } from './roles';

const job = (g: THREE.BufferGeometry) => jobFor(measure(g));

describe('job from shape', () => {
  it('a chunky block is a keeper', () => expect(job(new THREE.BoxGeometry(1, 1, 1))).toBe('keeper'));
  it('a ball is a keeper', () => expect(job(new THREE.SphereGeometry(0.5, 32, 16))).toBe('keeper'));
  it('a long, thin stick is a courier', () => expect(job(new THREE.BoxGeometry(3, 0.6, 0.6))).toBe('courier'));
  it('a flat tag is a bridge', () => expect(job(new THREE.BoxGeometry(2, 0.1, 2))).toBe('bridge'));
  it('a cone is a fan', () => expect(job(new THREE.ConeGeometry(0.5, 1, 32))).toBe('fan'));
});

describe('stats from shape', () => {
  it('are whole numbers from 1 to 10', () => {
    for (const g of [new THREE.BoxGeometry(1, 1, 1), new THREE.ConeGeometry(0.5, 1, 32), new THREE.BoxGeometry(2, 0.05, 2), new THREE.BoxGeometry(9, 0.1, 0.1)])
      for (const v of Object.values(statsFor(measure(g)))) { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); }
  });
  it('differ between two models with the same job', () => {
    const slim = statsFor(measure(new THREE.BoxGeometry(3, 0.4, 0.4))), stubby = statsFor(measure(new THREE.BoxGeometry(3, 1.6, 1.6)));
    expect(jobFor(measure(new THREE.BoxGeometry(3, 0.4, 0.4)))).toBe('courier'); expect(jobFor(measure(new THREE.BoxGeometry(3, 1.6, 1.6)))).toBe('courier');
    expect(slim.speed).toBeGreaterThan(stubby.speed);
  });
  it('a ball bounces more than a block or a cone', () => {
    const ball = statsFor(measure(new THREE.SphereGeometry(0.5, 32, 16))).bounce;
    expect(ball).toBeGreaterThan(statsFor(measure(new THREE.BoxGeometry(1, 1, 1))).bounce); expect(ball).toBeGreaterThan(statsFor(measure(new THREE.ConeGeometry(0.5, 1, 32))).bounce);
  });
  it('a solid block has more stamina than an airy cone', () =>
    expect(statsFor(measure(new THREE.BoxGeometry(1, 1, 1))).stamina).toBeGreaterThan(statsFor(measure(new THREE.ConeGeometry(0.5, 1, 32))).stamina));
  it('the same model always gets the same result', () => {
    const a = measure(new THREE.TorusGeometry(1, 0.3, 16, 48)), b = measure(new THREE.TorusGeometry(1, 0.3, 16, 48));
    expect(jobFor(a)).toBe(jobFor(b)); expect(statsFor(a)).toEqual(statsFor(b));
  });
});

describe('weighted scores', () => {
  it('are all between 0 and 1', () => {
    for (const g of [new THREE.BoxGeometry(1, 1, 1), new THREE.ConeGeometry(0.5, 1, 32), new THREE.BoxGeometry(2, 0.05, 2), new THREE.BoxGeometry(9, 0.1, 0.1)])
      for (const v of Object.values(scores(measure(g)))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('a broken measurement (NaN) safely becomes a keeper', () => {
    const broken: Shape = { size: NaN, long: NaN, flat: NaN, fill: NaN, pointy: NaN };
    expect(jobFor(broken)).toBe('keeper');
    for (const v of Object.values(statsFor(broken))) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('what the island needs', () => {
  // a borderline shape: a bit long, a bit chunky (courier and keeper score close)
  const borderline: Shape = { size: 1, long: 1.55, flat: 0.8, fill: 0.7, pointy: 0.15 };
  const keepers = (n: number): Job[] => Array(n).fill('keeper');
  it('the first polywog is judged on its shape alone', () => expect(jobFor(borderline, [])).toBe(jobFor(borderline)));
  it('a close call tips towards a job the island is short of', () => {
    const lots = jobFor(borderline, keepers(6)), none = jobFor(borderline, ['courier', 'courier', 'courier', 'courier']);
    expect(lots).toBe('courier'); expect(none).toBe('keeper');
  });
  it('a clear shape always keeps its job, however crowded that job is', () => {
    const stick = measure(new THREE.BoxGeometry(3, 0.5, 0.5)), tag = measure(new THREE.BoxGeometry(2, 0.08, 2));
    expect(jobFor(stick, Array(20).fill('courier'))).toBe('courier');
    expect(jobFor(tag, Array(20).fill('bridge'))).toBe('bridge');
  });
  it("Qodo's example: a shape that's clearly a bridge stays a bridge even with 20 bridges already", () => {
    const flatButSpiky: Shape = { size: 1, long: 1, flat: 0.04, fill: 0.5, pointy: 0.5 };      // bridge 0.9, fan 0.72 (Qodo's numbers)
    const sc = scores(flatButSpiky); expect(sc.bridge - sc.fan).toBeGreaterThan(0.15);
    expect(jobFor(flatButSpiky, Array(20).fill('bridge'))).toBe('bridge');
  });
  it('a lonely bridge makes the next borderline flat-ish model its partner', () => {
    const flatish: Shape = { size: 1, long: 1.1, flat: 0.22, fill: 0.6, pointy: 0.1 };   // bridge and keeper score within a whisker
    const couriers: Job[] = ['courier', 'courier', 'courier', 'courier'];
    expect(jobFor(flatish, couriers)).toBe('keeper');
    expect(jobFor(flatish, [...couriers, 'bridge'])).toBe('bridge');
  });
  it('ties always break the same way', () => {
    const s: Shape = { size: 1, long: 1, flat: 1, fill: 0, pointy: 0 };
    expect(new Set(Array.from({ length: 20 }, () => jobFor(s, ['fan', 'courier']))).size).toBe(1);
  });
});

describe('fullness is measured from inside the model', () => {
  const flipped = (g: THREE.BufferGeometry) => { const n = g.toNonIndexed(), p = n.getAttribute('position');   // every facet facing the wrong way
    for (let i = 0; i < p.count; i += 3) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)); p.setXYZ(i + 1, x, y, z); } return n; };
  it('a solid block is about full', () => expect(measure(new THREE.BoxGeometry(1, 1, 1)).fill).toBeGreaterThan(0.95));
  it('a ball fills about half its box', () => expect(measure(new THREE.SphereGeometry(0.5, 48, 24)).fill).toBeCloseTo(Math.PI / 6, 1));
  it('reversed facets give the same fullness', () => {
    expect(measure(flipped(new THREE.SphereGeometry(0.5, 32, 16))).fill).toBeCloseTo(measure(new THREE.SphereGeometry(0.5, 32, 16)).fill, 5);
  });
  it('overlapping parts count once (their union), not twice', () => {
    // two 1x1x1 cubes overlapping by half: union = 1.5, box = 1.5 x 1 x 1, so the box is full
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(0.5, 0, 0);
    expect(measure(mergeGeometries([a, b])!).fill).toBeGreaterThan(0.95);
    // the same cube twice in the same place is still just one cube's worth
    expect(measure(mergeGeometries([new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), new THREE.BoxGeometry(1, 1, 1).toNonIndexed()])!).fill).toBeGreaterThan(0.95);
  });
  it('two separate parts with a gap between them leave the gap empty', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(2, 0, 0);   // box 3 wide, 2 of it solid
    expect(measure(mergeGeometries([a, b])!).fill).toBeCloseTo(2 / 3, 1);
  });
});

describe('measuring stays fast and small for any accepted file', () => {
  // the worst case Qodo described: about 500k triangles (a 25 MB STL), every one a broad sliver spanning the whole model
  const slivers = (count: number) => { const pos = new Float32Array(count * 9);
    for (let t = 0; t < count; t++) { const y = (t % 1000) / 1000; pos.set([-1, y, -1, 1, y + 0.0001, -1, 0, y, 1], t * 9); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeBoundingBox(); return g; };
  it('500k broad triangles measure in under 3 seconds, within the work budget', () => {
    const g = slivers(500_000), t0 = performance.now(), f = fillOf(g, g.boundingBox!);
    expect(performance.now() - t0).toBeLessThan(3000); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(1);
  }, 20_000);
  it('a heavy model falls back to a coarser grid instead of doing unbounded work', () => {
    const g = slivers(20_000); expect(fillOf(g, g.boundingBox!)).toBeGreaterThanOrEqual(0);
    expect(FILL.grids[FILL.grids.length - 1]).toBeLessThan(FILL.grids[0]);
  });
});
