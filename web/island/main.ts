import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DREAM as D, ROCKS, type RockColour } from '../look/palette';
import { bands, cubeGeo, outline, spring, type Tick } from '../look/helpers';
import { GROUND_Y, KINDS, buildIsland, type IslandLayout, type Item, type Kind } from '../look/island';
import { EXAMPLE_ISLAND, MEADOW_ISLAND } from './layout';
import { addCreatures } from './creatures';

// The test island: walk it as the cube (it climbs!), or open with ?edit to lay it out.
const q = new URLSearchParams(location.search), fixedT = q.has('t') ? Number(q.get('t')) : null, EDIT = q.has('edit'), WALKER = q.has('walker');   // ?walker = walk it as the toy cube
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = D.render.exposure;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200), ticks: Tick[] = [];
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), D.render.bloom.strength, D.render.bloom.radius, D.render.bloom.threshold)); composer.addPass(new OutputPass());

const base = q.get('layout') === 'example' ? EXAMPLE_ISLAND : MEADOW_ISLAND;   // just the meadow to start; ?layout=example for the one with things on it
const L: IslandLayout = { ...base, seed: q.has('seed') ? Number(q.get('seed')) : base.seed };
const island = buildIsland(scene, L); ticks.push(island.tick);

// ---------- the cube ----------
const cube = new THREE.Group(); scene.add(cube);
const cg = cubeGeo(0.6, 0.09, 16), body = new THREE.Mesh(cg, new THREE.MeshToonMaterial({ color: D.creatures.cube, gradientMap: bands(D.toon.bands) }));
{ const o = outline(cg, D.ink.color, D.ink.width, D.ink.boil, false); body.add(o); ticks.push((t) => (o.material.uniforms.t.value = t)); }
body.castShadow = true; cube.add(body); cube.position.set(0, GROUND_Y, 0); cube.visible = WALKER && !EDIT;

