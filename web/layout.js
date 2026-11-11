// Screen layout from edge joins. Pure functions, no DOM, so it can be tested in Node.
// Units are CSS pixels. Each device is a rectangle; a join says "this edge of A touches
// that edge of B, and they met at these points along the edges".

export const OPPOSITE = { L: 'R', R: 'L', T: 'B', B: 'T' };

// Offset of B's top-left corner relative to A's top-left corner.
export function joinOffset(j, sizes) {
  const A = sizes[j.a], B = sizes[j.b];
  if (!A || !B) return null;
  const d = j.alongA - j.alongB; // how far B's edge start sits along A's edge
  switch (j.edgeA) {
    case 'R': return [A.w, d];
    case 'L': return [-B.w, d];
    case 'B': return [d, A.h];
    case 'T': return [d, -B.h];
  }
  return null;
}

// Do any two screens in the same group overlap? (touching is fine)
export function overlapCount(L, sizes, tol = 6) {
  const ids = Object.keys(L.pos).filter((k) => sizes[k]);
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    if (L.group[a] !== L.group[b]) continue;
    const [ax, ay] = L.pos[a], [bx, by] = L.pos[b];
    const ox = Math.min(ax + sizes[a].w, bx + sizes[b].w) - Math.max(ax, bx);
    const oy = Math.min(ay + sizes[a].h, by + sizes[b].h) - Math.max(ay, by);
    if (ox > tol && oy > tol) n++;
  }
  return n;
}

// Add new joins. An old join between the same two devices is replaced. If the result
// makes screens overlap or disagree, older joins touching the new devices are dropped
// (oldest first) until the layout makes sense again: someone moved their device.
export function addJoins(joins, fresh, sizes) {
  const pair = (j) => [j.a, j.b].sort().join('|');
  const freshPairs = new Set(fresh.map(pair));
  let out = joins.filter((j) => !freshPairs.has(pair(j)));
  const touched = new Set(fresh.flatMap((j) => [j.a, j.b]));
  const ids = Object.keys(sizes);
  for (;;) {
    const all = [...out, ...fresh];
    const L = solveLayout(ids, all, sizes);
    if (overlapCount(L, sizes) === 0 && L.residual < 12) return all;
    const i = out.findIndex((j) => touched.has(j.a) || touched.has(j.b));
    if (i < 0) return all;
    out = out.filter((_, k) => k !== i);
  }
}
export const addJoin = (joins, j, sizes) => (sizes ? addJoins(joins, [j], sizes) : [...joins.filter((k) =>
  !((k.a === j.a && k.edgeA === j.edgeA) || (k.b === j.b && k.edgeB === j.edgeB))), j]);

// Positions for every device. Each connected group is solved separately; its root
// (smallest id) sits at (0,0). With loops the joins can disagree slightly, so we take the
// least-squares answer by repeated averaging. Returns { pos, group, residual }.
export function solveLayout(ids, joins, sizes) {
  const edges = [];
  for (const j of joins) {
    const o = joinOffset(j, sizes);
    if (o && ids.includes(j.a) && ids.includes(j.b)) edges.push({ a: j.a, b: j.b, o });
  }
  const nbr = Object.fromEntries(ids.map((id) => [id, []]));
  for (const e of edges) {
    nbr[e.a].push({ id: e.b, o: e.o });
    nbr[e.b].push({ id: e.a, o: [-e.o[0], -e.o[1]] });
  }
  const pos = {}, group = {};
  const sorted = [...ids].sort();
  for (const root of sorted) {
    if (root in pos) continue;
    // breadth-first first guess
    pos[root] = [0, 0]; group[root] = root;
    const q = [root];
    while (q.length) {
      const u = q.shift();
      for (const { id, o } of nbr[u]) {
        if (id in pos) continue;
        pos[id] = [pos[u][0] + o[0], pos[u][1] + o[1]];
        group[id] = root;
        q.push(id);
      }
    }
  }
  // refine: every non-root device moves to the average of what its neighbours say
  for (let it = 0; it < 200; it++) {
    for (const id of sorted) {
      if (group[id] === id || !nbr[id].length) continue;
      let x = 0, y = 0;
      for (const { id: n, o } of nbr[id]) { x += pos[n][0] - o[0]; y += pos[n][1] - o[1]; }
      pos[id] = [x / nbr[id].length, y / nbr[id].length];
    }
  }
  let residual = 0;
  for (const e of edges) {
    residual = Math.max(residual, Math.hypot(pos[e.b][0] - pos[e.a][0] - e.o[0], pos[e.b][1] - pos[e.a][1] - e.o[1]));
  }
  return { pos, group, residual };
}

