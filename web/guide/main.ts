import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CEL_WATER, DREAM, LEAVES, type LeafPalette, MUSHTREE } from '../look/palette';
import { buildMushTree } from '../look/mushtree';
import { buildDream } from '../look/dream';
import { celWater, type WaterOptions } from '../look/water';
import { buildLeaves } from '../look/leaves';
import { bands, outline, spring } from '../look/helpers';
import type { Tick } from '../look/helpers';

const q = new URLSearchParams(location.search);
const W = 1280, H = 720;
const swatches = (list: [string, string][]) => `<div class="row">${list.map(([n, h]) => `<div class="sw"><div class="chip" style="background:${h}"></div><div class="meta"><b>${n}</b><span>${h}</span></div></div>`).join('')}</div>`;
const recipe = (list: [string, string][]) => `<ul class="recipe">${list.map(([k, v]) => `<li><b>${k}:</b> ${v}</li>`).join('')}</ul>`;

interface Live { canvas: HTMLCanvasElement; render: (t: number) => void; visible: boolean }
const lives: Live[] = [];
function item(id: string, n: number, title: string, from: string, how: string, body: string): HTMLCanvasElement {
  const el = document.createElement('section'); el.className = 'item'; el.id = id;
  el.innerHTML = `<span class="tag">Approved ${n}</span><h2>${title}</h2><p class="from">${from}</p><p class="how">${how}</p><canvas width="${W}" height="${H}"></canvas>${body}`;
  document.getElementById('approved')!.appendChild(el); return el.querySelector('canvas')!;
}

// one renderer per approved item, so each keeps exactly its own approved settings
function liveScene(canvas: HTMLCanvasElement, setup: (r: THREE.WebGLRenderer, scene: THREE.Scene) => { camera: THREE.Camera; tick: Tick; composer?: EffectComposer }): void {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(W, H, false);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), s = setup(r, scene);
  lives.push({ canvas, visible: false, render: (t) => { s.tick(t); s.composer ? s.composer.render() : r.render(scene, s.camera); } });
}

// ---------- approved 1: dream meadow (combo) ----------
const dreamCanvas = item('dream', 1, DREAM.name, DREAM.from, DREAM.how, `
  <h3>Colours</h3>${swatches([['Sky', DREAM.sky], ['Fog', DREAM.fog.color], ['Fill from sky', DREAM.fill.sky], ['Fill from ground', DREAM.fill.ground], ['Moonlight', DREAM.moon.color], ['Front moonlight', DREAM.frontMoon.color], ['Ground', DREAM.ground], ['Stars', DREAM.stars.color]])}
  <h3>Meadow</h3>${swatches([...DREAM.meadow.palette.map((h, i): [string, string] => [`Meadow ${i + 1}`, h]), ['Paths', DREAM.meadow.path], ['Glow in shade', DREAM.meadow.emissive]])}
  <h3>Creatures, ink and lantern</h3>${swatches([['Toy cube', DREAM.creatures.cube], ['Toy ball', DREAM.creatures.ball], ['Ink line', DREAM.ink.color], ['Lantern', DREAM.lantern.core], ['Lantern light', DREAM.lantern.light]])}
  <h3>Recipe</h3>${recipe([
    ['Meadow', `${DREAM.meadow.cards.toLocaleString()} brush-stroke cards, ${DREAM.meadow.card.join(' x ')}, from ${DREAM.meadow.from} to ${DREAM.meadow.to} units out; tips sway in the wind`],
    ['Meadow colour', `palette in turn at ${DREAM.meadow.brightness.map((b) => b * 100 + '%').join('-')} brightness; paths where sin(x * 0.9) > 0.55`],
    ['Toy toon', `MeshToon in ${DREAM.toon.bands.length} hard bands (${DREAM.toon.bands.join(' / ')}), lit by moonlight + the warm lantern`],
    ['Ink lines', `inverted-hull outline ${DREAM.ink.width} wide, boil ${DREAM.ink.boil}, redrawn ${DREAM.ink.redrawsPerSecond} times a second`],
    ['Light', `hemisphere ${DREAM.fill.intensity}, moon ${DREAM.moon.intensity} (soft shadows ${DREAM.moon.shadowSoftness}), front moon ${DREAM.frontMoon.intensity}, lantern ${DREAM.lantern.intensity}`],
    ['Air', `fog ${DREAM.fog.near}-${DREAM.fog.far}, ${DREAM.stars.count.toLocaleString()} stars`],
    ['Finish', `${DREAM.render.toneMapping} exposure ${DREAM.render.exposure}; bloom ${DREAM.render.bloom.strength} / ${DREAM.render.bloom.radius} / ${DREAM.render.bloom.threshold}`],
    ['Motion', 'cube breathes and turns; ball hops and squashes on landing; lantern bobs and flickers'],
  ])}`);
