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

/** How much of its box a model fills, 0..1, by sampling inside it rather than adding up triangle volumes.
 *  Rays go straight up through a grid of columns, adding 1 going into a surface and taking 1 away coming out: anywhere the count
 *  is above zero is inside something, so overlapping or duplicated parts count once (their union), whatever corners they share.
 *  Each separate part's direction is checked by its volume, so a part with its facets reversed (inside out) still counts properly.
 *  Memory grows only with real crossings, and the work is capped by a budget (a coarser grid for heavy models), so any accepted
 *  file measures in bounded time. */
export const FILL = {
  grids: [20, 14, 10, 7],   // columns per side to try, finest first
  budget: 6_000_000,        // most triangle-in-column checks allowed for one model: keeps import time and memory bounded
  unknown: 0.5,             // fullness to assume if even the coarsest grid is over budget (a pathological file)
};
export function fillOf(g: THREE.BufferGeometry, box: THREE.Box3): number {
  const p = g.getAttribute('position'), idx = g.getIndex(), n = idx ? idx.count : p.count, at = (i: number) => (idx ? idx.getX(i) : i), tris = Math.floor(n / 3);
  if (!tris) return 0;
  const size = box.getSize(new THREE.Vector3()), q = (v: number, lo: number, s: number) => Math.min(131071, Math.max(0, Math.round(((v - lo) / Math.max(s, 1e-12)) * 131071)));
  // 1. split into parts: triangles sharing a corner belong to the same part (corners matched on a fine grid, as one number each)
  const parent = new Int32Array(tris), corner = new Map<number, number>();
  for (let t = 0; t < tris; t++) parent[t] = t;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) { const v = at(t * 3 + k);
    const key = (q(p.getX(v), box.min.x, size.x) * 131072 + q(p.getY(v), box.min.y, size.y)) * 131072 + q(p.getZ(v), box.min.z, size.z), o = corner.get(key);
    if (o === undefined) corner.set(key, t); else parent[find(t)] = find(o); }
  corner.clear();
  // 2. each part's direction: a part whose facets all face inward (inside out) has negative volume, so its crossings get flipped
  const vol = new Float64Array(tris), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < tris; t++) { A.fromBufferAttribute(p as THREE.BufferAttribute, at(t * 3)); B.fromBufferAttribute(p as THREE.BufferAttribute, at(t * 3 + 1)); C.fromBufferAttribute(p as THREE.BufferAttribute, at(t * 3 + 2));
    vol[find(t)] += A.x * (B.y * C.z - B.z * C.y) - A.y * (B.x * C.z - B.z * C.x) + A.z * (B.x * C.y - B.y * C.x); }
  // 3. the finest grid whose work fits the budget (a triangle is checked once for each column under it)
  const cover = (N: number) => { let work = 0; const dx = size.x / N, dz = size.z / N;
    for (let t = 0; t < tris && work <= FILL.budget; t++) { const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
      work += (Math.floor((Math.max(p.getX(a), p.getX(b), p.getX(c)) - Math.min(p.getX(a), p.getX(b), p.getX(c))) / Math.max(dx, 1e-12)) + 2)
            * (Math.floor((Math.max(p.getZ(a), p.getZ(b), p.getZ(c)) - Math.min(p.getZ(a), p.getZ(b), p.getZ(c))) / Math.max(dz, 1e-12)) + 2); }
    return work; };
  const N = FILL.grids.find((g) => cover(g) <= FILL.budget);
  if (!N) return FILL.unknown;
  // 4. each triangle, once: for every column under it, does the column's ray (straight up) pass through it?
  //    keep the height and whether the ray goes in (+1) or out (-1) there; only real crossings are stored
  const dx = size.x / N, dz = size.z / N, dy = size.y / N, cell = (v: number, lo: number, d: number) => Math.min(N - 1, Math.max(0, Math.floor((v - lo) / Math.max(d, 1e-12))));
  const ys: number[][] = Array.from({ length: N * N }, () => []), dirs: number[][] = Array.from({ length: N * N }, () => []);
  for (let t = 0; t < tris; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2), ax = p.getX(a), az = p.getZ(a), bx = p.getX(b), bz = p.getZ(b), cx = p.getX(c), cz = p.getZ(c);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-12) continue;
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), dir = (ny > 0 ? -1 : 1) * (vol[find(t)] < 0 ? -1 : 1);   // facing up = the ray leaves
    for (let ix = cell(Math.min(ax, bx, cx), box.min.x, dx); ix <= cell(Math.max(ax, bx, cx), box.min.x, dx); ix++)
      for (let iz = cell(Math.min(az, bz, cz), box.min.z, dz); iz <= cell(Math.max(az, bz, cz), box.min.z, dz); iz++) {
        const x = box.min.x + (ix + 0.5 + 0.0137) * dx, z = box.min.z + (iz + 0.5 + 0.0071) * dz;   // a tiny nudge so a ray never runs along an edge
        const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w3 = 1 - w1 - w2;
        if (w1 <= 1e-9 || w2 <= 1e-9 || w3 <= 1e-9) continue;              // exactly on an edge: neither triangle claims it, so a shared edge is never counted twice (a safeguard: the nudge above already keeps rays off Tinkercad box diagonals, and floats rarely land exactly on an edge, so no test can reliably trigger it)
        const col = ix * N + iz; ys[col].push(w1 * p.getY(a) + w2 * p.getY(b) + w3 * p.getY(c)); dirs[col].push(dir);
      }
  }
  // 5. up each column, add up the ins and outs: wherever the count is above zero we're inside something, so overlaps,
  //    duplicates and shared corners all just count as inside, once.
  //    Known limits (both rare, neither from Tinkercad's own exports): a reversed part touching a normal one at a corner shares its
  //    direction, so may be miscounted; a model with holes leaves unclosed columns empty, so it reads a little emptier, not fuller.
  const inside = new Uint8Array(N * N * N);
  for (let col = 0; col < N * N; col++) {
    const Y = ys[col], Dr = dirs[col]; if (!Y.length) continue;
    const order = Y.map((_, i) => i).sort((i, j) => Y[i] - Y[j]), ix = Math.floor(col / N), iz = col % N;
    let wind = 0, from = 0;
    for (const i of order) { const was = wind; wind += Dr[i];
      if (was <= 0 && wind > 0) from = Y[i];
      else if (was > 0 && wind <= 0) { const y0 = Math.floor((from - box.min.y) / dy + 0.5), y1 = Math.floor((Y[i] - box.min.y) / dy + 0.5);
        for (let iy = Math.max(0, y0); iy < Math.min(N, y1); iy++) inside[(iy * N + iz) * N + ix] = 1; } }
    ys[col] = []; dirs[col] = [];                                            // let go of each column's crossings as soon as it's done
  }
  let count = 0; for (const v of inside) count += v; return count / inside.length;
}

