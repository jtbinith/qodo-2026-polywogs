import * as THREE from 'three';
import { CEL_WATER, DREAM as D, INK, ROCKS, type RockColour } from './palette';
import { NOISE, bands, brushTex, canvasTex, outline, spring, type Tick } from './helpers';
import { buildMushCoral } from './mushcoral';
import { buildMushTree } from './mushtree';
import { buildShelf } from './shelf';
import { buildRocks } from './rocks';
import { celWater } from './water';

/** What an island is made of. Pinned things sit exactly where you put them; zones get filled from the seed.
 *  Same layout + same seed = the same island on every device, so only creatures need syncing. */
export type Kind = 'coral' | 'mushtree' | 'shelf' | 'rocks' | 'pond' | 'lantern' | 'ball';
export interface Pinned { kind: Kind; x: number; z: number; y?: number; ry?: number; s?: number; colour?: RockColour }
export interface Zone { name: string; x: number; z: number; r: number; fill: Partial<Record<Kind, number>>; grass?: number }
export interface IslandLayout { seed: number; radius: number; grass: number; zones: Zone[]; pinned: Pinned[] }

const toonG = bands(D.toon.bands);
/** The approved water at night: the same two-tone noise, foam rings and gold star sparkles, in moonlit navy and blue
 *  (like the waterfall pond in the dream meadow) so it doesn't glow under the bloom. */
const NIGHT_WATER = { deep: '#0b1846', light: '#1d4a86', foam: '#8fa3e8', spark: '#ffe7a3', sand: '#3b3478' };
function nightWater(m: THREE.Mesh): void { const u = (m.material as THREE.ShaderMaterial).uniforms; (Object.keys(NIGHT_WATER) as (keyof typeof NIGHT_WATER)[]).forEach((k) => u[k].value.set(NIGHT_WATER[k])); }
const halo = (): THREE.Sprite => new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, D.lantern.halo[0]); gr.addColorStop(0.25, D.lantern.halo[1]); gr.addColorStop(1, D.lantern.halo[2]); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));

/** Every approved thing you can put on an island: how to build it, its default size, and how much room it takes up.
 *  Adding a new approved thing = one more line here. */
export const KINDS: Record<Kind, { label: string; scale: number; room: number; build: (s: THREE.Scene, p: Pinned) => Tick }> = {
  coral: { label: 'Coral mushroom tree', scale: 0.32, room: 1.5, build: (s) => buildMushCoral(s, 1).tick },
  mushtree: { label: 'Mushroom tree', scale: 0.38, room: 0.9, build: (s) => buildMushTree(s, 1).tick },
  shelf: { label: 'Shelf mushroom', scale: 0.9, room: 0.4, build: (s) => buildShelf(s, 1).tick },
  rocks: { label: 'Rock garden', scale: 0.4, room: 1.6, build: (s, p) => buildRocks(s, { colour: p.colour ?? 'slate' }) },
  pond: { label: 'Pond', scale: 1, room: 1.5, build: (s) => { const { mesh, tick } = celWater({ rings: true, sparkles: true, shore: true }, 3, 2.1); nightWater(mesh); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.012; mesh.userData.flat = true; s.add(mesh); return tick; } },
  lantern: { label: 'Lantern', scale: 1, room: 0.25, build: (s) => {   // the dream meadow's warm floating lantern
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12), new THREE.MeshBasicMaterial({ color: D.lantern.core })), light = new THREE.PointLight(D.lantern.light, D.lantern.intensity, 3.5, 1.8), h = halo();
    core.userData.flat = true; h.scale.setScalar(2.2); s.add(core, light, h);
    return (t) => { core.position.set(Math.sin(t * 2) * 0.05, 0.75 + Math.sin(t * 3) * 0.06, 0); light.position.copy(core.position); h.position.copy(core.position); light.intensity = D.lantern.intensity + Math.sin(t * 9) * 0.7; };
  } },
  ball: { label: 'Toy ball', scale: 1, room: 0.45, build: (s) => {    // the dream meadow's hopping toy ball
    const g = new THREE.SphereGeometry(0.4, 48, 24).translate(0, 0.4, 0), b = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: D.creatures.ball, gradientMap: toonG })), o = outline(g, INK, 0.012, D.ink.boil);
    b.add(o); b.castShadow = true; s.add(b);
    return (t) => { o.material.uniforms.t.value = t; const ph = (t * 0.9) % 1, land = spring(t * 0.9, 1, 22, 6) * 0.18; b.position.y = 4 * ph * (1 - ph) * 0.6; b.scale.set(1 + land, 1 - land * 1.6, 1 + land); };
  } },
};

