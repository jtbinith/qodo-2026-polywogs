import * as THREE from 'three';
import { LEAVES, type LeafPalette } from './palette';
import { canvasTex, type Tick } from './helpers';

export interface Bloom { strength: number; radius: number; threshold: number }

/** A maple leaf (5 pointed lobes with small teeth) as a white mask, origin at the base of the stem. */
function mapleTex(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.translate(64, 66); g.fillStyle = '#fff'; g.beginPath();
    for (const [deg, len, wid] of [[-90, 56, 20], [-35, 46, 17], [-145, 46, 17], [20, 32, 12], [160, 32, 12]]) {
      const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), px = -s, py = c;
      g.moveTo(0, 0); g.quadraticCurveTo(c * len * 0.5 + px * wid, s * len * 0.5 + py * wid, c * len, s * len); g.quadraticCurveTo(c * len * 0.5 - px * wid, s * len * 0.5 - py * wid, 0, 0);
      for (const k of [0.55, 0.75]) { const tx = c * len * k, ty = s * len * k, w2 = wid * (1.05 - k) * 1.4;
        g.moveTo(tx + px * w2 * 0.6, ty + py * w2 * 0.6); g.lineTo(tx + px * w2 + c * 6, ty + py * w2 + s * 6); g.lineTo(tx + px * w2 * 0.3 + c * 4, ty + py * w2 * 0.3 + s * 4);
        g.moveTo(tx - px * w2 * 0.6, ty - py * w2 * 0.6); g.lineTo(tx - px * w2 + c * 6, ty - py * w2 + s * 6); g.lineTo(tx - px * w2 * 0.3 + c * 4, ty - py * w2 * 0.3 + s * 4); }
    }
    g.fill(); g.fillRect(-2.5, 0, 5, 50);
  });
}