export function measure(g: THREE.BufferGeometry): Shape {
  g.computeBoundingBox(); const box = g.boundingBox!, mid = box.getCenter(new THREE.Vector3());
  const e = box.getSize(new THREE.Vector3()).toArray().sort((a, b) => b - a);
  const p = g.getAttribute('position'), idx = g.getIndex(), n = idx ? idx.count : p.count, at = (i: number) => (idx ? idx.getX(i) : i);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), AB = new THREE.Vector3(), AC = new THREE.Vector3(), cen = new THREE.Vector3();
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));   // per-side, so being long or flat doesn't count as pointy
  let area = 0, sr = 0, sr2 = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    A.fromBufferAttribute(p, at(i)); B.fromBufferAttribute(p, at(i + 1)); C.fromBufferAttribute(p, at(i + 2));
    const ar = AB.copy(B).sub(A).cross(AC.copy(C).sub(A)).length() / 2; area += ar;
    const r = cen.copy(A).add(B).add(C).divideScalar(3).sub(mid).divide(half).length(); sr += r * ar; sr2 += r * r * ar;
  }
  const mean = area > 0 ? sr / area : 0, spread = mean > 0 ? Math.sqrt(Math.max(0, sr2 / area - mean * mean)) / mean : 0;
  const fill = fillOf(g, box);
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
export const NEEDS = { mix: { courier: 0.35, keeper: 0.35, fan: 0.15, bridge: 0.15 } as Record<Job, number>, nudge: 0.3, lonelyBridge: 0.15,
  closeCall: 0.15 };   // only jobs within this much of the best shape score can be nudged; anything clearer keeps its job
/** The job for a new polywog, given the jobs already on the island. Same shape + same island = same job on every device. */
export function jobFor(s: Shape, island: Job[] = []): Job {
  const sc = scores(s), total = island.length, best = { job: 'keeper' as Job, score: -Infinity }, top = Math.max(...JOB_ORDER.map((j) => sc[j]));
  for (const j of JOB_ORDER) {                                           // fixed order, so ties always break the same way
    if (sc[j] < top - NEEDS.closeCall) continue;                         // not a close call: the island's needs can't pick this job
    const share = total ? island.filter((x) => x === j).length / total : NEEDS.mix[j];
    let v = sc[j] + (total ? NEEDS.nudge * (NEEDS.mix[j] - share) : 0);
    if (j === 'bridge' && island.filter((x) => x === 'bridge').length % 2 === 1) v += NEEDS.lonelyBridge;   // a bridge on its own needs a partner
    if (v > best.score) { best.job = j; best.score = v; }
  }
  return best.job;
}

const stat = (v: number) => Math.max(1, Math.min(10, Math.round(1 + clamp01(v) * 9)));
/** Speed: long, slim, small and airy is fast. Bounce: ball-shaped bounces best. Stamina: solid keeps going.
 *  Weighted so that models of the same size still spread out (a solid cylinder, a ball and a cone come out clearly different). */
export function statsFor(s: Shape): Stats {
  const small = 1 - clamp01((s.size - 0.5) / 1.5), airy = clamp01(1 - s.fill), round = 1 - clamp01(s.pointy * 2);
  // how ball-like: as full as a ball (a ball fills about 52% of its box), smooth, and as wide as it is long and tall
  const ball = clamp01(1.3 * clamp01(1 - Math.abs(s.fill - 0.52) * 3) * round * clamp01(2 - s.long) * clamp01(s.flat));
  return {
    speed: stat(0.1 + 0.4 * clamp01((s.long - 1) / 1.5) + 0.25 * small + 0.65 * airy),
    bounce: stat(0.05 + 0.25 * airy + 0.75 * ball),                             // balls bounce best
    stamina: stat(0.05 + 0.85 * clamp01(s.fill) + 0.1 * clamp01(s.flat)),
  };
}