export const GROUND_Y = 0.35;
/** Meadow card HEIGHT range on the island (x the dream meadow's 0.5 card height; width stays the meadow's): kept short so creatures stand out above it. */
export const GRASS_SIZE = [0.4, 0.95];
/** Fireflies: little lanterns drifting over the meadow, each lighting the grass around it like the lantern does. */
export const FIREFLIES = { count: 10, size: 0.035, halo: 0.55, light: 1.3, reach: 1.8, height: [0.45, 1.3] as [number, number] };
const vh = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
function vnoise2(x: number, y: number): number { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = vh(ix, iy), b = vh(ix + 1, iy), c = vh(ix, iy + 1), d = vh(ix + 1, iy + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
function fbm2(x: number, y: number): number { let s = 0, a = 0.5; for (let i = 0; i < 3; i++) { s += a * vnoise2(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s / 0.875; }
export function mulberry(a: number): () => number { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Night ink: the dream meadow's cream chalk line, shown exactly as it looks in the approved meadow. */
const CHALK = new THREE.Color(D.ink.color).convertSRGBToLinear();
/** Scenery keeps the creatures' glowing chalk line, just thinner, so the creatures still read boldest. */
export const SCENERY_LINE = 0.55;
const isOutline = (o: THREE.Object3D): boolean => !!((o as THREE.Mesh).material as THREE.ShaderMaterial)?.uniforms?.boil;

export interface Item { p: Pinned; g: THREE.Group }
export interface Island {
  edgeR: (a: number) => number;
  items: Item[];
  land: THREE.Mesh;
  add: (p: Pinned) => Item;
  remove: (g: THREE.Group) => void;
  regrow: () => void;
  /** meshes the cube can stand on or climb (no outlines, particles, water or glows) */
  solids: () => THREE.Object3D[];
  layout: () => IslandLayout;
  /** grass leans away from these spots (creatures), up to 64 */
  partGrass: (spots: { x: number; z: number; r: number }[]) => void;
  tick: Tick;
}

/** Builds an island into the scene in the dream-meadow night: sky, stars, moonlight, the approved sea, land, things and meadow. */
export function buildIsland(scene: THREE.Scene, L: IslandLayout): Island {
  const ticks: Tick[] = [], rnd = mulberry(L.seed * 9973 + 17), R = L.radius, S = L.seed;
  const edgeR = (a: number): number => R * (1 + 0.07 * Math.sin(a * 3 + S) + 0.05 * Math.sin(a * 5 + S * 2) + 0.025 * Math.sin(a * 11 + S * 3) + 0.012 * Math.sin(a * 23));

  // night: the dream meadow's sky, fog, stars and moonlight
  scene.background = new THREE.Color(D.sky); scene.fog = new THREE.Fog(D.fog.color, R * 2.2, R * 5.5);
  scene.add(new THREE.HemisphereLight(D.fill.sky, D.fill.ground, D.fill.intensity));
  const moon = new THREE.DirectionalLight(D.moon.color, D.moon.intensity); moon.position.set(...(D.moon.position.map((v) => v * 1.6) as [number, number, number])); moon.castShadow = true;
  Object.assign(moon.shadow.camera, { left: -R * 1.4, right: R * 1.4, top: R * 1.4, bottom: -R * 1.4, far: 60 }); moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03; moon.shadow.radius = D.moon.shadowSoftness; scene.add(moon);
  const front = new THREE.DirectionalLight(D.frontMoon.color, D.frontMoon.intensity); front.position.set(...D.frontMoon.position); scene.add(front);
  { const sp = new Float32Array(D.stars.count * 3).map((_, i) => (i % 3 === 1 ? 6 + Math.random() * 30 : (Math.random() - 0.5) * 120));
    scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)), new THREE.PointsMaterial({ color: D.stars.color, size: D.stars.size * 1.6, fog: false }))); }

  // sea: the approved water, rings rolling in towards the shore
  { const { mesh, tick } = celWater({ rings: true, sparkles: true, inward: true, calm: [R * 1.4, R * 2.6], fog: { color: D.fog.color, near: R * 1.6, far: R * 5 } }, R * 13, R * 13); nightWater(mesh); mesh.rotation.x = -Math.PI / 2; mesh.position.y = -0.05; scene.add(mesh); ticks.push(tick); }

  // shore foam: where the sea meets the cliff, a flat broken band that laps in and out, plus a second thinner line further out
  {
    const TS = 360, RS = 8, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r <= RS; r++) for (let t = 0; t <= TS; t++) { const a = (t / TS) * 6.283, f = r / RS, rr = edgeR(a) * 0.975 + f * 1.1; pos.push(Math.cos(a) * rr, -0.03, Math.sin(a) * rr); uv.push(t / TS, f); }
    for (let r = 0; r < RS; r++) for (let t = 0; t < TS; t++) { const a = r * (TS + 1) + t, b = a + 1, c = a + TS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const U = { value: 0 };
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { t: U, foam: { value: new THREE.Color(NIGHT_WATER.foam) } },
      vertexShader: 'varying vec2 vU; varying vec3 vW; void main(){ vU = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: NOISE + `uniform float t; uniform vec3 foam; varying vec2 vU; varying vec3 vW;
        void main(){ float a = vU.x * 6.283, d = vU.y;                                            // d: 0 at the cliff, 1 out at sea
          float wob = (fbm(vW.xz * 1.6 + t * .2) - .5) * .18;
          float lap = .34 + .1 * sin(t * 1.3 + a * 3.) + .05 * sin(t * 2.1 - a * 7.);              // the wash creeping up and sliding back
          float band = step(d, lap + wob) * step(.42, fbm(vW.xz * 3.5 - t * .15) + (1. - d / max(lap + wob, .01)) * .5);   // solid by the rock, breaking up at its edge
          float out_ = .55 + .12 * sin(t * .9 + a * 2.) + wob;                                        // a thinner line of foam further out
          float line = step(abs(d - out_), .025) * step(.45, fbm(vW.xz * 4. + 3. + t * .1));
          float bub = step(.93, hash(floor(vW.xz * 9.))) * step(d, lap + .15) * step(lap + wob, d);  // a few bubbles left behind
          float f = max(max(band, line), bub);
          if (f < .5) discard;
          gl_FragColor = vec4(foam, 1.);
          #include <colorspace_fragment>
        }` });
    const shore = new THREE.Mesh(g, m); shore.renderOrder = 2; scene.add(shore); ticks.push((t) => (U.value = t));
  }

  // land: a ragged slab; the meadow's deep blue ground on top, a pale sandy shore, a slate cliff into the sea
  const ink = (m: THREE.Mesh, w: number): void => { const o = outline(m.geometry, INK, w, D.ink.boil, false); o.material.uniforms.w.value *= SCENERY_LINE; o.material.uniforms.minW.value *= SCENERY_LINE; m.add(o); ticks.push((t) => (o.material.uniforms.t.value = t)); };
  let land: THREE.Mesh;
  {
    const TS = 240, RS = 24, T = GROUND_Y, pos: number[] = [], edge: number[] = [], idx: number[] = [];
    pos.push(0, T, 0); edge.push(0);
    for (let r = 1; r <= RS; r++) for (let t = 0; t < TS; t++) { const a = (t / TS) * 6.283, f = r / RS, rr = edgeR(a) * f; pos.push(Math.cos(a) * rr, T - 0.06 * Math.pow(f, 8), Math.sin(a) * rr); edge.push(f); }
    for (let t = 0; t < TS; t++) idx.push(0, 1 + ((t + 1) % TS), 1 + t);
    for (let r = 1; r < RS; r++) for (let t = 0; t < TS; t++) { const a = 1 + (r - 1) * TS + t, b = 1 + (r - 1) * TS + ((t + 1) % TS), c = a + TS, d = b + TS; idx.push(a, b, c, b, d, c); }
    const top0 = 1 + (RS - 1) * TS, bot0 = pos.length / 3;
    for (let t = 0; t < TS; t++) { const k = top0 + t; pos.push(pos[k * 3] * 0.97, -0.6, pos[k * 3 + 2] * 0.97); edge.push(1.1); }
    for (let t = 0; t < TS; t++) { const a = top0 + t, b = top0 + ((t + 1) % TS), c = bot0 + t, d = bot0 + ((t + 1) % TS); idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1)); g.setIndex(idx); g.computeVertexNormals();
    const col = (h: string) => ({ value: new THREE.Color(h) });
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { cGround: col(D.ground), cSand: col(CEL_WATER.sand), cCliff: col(ROCKS.colours.slate.mid), cCliffD: col(ROCKS.colours.slate.dark) });
      sh.vertexShader = 'attribute float aEdge; varying float vE; varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vE = aEdge; vP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vE; varying vec3 vP; uniform vec3 cGround, cSand, cCliff, cCliffD;\n' + NOISE).replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
        float e = vE + (fbm(vP.xz * 1.3) - .5) * .08;
        vec3 c = mix(cGround, cSand, step(.9, e));
        if (vE > 1.) c = vP.y < -.3 ? cCliffD : cCliff;
        diffuseColor.rgb = c;`);
    };
    land = new THREE.Mesh(g, m); land.receiveShadow = true; land.name = 'land'; ink(land, 0.02); scene.add(land);
  }

  // things: each approved builder sets up its own stage; keep only the thing itself (no lights, shadow catchers or bases)
  const items: Item[] = [];
  const add = (p: Pinned): Item => {
    const k = KINDS[p.kind], tmp = new THREE.Scene(), tick = k.build(tmp, p), g = new THREE.Group();
    [...tmp.children].forEach((c) => { const stage = (c as THREE.Light).isLight && !(c as THREE.PointLight).isPointLight || ((c as THREE.Mesh).material as THREE.Material)?.type === 'ShadowMaterial' || c.userData.base; if (!stage) g.add(c); });
    const drop: THREE.Object3D[] = []; g.traverse((o) => { if (o.userData.base) drop.push(o); }); drop.forEach((o) => o.parent?.remove(o));
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !isOutline(o)) o.castShadow = true; if (isOutline(o)) { const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms; u.c.value.copy(CHALK); u.w.value *= SCENERY_LINE; u.minW.value *= SCENERY_LINE; } });   // chalk lines at night
    g.position.set(p.x, GROUND_Y + (p.y ?? 0), p.z); g.rotation.y = p.ry ?? 0; g.scale.setScalar(p.s ?? k.scale); g.userData.item = p;
    let alive = true; ticks.push((t) => { if (alive) tick(t); }); g.userData.kill = () => (alive = false);
    scene.add(g); const it = { p, g }; items.push(it); return it;
  };
  const remove = (g: THREE.Group): void => { const i = items.findIndex((it) => it.g === g); if (i >= 0) items.splice(i, 1); g.userData.kill?.(); scene.remove(g); };
  const room = (it: Item): number => KINDS[it.p.kind].room * (it.g.scale.x / KINDS[it.p.kind].scale);

  L.pinned.forEach((p) => add({ ...p }));
  for (const z of L.zones) for (const [kind, n] of Object.entries(z.fill) as [Kind, number][]) for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 200; tries++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * z.r, x = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d, r = KINDS[kind].room;
      if (Math.hypot(x, zz) + r > edgeR(Math.atan2(zz, x)) - 0.6) continue;
      if (items.some((it) => Math.hypot(it.g.position.x - x, it.g.position.z - zz) < room(it) + r + 0.3)) continue;
      add({ kind, x: +x.toFixed(2), z: +zz.toFixed(2), ry: +(rnd() * 6.283).toFixed(2) }); break;
    }
  }

  // meadow: the dream meadow's swaying brush-stroke cards, with its magenta paths; kept off the sand and out of ponds
  const cardMat = new THREE.MeshLambertMaterial({ map: brushTex(), alphaTest: 0.35, side: THREE.DoubleSide, emissive: D.meadow.emissive }), U = { value: 0 };
  // grass parts around creatures: up to PARTERS spots (x, z, radius); blades near one lean away from it and squash down, roots stay put
  const PARTERS = 64, parts = { value: Array.from({ length: PARTERS }, () => new THREE.Vector4(0, 0, 0, 0)) };
  cardMat.onBeforeCompile = (sh) => { sh.uniforms.uT = U; sh.uniforms.uParts = parts;
    sh.vertexShader = `uniform float uT; uniform vec4 uParts[${PARTERS}];\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec4 ip = instanceMatrix * vec4(0.,0.,0.,1.); float k = uv.y * uv.y;
    transformed.x += k * (sin(uT * 1.3 + ip.x * .6 + ip.z * .4) * .12 + sin(uT * 3.1 + ip.z) * .04);`).replace('#include <project_vertex>', `
    vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.);
    for (int i = 0; i < ${PARTERS}; i++) { vec4 c = uParts[i]; if (c.z <= 0.) continue;
      vec2 d = wp.xz - c.xy; float l = max(length(d), 1e-3), f = (1. - smoothstep(c.z * .55, c.z * 1.5, l)) * k;
      wp.xz += d / l * f * c.z * .7; wp.y = mix(wp.y, ${GROUND_Y.toFixed(2)} + (wp.y - ${GROUND_Y.toFixed(2)}) * .25, f); }
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`); };
  ticks.push((t) => (U.value = t));

  // fireflies: each a tiny lantern (warm core, soft halo, a small real light), drifting and blinking over the meadow
  { const fr = mulberry(L.seed * 53 + 11), F = FIREFLIES;
    for (let i = 0; i < F.count; i++) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(F.size, 10, 8), new THREE.MeshBasicMaterial({ color: D.lantern.core })), h = halo(), light = new THREE.PointLight(D.lantern.light, F.light, F.reach, 1.8);
      core.userData.flat = true; h.scale.setScalar(F.halo); scene.add(core, h, light);
      const a = fr() * 6.283, r = Math.sqrt(fr()) * R * 0.7, hx = Math.cos(a) * r, hz = Math.sin(a) * r, ph = fr() * 100, sp = 0.15 + fr() * 0.2, hy = F.height[0] + fr() * (F.height[1] - F.height[0]);
      ticks.push((t) => { const u = t * sp + ph;
        core.position.set(hx + Math.sin(u) * 1.1 + Math.sin(u * 2.3) * 0.4, GROUND_Y + hy + Math.sin(u * 3.1) * 0.15, hz + Math.cos(u * 0.8) * 1.1 + Math.sin(u * 1.7) * 0.3);
        const blink = 0.35 + 0.65 * Math.max(0, Math.sin(t * (0.9 + sp) + ph)) ** 2; light.position.copy(core.position); h.position.copy(core.position);
        light.intensity = F.light * blink; h.material.opacity = 0.85 * blink; core.scale.setScalar(0.7 + 0.3 * blink); }); } }
  let meadow: THREE.InstancedMesh | null = null;
  const regrow = (): void => {
    if (meadow) { scene.remove(meadow); meadow.dispose(); }
    const gr = mulberry(L.seed * 31 + 5), N = Math.round(D.meadow.cards * 0.75 * L.grass * (R / 7) ** 2);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(...D.meadow.card).translate(0, D.meadow.card[1] / 2, 0), cardMat, Math.max(1, N)), d = new THREE.Object3D(), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const a = gr() * 6.283, r = Math.sqrt(gr()) * R, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r > edgeR(a) * 0.87) continue;
      if (items.some((it) => (it.p.kind === 'pond' ? Math.abs((x - it.g.position.x) / (1.5 * it.g.scale.x)) ** 2 + Math.abs((z - it.g.position.z) / (1.05 * it.g.scale.x)) ** 2 < 1.15 : Math.hypot(it.g.position.x - x, it.g.position.z - z) < room(it) * 0.35))) continue;
      const boost = L.zones.reduce((m, zn) => (Math.hypot(zn.x - x, zn.z - z) < zn.r ? Math.max(m, zn.grass ?? 0) : m), 0);
      if (gr() > 0.8 + boost) continue;
      d.position.set(x, GROUND_Y - 0.02, z); d.rotation.set((gr() - 0.5) * 0.5, gr() * 6.283, (gr() - 0.5) * 0.5); { const w = 0.6 + gr() * 0.9; d.scale.set(w, GRASS_SIZE[0] + gr() * (GRASS_SIZE[1] - GRASS_SIZE[0]), w); } d.updateMatrix();   // as wide and thick as the dream meadow, just shorter
      const onPath = fbm2(x * 0.32 + S * 7.1, z * 0.32 - S * 3.3) > 0.62;   // magenta paths in soft noise patches, not straight stripes
      im.setMatrixAt(k, d.matrix); im.setColorAt(k, c.set(onPath ? D.meadow.path : D.meadow.palette[k % D.meadow.palette.length]).multiplyScalar(D.meadow.brightness[0] + gr() * (D.meadow.brightness[1] - D.meadow.brightness[0]))); k++;
    }
    im.count = k; im.receiveShadow = true; meadow = im; scene.add(im);
  };
  regrow();

  const solids = (): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [land];
    items.forEach(({ g }) => g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !isOutline(o) && !o.userData.flat) out.push(o); }));
    return out;
  };
  const layout = (): IslandLayout => ({ seed: L.seed, radius: L.radius, grass: L.grass, zones: [],
    pinned: items.map(({ p, g }) => { const o: Pinned = { kind: p.kind, x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2), ry: +g.rotation.y.toFixed(2), s: +g.scale.x.toFixed(3) };
      const y = +(g.position.y - GROUND_Y).toFixed(2); if (y) o.y = y; if (p.colour) o.colour = p.colour; return o; }) });
  const partGrass = (spots: { x: number; z: number; r: number }[]): void => parts.value.forEach((v, i) => { const p = spots[i]; v.set(p?.x ?? 0, p?.z ?? 0, p?.r ?? 0, 0); });
  return { edgeR, items, land, add, remove, regrow, solids, layout, partGrass, tick: (t) => ticks.forEach((f) => f(t)) };
}
