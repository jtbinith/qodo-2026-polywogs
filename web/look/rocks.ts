import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { NOISE, bands, outline, type Tick } from './helpers';
import { ROCKS, type RockColour } from './palette';

/** Approved rocks: round faceted boulders, cut-in cracks, pebbles, cushion moss. All values live in palette.ts (ROCKS). */
export interface RockOptions { colour: RockColour }

// ---------- noise, the same in JS and GLSL so moss placement and shading agree ----------
const fr = (x: number) => x - Math.floor(x);
const hash = (x: number, y: number) => fr(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x: number, y: number): number { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
function fbm(x: number, y: number): number { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; }
/** > 0 where moss grows: patchy, mostly on top, with rounded lobes hanging over the edges. */
export function mossField(w: THREE.Vector3, n: THREE.Vector3): number { return fbm(w.x * 1.3 + 3, w.z * 1.3 + 3) + 0.62 * n.y + 0.32 * (fbm(w.x * 3.2 + w.y * 1.5 + 9, w.z * 3.2 + w.y * 1.5 + 9) - 0.5) - 0.98; }
const FIELDS = NOISE + `
  float mossField(vec3 w, vec3 n){ return fbm(w.xz * 1.3 + 3.) + .62 * n.y + .32 * (fbm(w.xz * 3.2 + w.y * 1.5 + 9.) - .5) - .98; }
  vec2 crackField(vec3 w, vec3 n){ vec3 a = abs(n); vec2 p = a.y > a.x && a.y > a.z ? w.xz : a.x > a.z ? w.zy : w.xy;
    float v = fbm(p * 2.3 + 1.7); float on = smoothstep(.5, .56, fbm(p * .8 + 5.)); return vec2(abs(v - .5), on * step(.5, v)); }`;

// ---------- rock shapes ----------
/** The outer shell (convex hull) of many random points on a squashed ball: round, with lots of small flat faces. */
export function rockGeo(r: number, seed: number, stretch: [number, number, number]): THREE.BufferGeometry {
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const { points, jitter } = ROCKS.shape;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < points; i++) { const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(r * (1 - jitter / 2 + rnd() * jitter));
    v.set(v.x * stretch[0], Math.max(v.y, -0.35 * r) * stretch[1], v.z * stretch[2]); pts.push(v); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283 + rnd(); pts.push(new THREE.Vector3(Math.cos(a) * r * 0.8 * stretch[0], -0.35 * r * stretch[1], Math.sin(a) * r * 0.8 * stretch[2])); }
  const g = new ConvexGeometry(pts); g.computeVertexNormals(); g.translate(0, 0.35 * r * stretch[1], 0); return g;
}
function smoothCopy(g: THREE.BufferGeometry): THREE.BufferGeometry { const p = new THREE.BufferGeometry(); p.setAttribute('position', g.attributes.position.clone()); const m = mergeVertices(p, 1e-4); m.computeVertexNormals(); return m; }

