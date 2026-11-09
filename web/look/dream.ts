import * as THREE from 'three';
import { DREAM as D } from './palette';
import { bands, brushTex, canvasTex, cubeGeo, outline, spring, type Tick } from './helpers';

/** Builds the approved dream-meadow combo exactly as approved. Returns its camera and the per-frame tick. */
export function buildDream(scene: THREE.Scene, aspect: number): { camera: THREE.PerspectiveCamera; tick: Tick } {
  const ticks: Tick[] = [];
  scene.background = new THREE.Color(D.sky);
  const camera = new THREE.PerspectiveCamera(D.camera.fov, aspect, 0.1, 200); camera.position.set(...D.camera.position); camera.lookAt(...D.camera.lookAt);
  scene.fog = new THREE.Fog(D.fog.color, D.fog.near, D.fog.far);
  scene.add(new THREE.HemisphereLight(D.fill.sky, D.fill.ground, D.fill.intensity));
  const moon = new THREE.DirectionalLight(D.moon.color, D.moon.intensity); moon.position.set(...D.moon.position); moon.castShadow = true;
  Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, far: 40 }); moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0004; moon.shadow.radius = D.moon.shadowSoftness;
  scene.add(moon);

  // the painted meadow: swaying brush-stroke cards
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshLambertMaterial({ color: D.ground })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const U = { t: { value: 0 } };
  const cardMat = new THREE.MeshLambertMaterial({ map: brushTex(), alphaTest: 0.35, side: THREE.DoubleSide, emissive: D.meadow.emissive });
  cardMat.onBeforeCompile = (sh) => { sh.uniforms.uT = U.t; sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec4 ip = instanceMatrix * vec4(0.,0.,0.,1.); float k = uv.y * uv.y;
    transformed.x += k * (sin(uT * 1.3 + ip.x * .6 + ip.z * .4) * .12 + sin(uT * 3.1 + ip.z) * .04);`); };
  const N = D.meadow.cards, cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(...D.meadow.card).translate(0, D.meadow.card[1] / 2, 0), cardMat, N), d = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    let r: number, a: number; do { r = Math.sqrt(Math.random()) * D.meadow.to; a = Math.random() * 6.283; } while (r < D.meadow.from);
    d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); d.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 6.283, (Math.random() - 0.5) * 0.5); d.scale.setScalar(0.6 + Math.random() * 0.9); d.updateMatrix();
    cards.setMatrixAt(i, d.matrix);
    const onPath = Math.sin(d.position.x * 0.9) > 0.55;          // magenta paths through the meadow
    col.set(onPath ? D.meadow.path : D.meadow.palette[i % D.meadow.palette.length]).multiplyScalar(D.meadow.brightness[0] + Math.random() * (D.meadow.brightness[1] - D.meadow.brightness[0])); cards.setColorAt(i, col);
  }
  cards.receiveShadow = true; scene.add(cards);

  // stars
  const sp = new Float32Array(D.stars.count * 3).map((_, i) => (i % 3 === 1 ? 4 + Math.random() * 25 : (Math.random() - 0.5) * 80 - (i % 3 === 2 ? 25 : 0)));
  scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)), new THREE.PointsMaterial({ color: D.stars.color, size: D.stars.size, fog: false })));

  // toy toon creatures with boiling ink outlines
  const toonG = bands(D.toon.bands);
  const cg = cubeGeo(1.2), cube = new THREE.Mesh(cg, new THREE.MeshToonMaterial({ color: D.creatures.cube, gradientMap: toonG })); cube.castShadow = true; scene.add(cube);
  const sg = new THREE.SphereGeometry(0.55, 64, 32).translate(0, 0.55, 0), ball = new THREE.Mesh(sg, new THREE.MeshToonMaterial({ color: D.creatures.ball, gradientMap: toonG })); ball.castShadow = true; scene.add(ball);
  const o1 = outline(cg, D.ink.color, D.ink.width, D.ink.boil), o2 = outline(sg, D.ink.color, 0.013, D.ink.boil); cube.add(o1); ball.add(o2);
  cube.position.set(-0.7, 0, 0.2); ball.position.set(1.3, 0, 0.6);

  // the warm lantern
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12), new THREE.MeshBasicMaterial({ color: D.lantern.core })); scene.add(lantern);
  const glow = new THREE.PointLight(D.lantern.light, D.lantern.intensity, 3.5, 1.8); scene.add(glow);
  const haloTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, D.lantern.halo[0]); gr.addColorStop(0.25, D.lantern.halo[1]); gr.addColorStop(1, D.lantern.halo[2]); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 })); halo.scale.setScalar(2.2); scene.add(halo);
  const fill = new THREE.DirectionalLight(D.frontMoon.color, D.frontMoon.intensity); fill.position.set(...D.frontMoon.position); scene.add(fill);   // front moonlight so the toon bands show

  ticks.push((t) => {
    U.t.value = t; o1.material.uniforms.t.value = t; o2.material.uniforms.t.value = t;
    const br = 1 + Math.sin(t * 2.2) * 0.04; cube.scale.set(1 / Math.sqrt(br), br, 1 / Math.sqrt(br)); cube.rotation.y = 0.5 + Math.sin(t * 0.6) * 0.3;
    const ph = (t * 0.9) % 1, hop = 4 * ph * (1 - ph), land = spring(t * 0.9, 1, 22, 6) * 0.18;
    ball.position.y = hop * 0.9; ball.scale.set(1 + land, 1 - land * 1.6, 1 + land);
    lantern.position.set(0.2 + Math.sin(t * 2) * 0.05, 0.6 + Math.sin(t * 3) * 0.06, 0.9); glow.position.copy(lantern.position); glow.intensity = 5 + Math.sin(t * 9) * 0.7; halo.position.copy(lantern.position); halo.scale.setScalar(2.1 + Math.sin(t * 9) * 0.08);
  });
  return { camera, tick: (t) => ticks.forEach((f) => f(t)) };
}
