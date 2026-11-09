import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CEL_WATER, DREAM, INK, LEAVES, type LeafPalette, MUSHCORAL, MUSHTREE, ROCKS, SHELF, type RockColour } from '../look/palette';
import { buildRocks } from '../look/rocks';
import { buildMushTree } from '../look/mushtree';
import { buildMushCoral } from '../look/mushcoral';
import { buildShelf } from '../look/shelf';
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

// ---------- page layout: grouped by ingredient, with a contents bar and one master palette ----------
const GROUPS = {
  palette: { title: 'Colour palette', note: 'Every approved colour on one sheet, duplicates merged.' },
  world: { title: 'World look', note: 'The overall night style everything else sits in.' },
  sky: { title: 'Sky & air', note: 'Nothing on its own yet. The night sky, stars and fog are part of the dream meadow.' },
  ground: { title: 'Ground', note: '' },
  land: { title: 'Land & water', note: '' },
  plants: { title: 'Plants', note: '' },
  creatures: { title: 'Creatures', note: 'Nothing on its own yet. The toy-toon cube and ball are part of the dream meadow.' },
} as const;
type Group = Exclude<keyof typeof GROUPS, 'palette'>;
const root = document.getElementById('approved')!;
document.body.insertAdjacentHTML('afterbegin', `<nav class="toc"><b>Contents</b>${Object.entries(GROUPS).map(([k, g]) => `<a class="tg" href="#g-${k}">${g.title}</a><div class="ti" id="toc-${k}"></div>`).join('')}</nav>`);
for (const [k, g] of Object.entries(GROUPS)) root.insertAdjacentHTML('beforeend', `<section class="group" id="g-${k}"><h2 class="gtitle">${g.title}</h2>${g.note ? `<p class="lead gnote">${g.note}</p>` : ''}<div class="gitems"></div></section>`);
let shown = 0;
function item(id: string, group: Group, title: string, from: string, how: string, body: string): HTMLCanvasElement {
  const el = document.createElement('section'); el.className = 'item'; el.id = id; el.dataset.title = title;
  el.innerHTML = `<span class="tag">Approved ${++shown}</span><h2>${title}</h2><p class="from">${from}</p><p class="how">${how}</p><canvas width="${W}" height="${H}"></canvas>${body}`;
  // shorter cards: colours and recipe fold away; live controls and extra views stay visible
  const fold = document.createElement('details'); fold.className = 'fold'; fold.innerHTML = '<summary>Colours and recipe</summary>';
  [...el.children].slice([...el.children].indexOf(el.querySelector('canvas')!) + 1).forEach((c) => {
    const keep = c.classList.contains('ctl') || c.tagName === 'CANVAS' || (c.tagName === 'H3' && c.nextElementSibling?.tagName === 'CANVAS');
    if (!keep) fold.appendChild(c); });
  el.appendChild(fold);
  const g = document.querySelector(`#g-${group}`)!; g.querySelector('.gnote')?.remove();
  g.querySelector('.gitems')!.appendChild(el);
  document.getElementById(`toc-${group}`)!.insertAdjacentHTML('beforeend', `<a href="#${id}">${title}</a>`);
  return el.querySelector('canvas')!;
}

// one renderer per approved item, so each keeps exactly its own approved settings
function liveScene(canvas: HTMLCanvasElement, setup: (r: THREE.WebGLRenderer, scene: THREE.Scene) => { camera: THREE.Camera; tick: Tick; composer?: EffectComposer }): void {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(W, H, false);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), s = setup(r, scene);
  lives.push({ canvas, visible: false, render: (t) => { s.tick(t); s.composer ? s.composer.render() : r.render(scene, s.camera); } });
}

// ---------- approved 1: dream meadow (combo) ----------
const dreamCanvas = item('dream', 'world', DREAM.name, DREAM.from, DREAM.how, `
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
const waterEl = item('water', 'land', CEL_WATER.name, 'W1 open water, W3 pond with shore', CEL_WATER.how, `
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
const treeCanvas = item('mushtree', 'plants', MUSHTREE.name, MUSHTREE.from, MUSHTREE.how, `
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
const leafCanvas = item('leaves', 'ground', LEAVES.name, `maple, ${LEAVES.size}x, colour sets: ${Object.values(LEAVES.paletteNames).join(', ')}`, LEAVES.how, `
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
  const o = outline(sg, INK, 0.012, DREAM.ink.boil); ball.add(o); ball.castShadow = true; walker.add(ball);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 80); camera.position.set(0, 5.2, 6.4); camera.lookAt(0, 0, 0.2);
  const composer = new EffectComposer(r); composer.setSize(W, H); composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), bloom.strength, bloom.radius, bloom.threshold)); composer.addPass(new OutputPass());
  return { camera, composer, tick: (t) => { tick(t); o.material.uniforms.t.value = t; const ph = (t * 1.6) % 1; ball.position.y = 4 * ph * (1 - ph) * 0.35; const sq = spring(t * 1.6, 1, 22, 6) * 0.15; ball.scale.set(1 + sq, 1 - sq * 1.5, 1 + sq); } };
});

