import * as THREE from 'three';
import { MUSHCORAL as M } from './palette';
import { NOISE, bands, canvasTex, outline, type Tick } from './helpers';

/** A linear-RGB triple from the palette as a GLSL vec3. */
const v3 = (c: readonly [number, number, number]): string => `vec3(${c.map((x) => x.toFixed(3)).join(', ')})`;

/** Builds the approved coral mushroom tree: approved caps on a branching cream fungus trunk, on a burnt-paper patch. */
export function buildMushCoral(scene: THREE.Scene, aspect: number): { camera: THREE.PerspectiveCamera; tick: Tick } {
  scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, M.background[0]); gr.addColorStop(1, M.background[1]); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  const camera = new THREE.PerspectiveCamera(M.camera.fov, aspect, 0.1, 200); camera.position.set(...M.camera.position); camera.lookAt(...M.camera.target);
  let seed = M.seed; const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const tick: Tick[] = [], toonG = bands([95, 185, 255]);
    const inked = <T extends THREE.Mesh>(m: T, w: number = M.ink.width): T => { const o = outline(m.geometry, M.ink.color, w, 0.9); m.add(o); tick.push((t) => (o.material.uniforms.t.value = t)); return m; };

  scene.add(new THREE.HemisphereLight(M.light.sky, M.light.ground, M.light.fill));
  const key = new THREE.DirectionalLight(M.light.key, M.light.keyIntensity); key.position.set(...M.light.keyPosition); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 10, bottom: -2, far: 40 }); key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03; key.shadow.radius = 4; scene.add(key);

  // ---------- the coral trunk: cream fungus flesh branching like antlers ----------
  const flesh = new THREE.MeshToonMaterial({ color: M.flesh.color, gradientMap: toonG });
  flesh.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec2 vF; varying vec3 vW; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vF = uv; vW = (modelMatrix * vec4(position, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vF; varying vec3 vW; varying vec3 vWN; float gL; vec3 gLc;\n' + NOISE).replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
      float fib = vnoise(vec2(vF.y * 18., vF.x * 3.));                            // long fibres running along the branch
      diffuseColor.rgb *= mix(.9, 1.04, smoothstep(.35, .65, fib));
      #ifndef BASE
      diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(M.flesh.tipBlush)}, smoothstep(.55, 1., vF.x) * .55);   // peach blush towards each tip
      #endif
      // ridges: the rocks' cut-in cracks, stretched up the trunk (dark groove + a thin light lip)
      { vec3 an = abs(normalize(vWN)); vec3 q = vW * vec3(1., .3, 1.);
        vec2 rp = an.y > an.x && an.y > an.z ? vW.xz * .7 : an.x > an.z ? q.zy : q.xy;   // flat tops get plain wiggly cracks
        float v = fbm(rp * 4.5 + 1.7), on = smoothstep(.36, .44, fbm(rp * .9 + 5.)), d = abs(v - .5), w = .035 + .012 * vnoise(vW.xz * 6.);
        if (on > .5) { if (d < w) diffuseColor.rgb = ${v3(M.flesh.ridge)}; else if (d < w * 2.1) diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(M.flesh.ridgeLip)}, .6); } }
      // lichen: a few crusty mint and lavender splotches
      vec2 lp = vec2(vW.x * 1.9 + vW.z * 1.3, vW.y * 1.6 - vW.z * .7);
      float l = fbm(lp) + .35 * vnoise(lp * 6.);                                   // ragged edges
      float body = smoothstep(.67, .7, l), rim = body - smoothstep(.71, .76, l);
      vec3 lc = vnoise(lp * .4 + 7.) > .5 ? ${v3(M.lichen[0])} : ${v3(M.lichen[1])};
      lc *= mix(.92, 1.06, step(.5, vnoise(lp * 14.)));                           // speckled crust
      diffuseColor.rgb = mix(diffuseColor.rgb, lc, body);
      diffuseColor.rgb = mix(diffuseColor.rgb, lc * 1.12, rim * .6);              // pale frilly edge
      gL = body; gLc = diffuseColor.rgb;`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += gLc * gL * .3;');   // lichen keeps its colour in the shade
  };
  const tips: { p: THREE.Vector3; d: THREE.Vector3; small?: boolean }[] = [];
  function limb(points: THREE.Vector3[], r0: number, r1: number, _depth: number, flare = 0): THREE.CatmullRomCurve3 {
    const curve = new THREE.CatmullRomCurve3(points), TS = 40, RS = 12, g = new THREE.TubeGeometry(curve, TS, 1, RS), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { const t = Math.floor(i / (RS + 1)) / TS, c = curve.getPointAt(t), w = 1 + 0.1 * Math.sin(t * 18 + (i % (RS + 1))); v.fromBufferAttribute(p, i).sub(c).multiplyScalar((r0 + (r1 - r0) * t) * w * (1 + flare * Math.pow(1 - t, 10))).add(c); p.setXYZ(i, v.x, Math.max(v.y, -0.6), v.z); }   // trunk goes right through the base
    g.computeVertexNormals();
    const m = inked(new THREE.Mesh(g, flesh)); m.castShadow = m.receiveShadow = true; scene.add(m);
    return curve;
  }
  // a sweeping main trunk, then forks
  const trunk = limb([[0, -0.6, 0], [0.4, 1.2, 0.1], [-0.3, 2.6, 0], [0.2, 3.8, 0.05], [0, 4.6, 0]].map((a) => new THREE.Vector3(...a)), 0.55, 0.22, 0, 0.8);   // flares out where it meets the ground
  function grow(from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number): void {
    const end = from.clone().add(dir.clone().multiplyScalar(len)), mid = from.clone().lerp(end, 0.5).add(new THREE.Vector3((rnd() - 0.5) * 0.4, 0.25, (rnd() - 0.5) * 0.4));
    limb([from, mid, end], r, r * 0.55, depth);
    if (depth >= 2) { tips.push({ p: end, d: dir.clone() }); return; }
    const n = depth === 0 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = Math.atan2(dir.z, dir.x) + (k - (n - 1) / 2) * 1.0 + (rnd() - 0.5) * 0.4;
      const nd = new THREE.Vector3(Math.cos(a), 0.55 + rnd() * 0.5, Math.sin(a)).normalize();
      grow(end, nd, len * 0.68, r * 0.55, depth + 1);
    }
    if (depth <= 1) tips.push({ p: mid, d: dir.clone(), small: true });   // brackets half-way along
  }
  for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.6, base = trunk.getPointAt(0.45 + k * 0.14); grow(base, new THREE.Vector3(Math.cos(a), 0.5, Math.sin(a) * 0.7).normalize(), 2.2 - k * 0.25, 0.32 - k * 0.03, 0); }
  tips.push({ p: trunk.getPointAt(1), d: new THREE.Vector3(0, 1, 0.2).normalize() });          // crown


  // roots spreading out over the base, tips tucked under it
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.4, L = 1.0 + rnd() * 0.5;
    limb([new THREE.Vector3(Math.cos(a) * 0.2, 0.55, Math.sin(a) * 0.2), new THREE.Vector3(Math.cos(a) * L * 0.55, 0.24, Math.sin(a) * L * 0.45), new THREE.Vector3(Math.cos(a) * L, 0.04, Math.sin(a) * L * 0.75)], 0.16, 0.04, 3); }

  // ---------- fans: exactly the approved mushroom-tree caps ----------
  const capY = (s: number, R: number): number => R * (0.05 * (1 - s * s) + 0.13 * Math.pow(s, 2.6));   // rim lifts up like a fan
  function capGeo(R: number, span: number, seed: number): { g: THREE.LatheGeometry; split: number } {
    // a lathe of a closed profile (dome on top, gills underneath), only partly round so it fans out to one side
    const prof: THREE.Vector2[] = [];
    const n = 26;
    for (let k = 0; k <= n; k++) { const s = k / n, r = 0.12 + s * R; prof.push(new THREE.Vector2(r, capY(s, R))); }   // shallow fan, rising towards the rim
    prof.push(new THREE.Vector2(R + 0.05, capY(1, R) - 0.05 * R));                                                                                                   // rounded rim
    for (let k = n; k >= 0; k--) { const s = k / n, r = 0.12 + s * R; prof.push(new THREE.Vector2(r * 0.97, capY(s, R) - 0.11 * R * (1 - 0.4 * s) - 0.06)); }   // underside
    const g = new THREE.LatheGeometry(prof, 72, -span / 2, span);
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {   // wavy rim
      v.fromBufferAttribute(p, i); const r = Math.hypot(v.x, v.z), a = Math.atan2(v.z, v.x), k = Math.pow(r / R, 2);
      const w = 1 + 0.07 * Math.sin(a * 5 + seed) * k; v.x *= w; v.z *= w; v.y += 0.12 * Math.sin(a * 3 + seed * 2) * k * R * 0.3;
      v.y += 0.22 * R * k * Math.pow(Math.min(1, Math.abs(a) / (span / 2)), 2.5);   // fan tips curl up more
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const ix = g.index!.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }   // face outwards
    g.computeVertexNormals(); return { g, split: (n + 1) / prof.length };
  }
  function capMat(top: string, spot: string, gill: string, line: string, split: number): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonG });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { cTop: { value: new THREE.Color(top) }, cSpot: { value: new THREE.Color(spot) }, cGill: { value: new THREE.Color(gill) }, cLine: { value: new THREE.Color(line) }, uSplit: { value: split } });
      sh.vertexShader = 'varying vec2 vCap;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCap = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCap; uniform vec3 cTop, cSpot, cGill, cLine; uniform float uSplit;\n' + NOISE)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
          bool under = vCap.y > uSplit;
          float rr = under ? (1. - (vCap.y - uSplit) / (1. - uSplit)) : vCap.y / uSplit;          // 0 at the stem, 1 at the rim
          vec3 col;
          if (under) { float f = fract(vCap.x * 46.); float gl = smoothstep(.6, .75, f) * smoothstep(.95, .8, f) * smoothstep(.15, .4, rr);         // gill lines fanning out
            col = mix(cGill, cLine, gl * .8); }
          else { float sp = smoothstep(.62, .7, vnoise(vec2(vCap.x * 26., rr * 7.)));               // soft light spots on top
            col = mix(cTop, cSpot, sp * smoothstep(.3, .6, rr)); col = mix(col * .85, col, smoothstep(0., .25, rr)); }
          diffuseColor.rgb = col;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * (vCap.y > uSplit ? .45 : .12);   // gills stay bright salmon in the shade`);
    };
    return m;
  }
  const CAPCOL = M.caps;
  const fans: { m: THREE.Mesh; y: number; i: number; rz: number }[] = [];
  function fan(pos: THREE.Vector3, dir: THREE.Vector3, R: number): void {
    const { g, split } = capGeo(R, 3.5 + rnd() * 0.6, fans.length * 1.7);
    const m = inked(new THREE.Mesh(g, capMat(...CAPCOL[fans.length % CAPCOL.length], split)), M.ink.capWidth);
    m.position.copy(pos); m.rotation.order = 'YXZ'; m.rotation.y = -Math.atan2(dir.z, dir.x); m.rotation.z = 0.05 + rnd() * 0.1;   // the approved gentle tilt
    m.castShadow = m.receiveShadow = true; scene.add(m); fans.push({ m, y: pos.y, i: fans.length, rz: m.rotation.z });
  }
  tips.forEach(({ p, d, small }) => fan(p, d, small ? 0.55 + rnd() * 0.25 : 0.9 + rnd() * 0.35));
  // more fans spiralling up around the trunk
  for (let k = 0; k < 11; k++) {
    const t = 0.16 + k * 0.065, a = k * 2.4, p = trunk.getPointAt(Math.min(t, 0.95)), r = 0.5 * (1 - t) + 0.18;
    fan(new THREE.Vector3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r), new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)), 0.55 + rnd() * 0.35);
  }
  tick.push((t) => fans.forEach(({ m, y, i, rz }) => { m.position.y = y + Math.sin(t * 1.1 + i) * 0.02; m.rotation.z = rz + Math.sin(t * 0.8 + i * 1.7) * 0.03; }));

  // ---------- base: a flat patch with a ragged, burnt-paper edge (toasted, then charred, curling up a little) ----------
  {
    const TS = 360, RS = 28, ph = [...Array(6)].map(() => rnd() * 6.283);
    const R = (a: number): number => 2.1 * (1 + 0.13 * Math.sin(a * 2 + ph[0]) + 0.08 * Math.sin(a * 3 + ph[1]) + 0.05 * Math.sin(a * 7 + ph[2]) + 0.03 * Math.sin(a * 13 + ph[3]) + 0.018 * Math.sin(a * 29 + ph[4]) + 0.012 * Math.sin(a * 53 + ph[5]));   // wobbly outline, big waves + small tears
    const pos: number[] = [], edge: number[] = [], idx: number[] = [];
    const T = M.base.thickness;                                                              // slab thickness: trunk and roots sink into it
    pos.push(0, T, 0); edge.push(0);
    for (let r = 1; r <= RS; r++) for (let t = 0; t < TS; t++) {
      const a = (t / TS) * 6.283, f = r / RS, rr = R(a) * f, curl = 0.07 * Math.pow(f, 6) * (0.5 + 0.5 * Math.sin(a * 5 + ph[2]));
      pos.push(Math.cos(a) * rr, T + curl, Math.sin(a) * rr * 0.72); edge.push(f);
    }
    for (let t = 0; t < TS; t++) idx.push(0, 1 + ((t + 1) % TS), 1 + t);
    for (let r = 1; r < RS; r++) for (let t = 0; t < TS; t++) { const a = 1 + (r - 1) * TS + t, b = 1 + (r - 1) * TS + ((t + 1) % TS), c = a + TS, d = b + TS; idx.push(a, b, c, b, d, c); }
    // side wall: the outer ring again at ground level, joined to the rim
    const top0 = 1 + (RS - 1) * TS, bot0 = pos.length / 3;
    for (let t = 0; t < TS; t++) { const k = top0 + t; pos.push(pos[k * 3] * 0.985, 0, pos[k * 3 + 2] * 0.985); edge.push(1.04); }
    for (let t = 0; t < TS; t++) { const a = top0 + t, b = top0 + ((t + 1) % TS), c = bot0 + t, d = bot0 + ((t + 1) % TS); idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshToonMaterial({ color: M.flesh.color, gradientMap: toonG, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aEdge; varying float vE; varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vE = aEdge; vP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vE; varying vec3 vP;\n' + NOISE).replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
        float e = vE + (fbm(vP.xz * 2.2) - .5) * .16 + (vnoise(vP.xz * 14.) - .5) * .03;        // uneven burn line
        vec3 c = diffuseColor.rgb * mix(.94, 1.03, vnoise(vP.xz * 9.));                           // paper grain
        c = mix(c, ${v3(M.base.peach)}, smoothstep(.72, .86, e));                                  // peach, like the cap tops
        c = mix(c, ${v3(M.base.coral)}, smoothstep(.86, .93, e));                                // coral, like the gills
        c = mix(c, ${v3(M.base.rim)}, smoothstep(.94, .98, e));                                // deep coral rim
        diffuseColor.rgb = c;`);
    };
    const base = inked(new THREE.Mesh(g, m), 0.012); base.receiveShadow = true; base.userData.base = true; scene.add(base);   // base: dropped when placed in a world
  }


  return { camera, tick: (t) => tick.forEach((f) => f(t)) };
}