function rockMat(o: RockOptions): THREE.ShaderMaterial {
  const C = ROCKS.colours[o.colour], c = (h: string) => ({ value: new THREE.Color(h) });
  return new THREE.ShaderMaterial({
    uniforms: { sun: { value: new THREE.Vector3(...ROCKS.sun).normalize() }, cL: c(C.light), cM: c(C.mid), cD: c(C.dark), cCrack: c(C.crack), uMoss: { value: 1 }, uCracks: { value: 1 }, uTint: c(ROCKS.moss[0]) },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: FIELDS + `uniform vec3 sun, cL, cM, cD, cCrack, uTint; uniform float uMoss, uCracks; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 n = normalize(vN); float l = dot(n, sun); vec3 c = l > .42 ? cL : l > -.05 ? cM : cD;
        if (uCracks > .5) { vec2 cr = crackField(vW, n); float w = .011 + .006 * fbm(vW.xz * 6.);
          if (cr.x < w && cr.y > .5) c = cCrack; else if (cr.x < w * 2.1 && cr.y > .5 && l > -.05) c = mix(c, cL * 1.12, .7); }
        if (uMoss > .5) { float f = mossField(vW, n); if (f > -.015) c = mix(c, uTint, .3);                 // a thin damp, green-stained rim around the moss
          if (mossField(vW + vec3(0., .08, 0.), n) > 0. && f <= 0.) c *= .7; }                            // shadow under the moss lip
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------- moss styles ----------
let toonG: THREE.DataTexture | null = null;
const mossToon = () => (toonG ??= bands([90, 175, 255]));
/** Cushion: hundreds of small puffy toon clumps where the noise says moss grows. Darker deep down, brighter at the sunny tips. */
function cushion(rock: THREE.Mesh, density: number): THREE.Object3D {
  const sampler = new MeshSurfaceSampler(rock).build(), p = new THREE.Vector3(), n = new THREE.Vector3(), wp = new THREE.Vector3(), wn = new THREE.Vector3();
  const blob = new THREE.SphereGeometry(1, 12, 8); blob.scale(1, 0.6, 1);
  const N = Math.round(density), im = new THREE.InstancedMesh(blob, new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: mossToon() }), N);
  const d = new THREE.Object3D(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0); let k = 0, guard = 0;
  rock.updateMatrixWorld();
  while (k < N && guard++ < N * 12) { sampler.sample(p, n); wp.copy(p).applyMatrix4(rock.matrixWorld); wn.copy(n).transformDirection(rock.matrixWorld);
    const f = mossField(wp, wn); if (f <= 0) continue;
    const thick = Math.min(1, f * 6), sz = (0.045 + 0.05 * thick) * (0.7 + Math.random() * 0.6);
    d.position.copy(p).addScaledVector(n, sz * 0.25); d.quaternion.setFromUnitVectors(up, n); d.scale.setScalar(sz); d.updateMatrix(); im.setMatrixAt(k, d.matrix);
    const shade = Math.min(4, Math.floor(thick * 3 + fbm(wp.x * 9, wp.z * 9) * 2.2)); im.setColorAt(k, col.set(ROCKS.moss[Math.max(1, shade)])); k++; }
  im.count = k; im.castShadow = true; return im;
}
/** A little cluster of rocks with pebbles at their bases, in the chosen rock style, colour and moss. */
export function buildRocks(scene: THREE.Scene, o: RockOptions): Tick {
  const ticks: Tick[] = [], mat = rockMat(o);
  const add = (r: number, seed: number, stretch: [number, number, number], x: number, z: number, ry: number, ink = 0.022, mossAmount = 1) => {
    const g = rockGeo(r, seed, stretch), m = new THREE.Mesh(g, mat); m.position.set(x, 0, z); m.rotation.y = ry; scene.add(m);
    const ol = outline(smoothCopy(g), ROCKS.ink, ink, 0.9); m.add(ol); ticks.push((tt) => (ol.material.uniforms.t.value = tt));
    if (mossAmount > 0) m.add(cushion(m, ROCKS.mossDensity * r * r * stretch[0] * stretch[2] * mossAmount));   // in the rock's own coordinates, so it rides on the rock
    return m; };
  add(1.25, 1, [1.25, 0.8, 1], -1.7, -0.4, 0.3);
  add(0.75, 2, [0.75, 2.1, 0.7], 0.6, -0.9, 1.1);
  add(1.0, 3, [1.4, 0.45, 1.1], 2.4, 0.3, 2.0);
  add(0.55, 4, [1, 0.8, 1], -0.2, 0.7, 0.7, 0.016);
  add(0.45, 5, [1.1, 0.7, 1], 1.2, 1.0, 1.9, 0.014);
  let s = 77; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const [cx, cz, n] of [[-1.7, -0.4, 9], [0.6, -0.9, 6], [2.4, 0.3, 7], [-0.2, 0.7, 4]] as [number, number, number][])
    for (let i = 0; i < n; i++) { const a = rnd() * 6.283, rr = 0.9 + rnd() * 0.7; add(0.07 + rnd() * 0.09, 10 + i + cx * 3, [1, 0.7, 1], cx + Math.cos(a) * rr, cz + Math.sin(a) * rr * 0.7, rnd() * 6, 0.008, 0); }
  return (tt) => ticks.forEach((f) => f(tt));
}