liveScene(dreamCanvas, (r, scene) => {
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = DREAM.render.exposure;
  const { camera, tick } = buildDream(scene, W / H);
  const composer = new EffectComposer(r); composer.setSize(W, H); composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), DREAM.render.bloom.strength, DREAM.render.bloom.radius, DREAM.render.bloom.threshold)); composer.addPass(new OutputPass());
  return { camera, tick, composer };
});

// ---------- approved 2: water (2 versions) ----------
const waterBody = (label: string) => `<h3>${label}</h3><canvas width="${W}" height="${H}"></canvas>`;
const waterEl = item('water', 2, CEL_WATER.name, 'W1 open water, W3 pond with shore', CEL_WATER.how, `
  ${waterBody('W3 · pond: + star sparkles + sandy shore')}
  <h3>Colours</h3>${swatches([['Water deep', CEL_WATER.deep], ['Water light', CEL_WATER.light], ['Foam', CEL_WATER.foam], ['Star sparkle', CEL_WATER.sparkle], ['Sand', CEL_WATER.sand]])}
  <h3>Recipe</h3>${recipe([['Surface', '2 flat colours from slow noise, no gradients'],
    ['Foam rings', `every ${(1 / CEL_WATER.rings.spacing).toFixed(2)} units, drifting out at ${CEL_WATER.rings.speed}; noise wobbles them (${CEL_WATER.rings.wobble}), changes their width and breaks them up`],
    ['Star sparkles', `4-pointed gold stars in about ${CEL_WATER.sparkles.share * 100}% of spots, twinkling on and off`],
    ['Sandy shore', `outer ${Math.round((1 - CEL_WATER.shore.from) * 100)}% of a pond turns to sand, with a wobbly foam line where water meets it`]])}`);
const [w1Canvas, w3Canvas] = [...waterEl.closest('section')!.querySelectorAll('canvas')];
w1Canvas.insertAdjacentHTML('beforebegin', '<h3>W1 · open water: noisy foam rings</h3>');
const waterScene = (canvas: HTMLCanvasElement, o: WaterOptions) => liveScene(canvas, (_r, scene) => {
  scene.background = new THREE.Color('#e9e4da'); const { mesh, tick } = celWater(o); scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 50); camera.position.set(0, 4.2, 5.2); camera.lookAt(0, 0, 0.2); return { camera, tick }; });
waterScene(w1Canvas, { rings: true }); waterScene(w3Canvas, { rings: true, sparkles: true, shore: true });

// ---------- approved 3: mushroom tree ----------
const treeCanvas = item('mushtree', 3, MUSHTREE.name, MUSHTREE.from, MUSHTREE.how, `
  <h3>Caps</h3>${swatches(MUSHTREE.caps.flatMap((c, i): [string, string][] => [[`Cap ${i + 1} top`, c.top], [`Cap ${i + 1} spots`, c.spot], [`Cap ${i + 1} gills`, c.gill]]))}
  <h3>Trunk, ink and ground</h3>${swatches([['Birch trunk', MUSHTREE.trunk.color], ['Birch marks', MUSHTREE.trunk.marks], ['Ink line', MUSHTREE.ink.color], ['Dirt', MUSHTREE.dirt], ['Stage', MUSHTREE.background]])}
  <h3>Recipe</h3>${recipe([
    ['Caps', `${MUSHTREE.caps.length} fan-shaped caps from a part-round lathe: top rises to the rim (${MUSHTREE.curl.rim}), fan tips curl up (${MUSHTREE.curl.tips}), wavy rim`],
    ['Cap colour', 'peach top with soft noise spots; salmon gill lines underneath that stay bright in shade (glow ' + MUSHTREE.gillGlow + ')'],
    ['Trunk', 'one twisting tube, thick base tapering to the top, slightly knobbly; spiral grooves + short dark birch dashes'],
    ['Ink lines', `inverted-hull outline ${MUSHTREE.ink.width} (caps ${MUSHTREE.ink.capWidth}), boiling like the dream meadow`],
    ['Ground', 'a dirt patch'],
    ['Motion', 'caps sway gently, spores drift up'],
  ])}`);