const keys = new Set<string>();
addEventListener('keydown', (e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') keys.add(e.key.toLowerCase()); }); addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let target: THREE.Vector3 | null = null;
{ const ray = new THREE.Raycaster(), v = new THREE.Vector2();
  // a click (not a drag, which turns the camera) walks the cube there
  let downAt = { x: 0, y: 0 };
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => { if (EDIT || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    v.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(v, camera); const h = ray.intersectObjects(island.solids(), false)[0]; if (h) target = h.point.clone(); }); }

if (WALKER) document.getElementById('help')!.textContent = 'WASD / arrows to move · click the ground to walk there · drag to look around · scroll to zoom';
// walk mode camera: drag to look around the cube, scroll to zoom; it keeps following the cube
const look = EDIT ? null : new OrbitControls(camera, renderer.domElement);
if (look) { camera.position.set(0, GROUND_Y + (WALKER ? 6.5 : 8), WALKER ? 8.5 : 12); look.target.set(0, GROUND_Y + 0.4, 0);
  Object.assign(look, { enablePan: !WALKER, screenSpacePanning: false, enableDamping: true, minDistance: 2.5, maxDistance: 30, maxPolarAngle: 1.45 }); look.update(); }

// drop a Tinkercad STL on the page and it lands as a creature where you're looking (or near the cube with ?walker)
if (!EDIT) ticks.push(addCreatures(scene, camera, island, () => (WALKER || !look ? cube.position : look.target)));

// climbing: stand on whatever is underneath; push into something and the cube scrambles up it
const down = new THREE.Raycaster(), ahead = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0);
const vel = new THREE.Vector3(), camAt = new THREE.Vector3(0, GROUND_Y, 0);
let last = 0, hopT = 0, facing = 0, vy = 0, climbing = false;
function step(t: number): void {
  if (EDIT) return;
  if (!WALKER) { look?.update(); return; }   // free camera: just keep it gliding
  const dt = Math.min(0.05, t - last); last = t; if (dt <= 0) return;
  const solids = island.solids();
  const inp = new THREE.Vector3((keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0), 0, (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0));
  if (inp.lengthSq() > 0) { target = null; if (look) inp.applyAxisAngle(new THREE.Vector3(0, 1, 0), look.getAzimuthalAngle()); }   // W = away from the camera, wherever it's turned
  else if (target) { inp.subVectors(target, cube.position).setY(0); if (inp.length() < 0.15) { target = null; inp.set(0, 0, 0); } }
  if (inp.lengthSq() > 0) inp.normalize();
  vel.lerp(inp.clone().multiplyScalar(2.6), Math.min(1, dt * 8));
  const p = cube.position, speed = Math.hypot(vel.x, vel.z);
  // something in the way at body height? climb it instead of walking through
  climbing = false;
  if (speed > 0.2) {
    ahead.set(new THREE.Vector3(p.x, p.y + 0.3, p.z), new THREE.Vector3(vel.x, 0, vel.z).normalize()); ahead.far = 0.4;
    if (ahead.intersectObjects(solids, false).length) climbing = true;
  }
  if (climbing) { p.y += 1.8 * dt; vy = 0; }
  else {
    p.x += vel.x * dt; p.z += vel.z * dt;
    const a = Math.atan2(p.z, p.x), lim = island.edgeR(a) - 0.5; if (Math.hypot(p.x, p.z) > lim) { p.x = Math.cos(a) * lim; p.z = Math.sin(a) * lim; }
    // the surface under the cube (looking down from a little above it, so it can step up small ledges)
    down.set(new THREE.Vector3(p.x, p.y + 0.35, p.z), DOWN); down.far = 40;
    const floor = down.intersectObjects(solids, false)[0]?.point.y ?? GROUND_Y;
    if (p.y <= floor + 0.02) { p.y += Math.min(floor - p.y, 3 * dt) ; vy = 0; }   // on it (or stepping up onto it)
    else { vy -= 14 * dt; p.y = Math.max(floor, p.y + vy * dt); if (p.y === floor) vy = 0; }   // falling off an edge
  }
  // hop while walking, wiggle while climbing, squash on landing, face where it goes
  if (speed > 0.2) { hopT += dt * (climbing ? 6 : 3.2); facing = Math.atan2(vel.x, vel.z); }
  const ph = hopT % 1, hop = speed > 0.2 && !climbing && vy === 0 ? 4 * ph * (1 - ph) * 0.3 : 0, land = speed > 0.2 ? spring(hopT, 1, 22, 6) * 0.12 : 0, br = 1 + Math.sin(t * 2.2) * 0.03;
  body.position.y = hop; body.scale.set((1 + land) / Math.sqrt(br), (1 - land * 1.6) * br, (1 + land) / Math.sqrt(br));
  body.rotation.x += ((climbing ? -0.5 : 0) - body.rotation.x) * Math.min(1, dt * 10);                // leans back against the wall
  body.rotation.z = climbing ? Math.sin(hopT * 6.283) * 0.18 : body.rotation.z * 0.8;                  // scrabbles side to side
  cube.rotation.y += ((facing - cube.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 10);
  const before = camAt.clone(); camAt.lerp(p, Math.min(1, dt * 3));
  if (look) { const moved = camAt.clone().sub(before); camera.position.add(moved); look.target.set(camAt.x, camAt.y + 0.4, camAt.z); look.update(); }
}

// ---------- edit mode (?edit): put anything anywhere, any size, any turn, any height ----------
if (EDIT) {
  document.getElementById('help')!.textContent = 'EDIT · drag to move · click to select · R / Shift+R turn · + / - size · PageUp / PageDown height · Delete remove';
  const controls = new OrbitControls(camera, renderer.domElement); camera.position.set(0, 14, 12); controls.target.set(0, 0, 0); controls.maxPolarAngle = 1.35; controls.update();
  const css = 'font:12px Courier New,monospace;color:#4a1d4f';
  const panel = document.createElement('div');
  panel.style.cssText = `position:fixed;top:12px;left:12px;display:flex;flex-direction:column;gap:5px;padding:10px;border-radius:10px;background:rgba(255,246,230,.94);width:230px;${css}`;
  const stones = Object.keys(ROCKS.colours) as RockColour[];
  panel.innerHTML = `<b>Add</b>${(Object.keys(KINDS) as Kind[]).map((k) => `<button data-add="${k}">+ ${KINDS[k].label}</button>`).join('')}
    <label>stone colour for new rocks <select id="stone">${stones.map((s) => `<option>${s}</option>`).join('')}</select></label>
    <hr style="width:100%"><b id="selName">Nothing selected</b>
    <div id="selCtl" style="display:none;flex-direction:column;gap:4px">
      <label>size <input id="size" type="range" min="0.2" max="4" step="0.02"></label>
      <label>turn <input id="turn" type="range" min="0" max="6.283" step="0.01"></label>
      <label>height <input id="height" type="range" min="-0.5" max="4" step="0.02"></label>
      <label id="colWrap">stone <select id="col">${stones.map((s) => `<option>${s}</option>`).join('')}</select></label>
      <div style="display:flex;gap:4px"><button id="dup">Duplicate</button><button id="del">Delete</button></div>
    </div>
    <hr style="width:100%"><button id="copy">Copy layout</button><textarea id="out" rows="6" style="font:11px monospace" readonly placeholder="layout appears here"></textarea>`;
  document.body.appendChild(panel);
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y), v = new THREE.Vector2(), hit = new THREE.Vector3();
  let sel: Item | null = null, dragging = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: D.ink.color, transparent: true, opacity: 0.9, depthTest: false })); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 9; ring.visible = false; scene.add(ring);
  const showSel = (): void => {
    ring.visible = !!sel; $('selCtl').style.display = sel ? 'flex' : 'none'; $('selName').textContent = sel ? KINDS[sel.p.kind].label : 'Nothing selected';
    if (!sel) return;
    const k = KINDS[sel.p.kind]; ring.scale.setScalar(Math.max(0.3, k.room * (sel.g.scale.x / k.scale))); ring.position.set(sel.g.position.x, GROUND_Y + 0.03, sel.g.position.z);
    ($('size') as HTMLInputElement).value = String(sel.g.scale.x / k.scale); ($('turn') as HTMLInputElement).value = String(((sel.g.rotation.y % 6.283) + 6.283) % 6.283);
    ($('height') as HTMLInputElement).value = String(sel.g.position.y - GROUND_Y); $('colWrap').style.display = sel.p.kind === 'rocks' ? '' : 'none'; ($('col') as HTMLSelectElement).value = sel.p.colour ?? 'slate';
  };
  const sync = (): void => { island.items.forEach(({ p, g }) => { p.x = +g.position.x.toFixed(2); p.z = +g.position.z.toFixed(2); p.y = +(g.position.y - GROUND_Y).toFixed(2); p.ry = +g.rotation.y.toFixed(2); p.s = +g.scale.x.toFixed(3); }); island.regrow(); };
  const pointer = (e: PointerEvent): void => { v.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(v, camera); };
  const onLand = (x: number, z: number): boolean => Math.hypot(x, z) < island.edgeR(Math.atan2(z, x)) - 0.3;
  const itemOf = (o: THREE.Object3D | null): Item | null => { while (o && !o.userData.item) o = o.parent; return o ? island.items.find((i) => i.g === o) ?? null : null; };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointer(e); const h = ray.intersectObjects(island.items.map((i) => i.g), true).find((x) => !(x.object as THREE.Sprite).isSprite);
    sel = h ? itemOf(h.object) : null; if (sel) { dragging = true; controls.enabled = false; } showSel();
  });
  renderer.domElement.addEventListener('pointermove', (e) => { if (!dragging || !sel) return; pointer(e); if (ray.ray.intersectPlane(ground, hit) && onLand(hit.x, hit.z)) { sel.g.position.x = hit.x; sel.g.position.z = hit.z; showSel(); } });
  addEventListener('pointerup', () => { if (dragging) { dragging = false; controls.enabled = true; sync(); } });
  const bump = (fn: (g: THREE.Group) => void): void => { if (!sel) return; fn(sel.g); showSel(); sync(); };
  addEventListener('keydown', (e) => {
    if (!sel || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'r' || e.key === 'R') bump((g) => (g.rotation.y += e.shiftKey ? -0.3 : 0.3));
    else if (e.key === '+' || e.key === '=') bump((g) => g.scale.multiplyScalar(1.1));
    else if (e.key === '-') bump((g) => g.scale.multiplyScalar(0.9));
    else if (e.key === 'PageUp') bump((g) => (g.position.y += 0.1));
    else if (e.key === 'PageDown') bump((g) => (g.position.y -= 0.1));
    else if (e.key === 'Delete' || e.key === 'Backspace') { island.remove(sel.g); sel = null; showSel(); sync(); }
  });
  $('size').addEventListener('input', (e) => bump((g) => g.scale.setScalar(Number((e.target as HTMLInputElement).value) * KINDS[sel!.p.kind].scale)));
  $('turn').addEventListener('input', (e) => bump((g) => (g.rotation.y = Number((e.target as HTMLInputElement).value))));
  $('height').addEventListener('input', (e) => bump((g) => (g.position.y = GROUND_Y + Number((e.target as HTMLInputElement).value))));
  const rebuild = (p: typeof island.items[0]['p'], from: THREE.Group): Item => { const it = island.add({ ...p, x: from.position.x, z: from.position.z, y: from.position.y - GROUND_Y, ry: from.rotation.y, s: from.scale.x }); return it; };
  $('col').addEventListener('change', (e) => { if (!sel) return; const old = sel; const it = rebuild({ ...old.p, colour: (e.target as HTMLSelectElement).value as RockColour }, old.g); island.remove(old.g); sel = it; showSel(); sync(); });
  $('dup').addEventListener('click', () => { if (!sel) return; const it = rebuild(sel.p, sel.g); it.g.position.x += 0.8; it.g.position.z += 0.8; sel = it; showSel(); sync(); });
  $('del').addEventListener('click', () => { if (!sel) return; island.remove(sel.g); sel = null; showSel(); sync(); });
  panel.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const t = controls.target, kind = b.dataset.add as Kind, p = { kind, x: +t.x.toFixed(2), z: +t.z.toFixed(2), ry: 0, ...(kind === 'rocks' ? { colour: ($('stone') as HTMLSelectElement).value as RockColour } : {}) };
    sel = island.add(p); showSel(); sync();
  }));
  $('copy').addEventListener('click', () => { const txt = JSON.stringify(island.layout(), null, 2); ($('out') as HTMLTextAreaElement).value = txt; navigator.clipboard?.writeText(txt).catch(() => {}); });
}

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });
const w = window as unknown as { __frames: number }; w.__frames = 0;
renderer.setAnimationLoop((now) => { const t = fixedT ?? now / 1000; step(fixedT !== null ? t + w.__frames / 60 : t); ticks.forEach((f) => f(t)); composer.render(); w.__frames++; });
