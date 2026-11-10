import * as THREE from 'three';

/** Every polywog gets a job from its shape, and stats from its own shape too, so two polywogs with the same job still differ.
 *  A kid can always change the job; the stats always come from the model. */
export type Job = 'courier' | 'keeper' | 'fan' | 'bridge';
export const JOBS: Record<Job, { label: string; does: string }> = {
  courier: { label: 'Courier', does: 'Carries fireflies along the glowing threads.' },
  keeper: { label: 'Keeper', does: "Stores the island's memories in neat rows." },
  fan: { label: 'Fan', does: 'Keeps the heart-tree cool.' },
  bridge: { label: 'Bridge', does: 'Joins up with another bridge to link islands.' },
};
export const JOB_ORDER: Job[] = ['courier', 'keeper', 'fan', 'bridge'];

/** Shape measurements of an upright (Y-up) model, all scale-free except size. */
export interface Shape {
  size: number;     // longest side, in world units
  long: number;     // longest side / middle side: 1 = chunky, bigger = long and thin
  flat: number;     // shortest side / middle side: near 0 = flat as a tag (a thin stick is not flat: its two short sides match)
  fill: number;     // the model's volume / its box's volume: 1 = a solid block
  pointy: number;   // how spread out its surface is from the middle, plus how much air is in its box: higher = spikier
}
export interface Stats { speed: number; bounce: number; stamina: number }   // 1..10 each; all three change how it moves today

export function measure(g: THREE.BufferGeometry): Shape {
  g.computeBoundingBox(); const box = g.boundingBox!, mid = box.getCenter(new THREE.Vector3());
  const e = box.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a);
  const p = g.getAttribute('position'), idx = g.getIndex(), n = idx ? idx.count : p.count, at = (i: number) => (idx ? idx.getX(i) : i);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), AB = new THREE.Vector3(), AC = new THREE.Vector3(), cen = new THREE.Vector3();
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));   // per-side, so being long or flat doesn't count as pointy
  let vol = 0, area = 0, sr = 0, sr2 = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    A.fromBufferAttribute(p, at(i)); B.fromBufferAttribute(p, at(i + 1)); C.fromBufferAttribute(p, at(i + 2));
    vol += A.dot(AB.copy(B).cross(C)) / 6;                                         // signed volume, so closed meshes sum to their volume
    const ar = AB.copy(B).sub(A).cross(AC.copy(C).sub(A)).length() / 2; area += ar;
    const r = cen.copy(A).add(B).add(C).divideScalar(3).sub(mid).divide(half).length(); sr += r * ar; sr2 += r * r * ar;
  }
  const mean = area > 0 ? sr / area : 0, spread = mean > 0 ? Math.sqrt(Math.max(0, sr2 / area - mean * mean)) / mean : 0;
  const fill = Math.min(1, Math.abs(vol) / Math.max(1e-9, e[0] * e[1] * e[2]));
  return { size: e[0], long: e[0] / Math.max(1e-9, e[1]), flat: e[2] / Math.max(1e-9, e[1]), fill, pointy: spread + (1 - fill) * 0.3 };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** How strongly a shape suits each job, 0..1, from weighted shape features. The best score wins, so every feature counts,
 *  not just the first rule that matches. */
export const WEIGHTS = {
  bridge: { flat: 1 },                      // flat as a tag
  courier: { long: 0.8, slim: 0.2 },        // long and thin
  fan: { pointy: 0.8, airy: 0.2 },          // pointy and spiky, with air between its points
  keeper: { chunky: 0.6, solid: 0.4 },      // chunky and solid; also what's left when nothing else fits
};
export function scores(s: Shape): Record<Job, number> {
  const W = WEIGHTS, flat = clamp01(1 - s.flat / 0.4), long = clamp01((s.long - 1.15) / 0.9), slim = clamp01(1 - s.flat), pointy = clamp01((s.pointy - 0.22) / 0.35);
  const chunky = clamp01(1 - long) * clamp01(1 - flat) * clamp01(1 - pointy), solid = clamp01(s.fill);
  return {
    bridge: W.bridge.flat * flat,
    courier: W.courier.long * long + W.courier.slim * slim * long,
    fan: W.fan.pointy * pointy + W.fan.airy * clamp01(1 - s.fill) * pointy,
    keeper: Math.max(0.3, W.keeper.chunky * chunky + W.keeper.solid * solid * chunky),   // never below 0.3: the safe default
  };
}

/** What the island needs: the mix it would like, and how hard a shortage nudges a close call. A nudge never beats a clear shape. */
export const NEEDS = { mix: { courier: 0.35, keeper: 0.35, fan: 0.15, bridge: 0.15 } as Record<Job, number>, nudge: 0.3, lonelyBridge: 0.15 };
/** The job for a new polywog, given the jobs already on the island. Same shape + same island = same job on every device. */
export function jobFor(s: Shape, island: Job[] = []): Job {
  const sc = scores(s), total = island.length, best = { job: 'keeper' as Job, score: -Infinity };
  for (const j of JOB_ORDER) {                                           // fixed order, so ties always break the same way
    const share = total ? island.filter((x) => x === j).length / total : NEEDS.mix[j];
    let v = sc[j] + (total ? NEEDS.nudge * (NEEDS.mix[j] - share) : 0);
    if (j === 'bridge' && island.filter((x) => x === 'bridge').length % 2 === 1) v += NEEDS.lonelyBridge;   // a bridge on its own needs a partner
    if (v > best.score) { best.job = j; best.score = v; }
  }
  return best.job;
}

const stat = (v: number) => Math.max(1, Math.min(10, Math.round(1 + clamp01(v) * 9)));
/** Speed: long, slim and small is fast. Bounce: light (airy) and round bounces. Stamina: solid and chunky keeps going. */
export function statsFor(s: Shape): Stats {
  const small = 1 - clamp01((s.size - 0.5) / 1.5);
  return {
    speed: stat(0.25 + 0.45 * clamp01((s.long - 1) / 1.5) + 0.3 * small - 0.2 * s.fill),
    bounce: stat(0.15 + 0.55 * (1 - s.fill) + 0.3 * (1 - clamp01(s.pointy * 2))),
    stamina: stat(0.1 + 0.7 * s.fill + 0.2 * clamp01(s.flat)),
  };
}