// Bounding box of one group, used as the world's walls for that group.
export function groupBox(group, pos, sizes, groupId) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id in pos) {
    if (group[id] !== groupId || !sizes[id]) continue;
    x0 = Math.min(x0, pos[id][0]); y0 = Math.min(y0, pos[id][1]);
    x1 = Math.max(x1, pos[id][0] + sizes[id].w); y1 = Math.max(y1, pos[id][1] + sizes[id].h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Pair up a burst of orb pushes. A device may push several times (e.g. the middle
// screen of a row pushes left and right, or a laptop pushes twice to join two phones
// stacked down one edge). Two pushes can pair when they come from different devices,
// use opposite edges and happen within `windowMs`. We try every way of pairing them and
// keep the best: most screens joined, then no overlapping screens, then pushes closest
// in time. If a push that could have paired is left over, the burst was ambiguous
// (e.g. one push answered by two kids) and everyone involved is asked to push again.
export function matchPushes(pushes, windowMs = 1000, ctx = {}) {
  const n = pushes.length;
  const ok = (p, q) => p.dev !== q.dev && OPPOSITE[p.edge] === q.edge && Math.abs(p.t - q.t) <= windowMs;
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (ok(pushes[i], pushes[j])) pairs.push([i, j]);
  const toJoin = ([i, j]) => {
    const [a, b] = pushes[i].dev < pushes[j].dev ? [pushes[i], pushes[j]] : [pushes[j], pushes[i]];
    return { a: a.dev, edgeA: a.edge, alongA: a.along, b: b.dev, edgeB: b.edge, alongB: b.along };
  };
  const sizes = ctx.sizes, base = ctx.joins || [];
  let best = null;
  const score = (chosen) => {
    let overlaps = 0;
    if (sizes) {
      const L = solveLayout(Object.keys(sizes), [...base, ...chosen.map(toJoin)], sizes);
      overlaps = overlapCount(L, sizes);
    }
    const dt = chosen.reduce((s, [i, j]) => s + Math.abs(pushes[i].t - pushes[j].t), 0);
    return [-chosen.length, overlaps, dt];
  };
  const better = (a, b) => { for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };
  (function search(k, used, devPairs, chosen) {
    if (k === pairs.length) {
      const sc = score(chosen);
      if (!best || better(sc, best.sc)) best = { sc, chosen: [...chosen] };
      return;
    }
    search(k + 1, used, devPairs, chosen); // skip this pair
    const [i, j] = pairs[k];
    const dp = [pushes[i].dev, pushes[j].dev].sort().join('|');
    if (!used.has(i) && !used.has(j) && !devPairs.has(dp)) {
      used.add(i); used.add(j); devPairs.add(dp); chosen.push(pairs[k]);
      search(k + 1, used, devPairs, chosen);
      used.delete(i); used.delete(j); devPairs.delete(dp); chosen.pop();
    }
  })(0, new Set(), new Set(), []);
  const matched = new Set((best?.chosen || []).flat());
  const leftover = [...Array(n).keys()].filter((i) => !matched.has(i));
  const contested = leftover.filter((i) => pairs.some(([a, b]) => a === i || b === i));
  if (contested.length) {
    return { joins: [], retry: [...new Set(pushes.map((p) => p.dev))], unmatched: [] };
  }
  return { joins: (best?.chosen || []).map(toJoin), retry: [], unmatched: leftover.map((i) => pushes[i]) };
}