liveScene(treeCanvas, (r, scene) => {
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  const { camera, tick } = buildMushTree(scene, W / H);
  return { camera, tick };
});

// ---------- approved 4: maple leaves (3 colour sets) ----------
const leafPal: LeafPalette = (q.get('leaves') as LeafPalette) ?? 'golden';
const leafCanvas = item('leaves', 4, LEAVES.name, `maple, ${LEAVES.size}x, colour sets: ${Object.values(LEAVES.paletteNames).join(', ')}`, LEAVES.how, `
  <div class="ctl" style="margin-top:12px">Colours ${(Object.keys(LEAVES.palettes) as LeafPalette[]).map((k) => `<a class="pill ${k === leafPal ? 'on' : ''}" href="?leaves=${k}#leaves">${LEAVES.paletteNames[k]}</a>`).join('')}</div>
  ${(Object.keys(LEAVES.palettes) as LeafPalette[]).map((k) => `<h3>${LEAVES.paletteNames[k]}</h3>${swatches([...LEAVES.palettes[k].map((h, i): [string, string] => [`Leaf ${i + 1}`, h]), ['Glow tint', LEAVES.glowTint[k]]])}`).join('')}
  <h3>Recipe</h3>${recipe([
    ['Shape', `maple: 5 pointed lobes with small teeth, ${LEAVES.size}x size`],
    ['Ground', `${LEAVES.count.toLocaleString()} leaves: 75% in drifts around a few centres, the rest scattered`],
    ['Kicked up', 'every leaf the walker touches flies up, tumbles, flutters side to side, drifts down slowly and settles flat'],
    ['Glow', `about 1 in ${Math.round(1 / LEAVES.glow.share)} kicked-up leaves, only while in the air, when it faces the sun; a lighter tone of its own colour (never white), flickering as it flutters`],
    ['Finish', `bloom ${LEAVES.glow.bloom.strength} / ${LEAVES.glow.bloom.radius}, only for glowing leaves (threshold ${LEAVES.glow.bloom.threshold})`],
  ])}`);
liveScene(leafCanvas, (r, scene) => {
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  scene.background = new THREE.Color('#bdb8b4');
  const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshLambertMaterial({ color: '#c8c3bf' })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  scene.add(new THREE.HemisphereLight('#fff6e8', '#9a8fa0', 1.6)); const sun = new THREE.DirectionalLight('#fff0d0', 2.2); sun.position.set(...(LEAVES.sun.map((v) => v * 10) as [number, number, number])); sun.castShadow = true; scene.add(sun);
  let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const { tick, walker, bloom } = buildLeaves(scene, rnd, leafPal);
  // the walker: the approved toy-toon ball
  const sg = new THREE.SphereGeometry(0.35, 48, 24).translate(0, 0.35, 0), ball = new THREE.Mesh(sg, new THREE.MeshToonMaterial({ color: DREAM.creatures.cube, gradientMap: bands(DREAM.toon.bands) }));
  const o = outline(sg, '#2a1838', 0.012, DREAM.ink.boil); ball.add(o); ball.castShadow = true; walker.add(ball);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 80); camera.position.set(0, 5.2, 6.4); camera.lookAt(0, 0, 0.2);
  const composer = new EffectComposer(r); composer.setSize(W, H); composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), bloom.strength, bloom.radius, bloom.threshold)); composer.addPass(new OutputPass());
  return { camera, composer, tick: (t) => { tick(t); o.material.uniforms.t.value = t; const ph = (t * 1.6) % 1; ball.position.y = 4 * ph * (1 - ph) * 0.35; const sq = spring(t * 1.6, 1, 22, 6) * 0.15; ball.scale.set(1 + sq, 1 - sq * 1.5, 1 + sq); } };
});

// ---------- render what's on screen ----------
const io = new IntersectionObserver((es) => es.forEach((e) => { const l = lives.find((x) => x.canvas === e.target); if (l) l.visible = e.isIntersecting; }), { rootMargin: '200px' });
lives.forEach((l) => io.observe(l.canvas));
const fixedT = q.has('t') ? Number(q.get('t')) : null;
const w = window as unknown as { __frames: number }; w.__frames = 0;
function loop(now: number): void { const t = fixedT ?? now / 1000; lives.forEach((l) => { if (l.visible || q.has('all')) l.render(t); }); w.__frames++; requestAnimationFrame(loop); }
requestAnimationFrame(loop);
