import * as THREE from 'three';
import { MUSHTREE as M } from './palette';
import { NOISE, bands, outline, type Tick } from './helpers';

/** Builds the approved mushroom tree on its grey stage. Returns its camera and the per-frame tick. */
export function buildMushTree(scene: THREE.Scene, aspect: number): { camera: THREE.PerspectiveCamera; tick: Tick } {
  const ticks: Tick[] = [], U = { t: { value: 0 } };
  scene.background = new THREE.Color(M.background);
  const camera = new THREE.PerspectiveCamera(M.camera.fov, aspect, 0.1, 200); camera.position.set(...M.camera.position); camera.lookAt(...M.camera.target);
  const toonG = bands([95, 185, 255]);
  const inked = <T extends THREE.Mesh>(m: T, w: number = M.ink.width): T => { const o = outline(m.geometry, M.ink.color, w, 0.9); m.add(o); ticks.push((t) => (o.material.uniforms.t.value = t)); return m; };

  scene.add(new THREE.HemisphereLight(M.light.sky, M.light.ground, M.light.fill));
  const key = new THREE.DirectionalLight(M.light.key, M.light.keyIntensity); key.position.set(...M.light.keyPosition); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 8, bottom: -3, far: 40 }); key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.radius = 4;
  scene.add(key);

  // ground: a dirt patch
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(1, 64).scale(2.6, 1.3, 1), new THREE.MeshToonMaterial({ color: M.dirt, gradientMap: toonG }));
  dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.01; dirt.receiveShadow = true; scene.add(dirt);

  // trunk: one twisting, tapering birch trunk with spiral grooves and short dark marks
  const barkMat = new THREE.MeshToonMaterial({ color: M.trunk.color, gradientMap: toonG });
  barkMat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec2 vB;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vB = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vB;\n' + NOISE).replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
      float g = fract(vB.y * 5. + vB.x * 9.);
      diffuseColor.rgb *= mix(${M.trunk.grooveDepth.toFixed(2)}, 1., smoothstep(.0, .25, g) * smoothstep(1., .7, g));
      vec2 cell = vec2(vB.x * 46., vB.y * 7.); vec2 id = floor(cell), f = fract(cell);
      float on = step(.5, hash(id)), len = .25 + .5 * hash(id + 3.1), st = hash(id + 7.7) * (1. - len);
      float dash = on * smoothstep(.16, .06, abs(f.x - .5)) * smoothstep(st, st + .04, f.y) * smoothstep(st + len, st + len - .04, f.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${new THREE.Color(M.trunk.marks).toArray().map((v) => v.toFixed(3)).join(', ')}), dash * .85);`);
  };
  const trunkCurve = new THREE.CatmullRomCurve3([[0, 0, 0], [0.25, 0.8, 0.05], [-0.2, 1.6, -0.05], [0.12, 2.4, 0.04], [-0.05, 3.4, 0], [0.05, 4.2, -0.03], [0, 5.0, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  {
    const TS = 120, RS = 16, g = new THREE.TubeGeometry(trunkCurve, TS, 1, RS), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / (RS + 1)), t = ring / TS, ctr = trunkCurve.getPointAt(t);
      const rad = (0.42 * Math.pow(1 - t, 1.4) + 0.1) * (1 + 0.12 * Math.sin(t * 22 + (i % (RS + 1)) * 0.8));   // thick base, thin top, knobbly
      v.fromBufferAttribute(p, i).sub(ctr).multiplyScalar(rad).add(ctr); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const m = inked(new THREE.Mesh(g, barkMat), 0.012); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  for (let i = 0; i < 5; i++) {   // roots
    const a = i * 1.26 + 0.3, curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.5), new THREE.Vector3(Math.cos(a) * 1.15, 0.02, Math.sin(a) * 0.75)]);
    const r = inked(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.11 - i * 0.008, 8), barkMat), 0.01); r.castShadow = true; scene.add(r);
  }
  for (const cap of M.caps) for (const s of [-0.5, 0.5]) {   // two small branches under each cap
    const a = cap.angle + s, bc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, cap.y - 0.55, 0), new THREE.Vector3(Math.cos(a) * cap.r * 0.18, cap.y - 0.3, Math.sin(a) * cap.r * 0.18), new THREE.Vector3(Math.cos(a) * cap.r * 0.35, cap.y - 0.12, Math.sin(a) * cap.r * 0.35)]);
    const b = inked(new THREE.Mesh(new THREE.TubeGeometry(bc, 12, 0.05, 6), barkMat), 0.008); b.castShadow = true; scene.add(b);
  }

  // caps: partial lathe of a closed profile (top rising to the rim, gills underneath), fanning out to one side
  const capY = (s: number, R: number) => R * (0.05 * (1 - s * s) + M.curl.rim * Math.pow(s, 2.6));
  function capGeo(R: number, span: number, seed: number): { g: THREE.LatheGeometry; split: number } {
    const prof: THREE.Vector2[] = [], n = 26;
    for (let k = 0; k <= n; k++) { const s = k / n; prof.push(new THREE.Vector2(0.12 + s * R, capY(s, R))); }
    prof.push(new THREE.Vector2(R + 0.05, capY(1, R) - 0.05 * R));
    for (let k = n; k >= 0; k--) { const s = k / n; prof.push(new THREE.Vector2((0.12 + s * R) * 0.97, capY(s, R) - 0.11 * R * (1 - 0.4 * s) - 0.06)); }
    const g = new THREE.LatheGeometry(prof, 72, -span / 2, span), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const r = Math.hypot(v.x, v.z), a = Math.atan2(v.z, v.x), k = Math.pow(r / R, 2);
      const w = 1 + 0.07 * Math.sin(a * 5 + seed) * k; v.x *= w; v.z *= w; v.y += 0.12 * Math.sin(a * 3 + seed * 2) * k * R * 0.3;
      v.y += M.curl.tips * R * k * Math.pow(Math.min(1, Math.abs(a) / (span / 2)), 2.5);   // fan tips curl up
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const ix = g.index!.array as Uint16Array | Uint32Array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }   // face outwards
    g.computeVertexNormals(); return { g, split: (n + 1) / prof.length };
  }
  function capMat(cap: (typeof M.caps)[number], split: number): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonG });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { cTop: { value: new THREE.Color(cap.top) }, cSpot: { value: new THREE.Color(cap.spot) }, cGill: { value: new THREE.Color(cap.gill) }, cLine: { value: new THREE.Color(cap.line) }, uSplit: { value: split } });
      sh.vertexShader = 'varying vec2 vCap;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCap = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCap; uniform vec3 cTop, cSpot, cGill, cLine; uniform float uSplit;\n' + NOISE)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
          bool under = vCap.y > uSplit;
          float rr = under ? (1. - (vCap.y - uSplit) / (1. - uSplit)) : vCap.y / uSplit;
          vec3 col;
          if (under) { float f = fract(vCap.x * 46.); float gl = smoothstep(.6, .75, f) * smoothstep(.95, .8, f) * smoothstep(.15, .4, rr); col = mix(cGill, cLine, gl * .8); }
          else { float sp = smoothstep(.62, .7, vnoise(vec2(vCap.x * 26., rr * 7.))); col = mix(cTop, cSpot, sp * smoothstep(.3, .6, rr)); col = mix(col * .85, col, smoothstep(0., .25, rr)); }
          diffuseColor.rgb = col;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * (vCap.y > uSplit ? ${M.gillGlow.toFixed(2)} : .12);`);
    };
    return m;
  }
  const caps = M.caps.map((cap, i) => {
    const { g, split } = capGeo(cap.r, cap.span, i * 1.7), m = inked(new THREE.Mesh(g, capMat(cap, split)), M.ink.capWidth);
    m.position.set(0, cap.y, 0); m.rotation.set(cap.tilt, -cap.angle, i % 2 ? 0.05 : -0.05); m.castShadow = m.receiveShadow = true; scene.add(m);
    return { m, cap, i };
  });

  // spores drifting up
  const spores = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: M.spores }), 40), sd = new THREE.Object3D();
  const sps = [...Array(40)].map(() => [Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 10]); scene.add(spores);

  ticks.push((t) => {
    U.t.value = t;
    caps.forEach(({ m, cap, i }) => { m.rotation.x = cap.tilt + Math.sin(t * 0.9 + i) * 0.025; m.position.y = cap.y + Math.sin(t * 1.3 + i * 0.7) * 0.02; });
    sps.forEach(([x, z, s], i) => { const k = (t * 0.08 + s * 0.1) % 1; sd.position.set(x * (0.5 + k) + Math.sin(t + s) * 0.2, 2.6 + k * 3, z * 0.6 * (0.5 + k)); sd.scale.setScalar(Math.sin(k * Math.PI)); sd.updateMatrix(); spores.setMatrixAt(i, sd.matrix); });
    spores.instanceMatrix.needsUpdate = true;
  });
  return { camera, tick: (t) => ticks.forEach((f) => f(t)) };
}
