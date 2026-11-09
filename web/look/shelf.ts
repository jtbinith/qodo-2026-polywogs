import * as THREE from 'three';
import { SHELF as S } from './palette';
import { NOISE, bands, canvasTex, outline, type Tick } from './helpers';

/** Builds the approved shelf mushroom plant on its studio stage. Returns its camera and the per-frame tick. */
export function buildShelf(scene: THREE.Scene, aspect: number): { camera: THREE.PerspectiveCamera; tick: Tick } {
  const tick: Tick[] = [], toonG = bands([95, 185, 255]);
  let seed = S.seed; const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const inked = <T extends THREE.Mesh>(m: T, w: number = S.ink.width): T => { const o = outline(m.geometry, S.ink.color, w, 0.9); m.add(o); tick.push((t) => (o.material.uniforms.t.value = t)); m.castShadow = m.receiveShadow = true; return m; };
  const toon = (c: string): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color: c, gradientMap: toonG });

  scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, S.background[0]); gr.addColorStop(1, S.background[1]); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  const camera = new THREE.PerspectiveCamera(S.camera.fov, aspect, 0.1, 200); camera.position.set(...S.camera.position); camera.lookAt(...S.camera.target);
  scene.add(new THREE.HemisphereLight(S.light.sky, S.light.ground, S.light.fill));
  const key = new THREE.DirectionalLight(S.light.key, S.light.keyIntensity); key.position.set(...S.light.keyPosition); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2, far: 40 }); key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03; key.shadow.radius = 4; scene.add(key);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.18 })); catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);

  const g = new THREE.Group(); scene.add(g);
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

  // stalk: a tapering birch tube
  {
    const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.08, 0.5, 0), V(-0.05, 1.0, 0.02), V(0, 1.35, 0)]), TS = 32, RS = 10, geo = new THREE.TubeGeometry(curve, TS, 1, RS), p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { const t = Math.floor(i / (RS + 1)) / TS, c = curve.getPointAt(t); v.fromBufferAttribute(p, i).sub(c).multiplyScalar(S.stalk.r0 + (S.stalk.r1 - S.stalk.r0) * t).add(c); p.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals(); g.add(inked(new THREE.Mesh(geo, toon(S.stalk.color)), 0.008));
  }

  // caps: the approved mushroom-tree caps, with spore marks on top
  const capY = (s: number, R: number): number => R * (0.05 * (1 - s * s) + 0.13 * Math.pow(s, 2.6));
  function capGeo(R: number, span: number, sd: number): { geo: THREE.LatheGeometry; split: number } {
    const prof: THREE.Vector2[] = [], n = 26;
    for (let k = 0; k <= n; k++) { const s = k / n; prof.push(new THREE.Vector2(0.12 + s * R, capY(s, R))); }
    prof.push(new THREE.Vector2(R + 0.05, capY(1, R) - 0.05 * R));
    for (let k = n; k >= 0; k--) { const s = k / n, r = 0.12 + s * R; prof.push(new THREE.Vector2(r * 0.97, capY(s, R) - 0.11 * R * (1 - 0.4 * s) - 0.06)); }
    const geo = new THREE.LatheGeometry(prof, 72, -span / 2, span), p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const r = Math.hypot(v.x, v.z), a = Math.atan2(v.z, v.x), k = Math.pow(r / R, 2);
      const w = 1 + 0.07 * Math.sin(a * 5 + sd) * k; v.x *= w; v.z *= w; v.y += 0.12 * Math.sin(a * 3 + sd * 2) * k * R * 0.3;
      v.y += 0.22 * R * k * Math.pow(Math.min(1, Math.abs(a) / (span / 2)), 2.5);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const ix = geo.index!.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    geo.computeVertexNormals(); return { geo, split: (n + 1) / prof.length };
  }
  function capMat(split: number, spores: number): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonG }), col = (h: string) => ({ value: new THREE.Color(h) });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { cTop: col(S.cap.top), cSpot: col(S.cap.spot), cGill: col(S.cap.gill), cLine: col(S.cap.line), cSpore: col(S.spores.color), uSplit: { value: split }, uSpores: { value: spores } });
      sh.vertexShader = 'varying vec2 vCap;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCap = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCap; uniform vec3 cTop, cSpot, cGill, cLine, cSpore; uniform float uSplit, uSpores;\n' + NOISE)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
          bool under = vCap.y > uSplit;
          float rr = under ? (1. - (vCap.y - uSplit) / (1. - uSplit)) : vCap.y / uSplit;
          vec3 col;
          if (under) { float f = fract(vCap.x * 46.); float gl = smoothstep(.6, .75, f) * smoothstep(.95, .8, f) * smoothstep(.15, .4, rr); col = mix(cGill, cLine, gl * .8); }
          else { float sp = smoothstep(.62, .7, vnoise(vec2(vCap.x * 26., rr * 7.)));
            col = mix(cTop, cSpot, sp * smoothstep(.3, .6, rr)); col = mix(col * .85, col, smoothstep(0., .25, rr));
            vec2 sc = vec2(vCap.x * 24., rr * 6.); vec2 sid = floor(sc), sf = fract(sc) - .5;           // spore specks: dense by the stalk, thinning out to the rim
            float speck = step(1. - min(.95, uSpores * 1.7 * pow(1. - rr, 1.4)), hash(sid)) * smoothstep(.36, .28, length(sf + (vec2(hash(sid + 1.3), hash(sid + 2.7)) - .5) * .25));
            col = mix(col, cSpore, speck * .95);
            col = mix(col, cSpore, uSpores * smoothstep(.5, .7, fbm(vec2(vCap.x * 8., rr * 3.))) * (1. - rr * .6) * .3); }   // soft patches
          diffuseColor.rgb = col;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * (vCap.y > uSplit ? ${S.gillGlow.toFixed(2)} : .12);`);
    };
    return m;
  }
  S.caps.forEach(({ y, r, angle, spores }, i) => {
    const { geo, split } = capGeo(r, 3.6, i * 1.7), m = inked(new THREE.Mesh(geo, capMat(split, spores)), S.ink.capWidth);
    m.position.set(0, y, 0); m.rotation.set(0.08, -angle, 0.05); g.add(m);
  });

  // spores drifting down off the gills
  const sp = new THREE.InstancedMesh(new THREE.SphereGeometry(S.spores.size, 10, 6), new THREE.MeshBasicMaterial({ color: S.spores.color }), S.spores.count), d = new THREE.Object3D();
  const seeds = [...Array(S.spores.count)].map(() => [rnd() * 6.28, 0.1 + rnd() * 0.35, rnd() * 10]);
  sp.frustumCulled = false; g.add(sp);
  tick.push((t) => { seeds.forEach(([a, r, s0], i) => { const k = (t * 0.12 + s0 * 0.1) % 1; d.position.set(Math.cos(a + t * 0.3) * r, 1.15 - k * 1.15, Math.sin(a + t * 0.3) * r); d.scale.setScalar(Math.sin(k * Math.PI)); d.updateMatrix(); sp.setMatrixAt(i, d.matrix); }); sp.instanceMatrix.needsUpdate = true; });

  // ground: a little cream patch with a coral rim
  {
    const geo = new THREE.CircleGeometry(0.65, 48), p = geo.attributes.position;
    for (let i = 1; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)), k = 1 + 0.12 * Math.sin(a * 5 + 0.65 * 7) + 0.05 * Math.sin(a * 13); p.setXY(i, p.getX(i) * k, p.getY(i) * k * 0.8); }
    const m = new THREE.Mesh(geo, toon(S.patch.color)); m.rotation.x = -Math.PI / 2; m.position.y = 0.005; m.receiveShadow = true;
    const rim = new THREE.Mesh(geo.clone().scale(1.08, 1.08, 1), toon(S.patch.rim)); rim.position.z = -0.002; m.add(rim); g.add(m);
  }
  tick.push((t) => (g.rotation.z = Math.sin(t * 0.9) * 0.016));   // a gentle sway

  return { camera, tick: (t) => tick.forEach((f) => f(t)) };
}