// ---------- approved 5: rocks (3 stone colours) ----------
const rockCol: RockColour = (q.get('rocks') as RockColour) ?? 'taupe';
const rockCanvas = item('rocks', 'land', ROCKS.name, `round, cushion moss, cracks; stone colours: ${Object.values(ROCKS.colourNames).join(', ')}`, ROCKS.how, `
  <div class="ctl" style="margin-top:12px">Stone ${(Object.keys(ROCKS.colours) as RockColour[]).map((k) => `<a class="pill ${k === rockCol ? 'on' : ''}" href="?rocks=${k}#rocks">${ROCKS.colourNames[k]}</a>`).join('')}</div>
  ${(Object.keys(ROCKS.colours) as RockColour[]).map((k) => `<h3>${ROCKS.colourNames[k]}</h3>${swatches([['Light', ROCKS.colours[k].light], ['Mid', ROCKS.colours[k].mid], ['Dark', ROCKS.colours[k].dark], ['Crack', ROCKS.colours[k].crack]])}`).join('')}
  <h3>Moss and ink</h3>${swatches([...ROCKS.moss.map((h, i): [string, string] => [i === 0 ? 'Moss crevice' : i === ROCKS.moss.length - 1 ? 'Moss tips' : `Moss ${i + 1}`, h]), ['Ink line', ROCKS.ink]])}
  <h3>Recipe</h3>${recipe([
    ['Shape', `convex hull of ${ROCKS.shape.points} random points on a squashed ball (${ROCKS.shape.jitter * 100}% jitter), flat underneath`],
    ['Stone', '3 flat tones by sun angle: light top, mid side, dark shade side'],
    ['Cracks', 'noise contours on each face, only in some areas; dark crack + a thin light lip on the lit side'],
    ['Moss', `cushion clumps (${ROCKS.mossDensity} per unit of area) where moss noise > 0: patchy, mostly on top, hanging over edges; darker deep down, lime at the sunny tips; a thin damp green rim and a shadow under the lip`],
    ['Moss texture', `3D noise bumps each clump's lighting (${ROCKS.mossTexture.bump} at ${ROCKS.mossTexture.bumpFreq}x) so band edges go lumpy, and splits it into big flat blotches (${ROCKS.mossTexture.mottleFreq}x) of the darkest and brightest moss greens`],
    ['Extras', 'pebbles around the bases; hand-drawn ink outline'],
  ])}`);
liveScene(rockCanvas, (_r, scene) => {
  scene.background = new THREE.Color('#efe9df');
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: '#e4ddd1' })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001; scene.add(ground);
  scene.add(new THREE.HemisphereLight('#fff6e8', '#7a7468', 1.3)); const sun = new THREE.DirectionalLight('#fff2dc', 1.8); sun.position.set(...(ROCKS.sun.map((v) => v * 10) as [number, number, number])); scene.add(sun);
  const tick = buildRocks(scene, { colour: rockCol });
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 60);
  return { camera, tick: (t) => { tick(t); camera.position.set(0.4 + Math.sin(t * 0.25) * 1.2, 3.6, 8.6); camera.lookAt(0.3, 0.7, 0); } };
});

// ---------- approved 6: coral mushroom tree ----------
const lin = (c: readonly [number, number, number]): string => '#' + new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).getHexString();
const coralCanvas = item('mushcoral', 'plants', MUSHCORAL.name, MUSHCORAL.from, MUSHCORAL.how, `
  <h3>Caps (same as the mushroom tree)</h3>${swatches(MUSHCORAL.caps.flatMap((c, i): [string, string][] => [[`Cap ${i + 1} top`, c[0]], [`Cap ${i + 1} gills`, c[2]]]))}
  <h3>Trunk</h3>${swatches([['Flesh', MUSHCORAL.flesh.color], ['Tip blush', lin(MUSHCORAL.flesh.tipBlush)], ['Ridge', lin(MUSHCORAL.flesh.ridge)], ['Ridge lip', lin(MUSHCORAL.flesh.ridgeLip)], ['Lichen mint', lin(MUSHCORAL.lichen[0])], ['Lichen lavender', lin(MUSHCORAL.lichen[1])]])}
  <h3>Base and ink</h3>${swatches([['Base', MUSHCORAL.flesh.color], ['Edge peach', lin(MUSHCORAL.base.peach)], ['Edge coral', lin(MUSHCORAL.base.coral)], ['Edge rim', lin(MUSHCORAL.base.rim)], ['Ink line', MUSHCORAL.ink.color]])}
  <h3>Recipe</h3>${recipe([
    ['Trunk', 'a sweeping tapering tube that forks 3 then 2 ways like coral; long fibres along each branch, peach blush towards the tips; flares at the foot'],
    ['Ridges', 'the rock cracks, stretched up the trunk: noise contours in some areas, dark groove + thin light lip'],
    ['Lichen', 'ragged noise patches in mint or lavender with a pale frilly edge and speckled crust; glow a little so they keep colour in shade'],
    ['Caps', 'the approved mushroom-tree caps at every branch tip (big) and half-way along (small), plus 11 spiralling up the trunk'],
    ['Base', `a ${MUSHCORAL.base.thickness}-thick patch with a ragged burnt-paper outline: cream, then peach, coral and a deep coral rim, edge curling up a little; the trunk goes right through it and roots spread over the top`],
    ['Ink lines', `inverted-hull outline ${MUSHCORAL.ink.width} (caps ${MUSHCORAL.ink.capWidth}), boiling like the dream meadow`],
    ['Motion', 'caps bob and sway gently'],
  ])}`);
liveScene(coralCanvas, (r, scene) => {
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  return buildMushCoral(scene, W / H);
});

// ---------- approved 7: shelf mushroom plant ----------
const shelfCanvas = item('shelf', 'plants', SHELF.name, SHELF.from, SHELF.how, `
  <h3>Caps, spores and stalk</h3>${swatches([['Cap top', SHELF.cap.top], ['Cap spots', SHELF.cap.spot], ['Gills', SHELF.cap.gill], ['Gill lines', SHELF.cap.line], ['Spores', SHELF.spores.color], ['Birch stalk', SHELF.stalk.color], ['Patch', SHELF.patch.color], ['Patch rim', SHELF.patch.rim], ['Ink line', SHELF.ink.color]])}
  <h3>Recipe</h3>${recipe([
    ['Stalk', `a short tapering birch tube (${SHELF.stalk.r0} to ${SHELF.stalk.r1})`],
    ['Caps', `${SHELF.caps.length} of the approved mushroom-tree caps stepping up and around the stalk, gills glowing ${SHELF.gillGlow}`],
    ['Spore marks', 'big teal specks on the cap tops, crowded by the stalk and thinning out to the rim, plus soft teal patches; the top cap has fewer'],
    ['Falling spores', `${SHELF.spores.count} teal spores drifting down off the gills, swelling then shrinking as they fall`],
    ['Ground', 'a little cream patch with a coral rim'],
    ['Motion', 'the whole plant sways gently'],
  ])}`);
liveScene(shelfCanvas, (r, scene) => {
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  return buildShelf(scene, W / H);
});

// ---------- master palette: every swatch above, merged by colour ----------
{ const seen = new Map<string, { name: string; from: string[] }>(), byGroup = new Map<string, string[]>();
  document.querySelectorAll<HTMLElement>('.group .item').forEach((it) => { const grp = it.closest('.group')!.querySelector('.gtitle')!.textContent!;
    it.querySelectorAll('.sw').forEach((sw) => { const hex = sw.querySelector('span')!.textContent!.toLowerCase(), name = sw.querySelector('b')!.textContent!;
      const e = seen.get(hex); if (e) { if (!e.from.includes(it.dataset.title!)) e.from.push(it.dataset.title!); return; }
      seen.set(hex, { name, from: [it.dataset.title!] }); byGroup.set(grp, [...(byGroup.get(grp) ?? []), hex]); }); });
  document.querySelector('#g-palette .gitems')!.classList.add('master'); document.querySelector('#g-palette .gitems')!.innerHTML = [...byGroup].map(([grp, hexes]) => `<h3>${grp}</h3><div class="row">${hexes.map((h) => { const e = seen.get(h)!;
    return `<div class="sw" title="${e.from.join(', ')}"><div class="chip" style="background:${h}"></div><div class="meta"><b>${e.name}</b><span>${h}</span><i>${e.from.join(', ')}</i></div></div>`; }).join('')}</div>`).join(''); }

// ---------- render what's on screen ----------
const io = new IntersectionObserver((es) => es.forEach((e) => { const l = lives.find((x) => x.canvas === e.target); if (l) l.visible = e.isIntersecting; }), { rootMargin: '200px' });
lives.forEach((l) => io.observe(l.canvas));
const fixedT = q.has('t') ? Number(q.get('t')) : null;
const w = window as unknown as { __frames: number }; w.__frames = 0;
function loop(now: number): void { const t = fixedT ?? now / 1000; lives.forEach((l) => { if (l.visible || q.has('all')) l.render(t); }); w.__frames++; requestAnimationFrame(loop); }
requestAnimationFrame(loop);
