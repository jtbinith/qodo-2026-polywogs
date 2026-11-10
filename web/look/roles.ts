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
  let vol = 0, area = 0, sr = 0, sr2 = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    A.fromBufferAttribute(p, at(i)); B.fromBufferAttribute(p, at(i + 1)); C.fromBufferAttribute(p, at(i + 2));
    vol += A.dot(AB.copy(B).cross(C)) / 6;                                         // signed volume, so closed meshes sum to their volume
    const ar = AB.copy(B).sub(A).cross(AC.copy(C).sub(A)).length() / 2; area += ar;
    const r = cen.copy(A).add(B).add(C).divideScalar(3).distanceTo(mid) / e[0]; sr += r * ar; sr2 += r * r * ar;
  }
  const mean = area > 0 ? sr / area : 0, spread = mean > 0 ? Math.sqrt(Math.max(0, sr2 / area - mean * mean)) / mean : 0;
  const fill = Math.min(1, Math.abs(vol) / Math.max(1e-9, e[0] * e[1] * e[2]));
  return { size: e[0], long: e[0] / Math.max(1e-9, e[1]), flat: e[2] / Math.max(1e-9, e[1]), fill, pointy: spread + (1 - fill) * 0.3 };
}

/** The rules, in order: flat things are bridges, long things couriers, pointy things fans, everything else keepers. */
export const RULES = { bridgeFlat: 0.2, courierLong: 1.6, fanPointy: 0.4 };
export function jobFor(s: Shape): Job {
  if (s.flat < RULES.bridgeFlat) return 'bridge';
  if (s.long >= RULES.courierLong) return 'courier';
  if (s.pointy >= RULES.fanPointy) return 'fan';
  return 'keeper';
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v)), stat = (v: number) => Math.max(1, Math.min(10, Math.round(1 + clamp01(v) * 9)));
/** Speed: long, slim and small is fast. Bounce: light (airy) and round bounces. Stamina: solid and chunky keeps going. */
export function statsFor(s: Shape): Stats {
  const small = 1 - clamp01((s.size - 0.5) / 1.5);
  return {
    speed: stat(0.25 + 0.45 * clamp01((s.long - 1) / 1.5) + 0.3 * small - 0.2 * s.fill),
    bounce: stat(0.15 + 0.55 * (1 - s.fill) + 0.3 * (1 - clamp01(s.pointy * 2))),
    stamina: stat(0.1 + 0.7 * s.fill + 0.2 * clamp01(s.flat)),
  };
}