/** Builds the approved maple leaves in one colour set. Returns the tick, the walker that kicks leaves up, and the bloom to use. */
export function buildLeaves(scene: THREE.Scene, rnd: () => number, palette: LeafPalette): { tick: Tick; walker: THREE.Object3D; bloom: Bloom } {
  const pal = LEAVES.palettes[palette], G = LEAVES.glow;
  const pickCol = () => { const tot = LEAVES.weights.reduce((a, b) => a + b, 0); let x = rnd() * tot; for (let i = 0; i < pal.length; i++) { x -= LEAVES.weights[i]; if (x <= 0) return pal[i]; } return pal[0]; };
  const sun = new THREE.Vector3(...LEAVES.sun).normalize(), uT = { value: 0 };
  const N = LEAVES.count, sz = 0.22 * LEAVES.size;
  const geo = new THREE.PlaneGeometry(sz, sz);
  const aGlow = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); aGlow.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aGlow', aGlow);
  const mat = new THREE.MeshBasicMaterial({ map: mapleTex(), alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.sunDir = { value: sun }; sh.uniforms.uT = uT; sh.uniforms.tintC = { value: new THREE.Color(LEAVES.glowTint[palette]) };
    sh.vertexShader = 'attribute float aGlow; varying float vGlow; varying vec3 vNw;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGlow = aGlow; vNw = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(0.,0.,1.));');
    sh.fragmentShader = 'uniform vec3 sunDir; uniform vec3 tintC; uniform float uT; varying float vGlow; varying vec3 vNw;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      float face = abs(dot(normalize(vNw), sunDir));                                            // either side can catch the sun
      outgoingLight = outgoingLight * (.8 + .2 * face);                                           // flat colour, barely shaded
      float shimmer = .75 + .25 * sin(uT * 23. + vNw.x * 40. + vNw.y * 31.);                       // flickers as it flutters
      float g = vGlow * pow(smoothstep(${G.from.toFixed(2)}, 1., face), ${G.power.toFixed(1)}) * shimmer;
      vec3 hot = mix(outgoingLight, tintC, .5);                                                    // the leaf's colour lifted toward its palette's light tint
      hot *= ${G.brightness.toFixed(1)} * .8 / max(dot(hot, vec3(.2126, .7152, .0722)), .05);      // same glow brightness for every palette
      outgoingLight = mix(outgoingLight, hot, g);
      #include <opaque_fragment>`);
  };
  const leaves = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D(), col = new THREE.Color();
  // drifts: clumps around a few centres + a scatter
  const centres = [...Array(7)].map(() => [rnd() * 8 - 4, rnd() * 6 - 3, 0.6 + rnd() * 1.2]);
  const st = [...Array(N)].map(() => {
    let x: number, z: number;
    if (rnd() < 0.75) { const c = centres[Math.floor(rnd() * centres.length)], a = rnd() * 6.283, r = Math.sqrt(rnd()) * c[2]; x = c[0] + Math.cos(a) * r; z = c[1] + Math.sin(a) * r; }
    else { x = rnd() * 12 - 6; z = rnd() * 8 - 4; }
    return { p: new THREE.Vector3(x, 0.01 + rnd() * 0.02, z), v: new THREE.Vector3(), r: new THREE.Euler(-Math.PI / 2 + (rnd() - 0.5) * 0.4, 0, rnd() * 6.283), spin: new THREE.Vector3(), air: false, glows: false, ph: rnd() * 6, s: 0.8 + rnd() * 0.6, dirty: true };
  });
  for (let i = 0; i < N; i++) leaves.setColorAt(i, col.set(pickCol()));
  scene.add(leaves);
  const walker = new THREE.Object3D(); scene.add(walker);
  let last = 0;
  const tick: Tick = (t) => {
    const dt = Math.min(0.05, Math.max(0, t - last)); last = t; uT.value = t;
    const a = t * 0.45; walker.position.set(Math.cos(a) * 3.2, 0, Math.sin(a * 1.3) * 1.8);
    let glowChanged = false;
    st.forEach((L, i) => {
      const dx = L.p.x - walker.position.x, dz = L.p.z - walker.position.z, dist = Math.hypot(dx, dz);
      const gust = !L.air && rnd() < 0.0002;                                                     // now and then the wind lifts a leaf
      if (!L.air && (dist < LEAVES.kickRadius * Math.max(1, LEAVES.size * 0.8) || gust)) {      // kicked up
        L.air = true; L.glows = !gust && rnd() < G.share;                                         // only some kicked-up leaves can glow
        L.v.set(gust ? 0.8 + rnd() : dx / (dist + 0.1) * (0.6 + rnd()), gust ? 0.9 + rnd() : 1.6 + rnd() * 1.8, gust ? (rnd() - 0.5) * 0.6 : dz / (dist + 0.1) * (0.6 + rnd()));
        L.spin.set((rnd() - 0.5) * 9, (rnd() - 0.5) * 9, (rnd() - 0.5) * 9);
        if (L.glows) { aGlow.setX(i, 1); glowChanged = true; }
      }
      if (L.air) {
        L.v.y -= 2.2 * dt; L.v.multiplyScalar(1 - 1.4 * dt); if (L.v.y < -0.6) L.v.y = -0.6;    // light and draggy, like a leaf
        L.p.addScaledVector(L.v, dt); L.p.x += Math.sin(t * 3 + L.ph) * 0.4 * dt; L.p.z += Math.cos(t * 2.3 + L.ph) * 0.3 * dt;   // flutter side to side
        L.r.x += L.spin.x * dt; L.r.y += L.spin.y * dt; L.r.z += L.spin.z * dt;
        if (L.p.y <= 0.02) { L.p.y = 0.02 + rnd() * 0.02; L.air = false; L.dirty = true; L.r.x = -Math.PI / 2 + (rnd() - 0.5) * 0.4; L.r.y = 0;
          if (L.glows) { L.glows = false; aGlow.setX(i, 0); glowChanged = true; } }           // back on the ground: no glow
      }
      if (L.air || L.dirty) { d.position.copy(L.p); d.rotation.copy(L.r); d.scale.setScalar(L.s); d.updateMatrix(); leaves.setMatrixAt(i, d.matrix); L.dirty = L.air; }
    });
    leaves.instanceMatrix.needsUpdate = true; if (glowChanged) aGlow.needsUpdate = true;
  };
  return { tick, walker, bloom: G.bloom };
}
