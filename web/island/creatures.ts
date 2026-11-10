import * as THREE from 'three';
import { GROUND_Y, type Island } from '../look/island';
import { CREATURE, bodyHeight, creatureMesh, creatureModel } from '../look/creature';
import { spring, type Tick } from '../look/helpers';

/** Drop a Tinkercad STL anywhere on the page (or use the button) and it lands on the island as a creature that wanders about. */
export function addCreatures(scene: THREE.Scene, island: Island, focus: () => THREE.Vector3): Tick {
  const ticks: Tick[] = [], spots: { x: number; z: number; r: number }[] = [], down = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0);
  let n = 1, seed = 11; /* colour 0 is the toy cube's */ const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const floorAt = (x: number, y: number, z: number): number => { down.set(new THREE.Vector3(x, y + 0.4, z), DOWN); down.far = 40; return down.intersectObjects(island.solids(), false)[0]?.point.y ?? GROUND_Y; };
  const onLand = (x: number, z: number, pad: number): THREE.Vector2 => { const a = Math.atan2(z, x), lim = island.edgeR(a) - pad, r = Math.hypot(x, z); return r > lim ? new THREE.Vector2(Math.cos(a) * lim, Math.sin(a) * lim) : new THREE.Vector2(x, z); };
  const open = (c: THREE.Vector2) => floorAt(c.x, GROUND_Y + 6, c.y) < GROUND_Y + 0.05;      // nothing (rock, tree) underneath

  function spawn(bytes: ArrayBuffer, name: string): void {
    const model = creatureModel(bytes), colour = CREATURE.colours[n++ % CREATURE.colours.length], { mesh, tick, wake } = creatureMesh(model, colour);
    const body = new THREE.Group(), g = new THREE.Group(); body.add(mesh); g.add(body); scene.add(g); ticks.push(tick);
    // land on open ground near where you're looking
    const f = focus(); let start = onLand(f.x, f.z, 0.8);
    for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, d = 0.5 + rnd() * (1 + i * 0.1), c = onLand(f.x + Math.cos(a) * d, f.z + Math.sin(a) * d, 0.8); if (open(c)) { start = c; break; } }
    const s = { x: start.x, z: start.y, y: GROUND_Y + 4, vy: 0, facing: rnd() * 6.283, target: null as THREE.Vector2 | null, rest: 0.6, hopT: 0, landT: -9, last: -1, landed: false, wakeT: Infinity, awake: false };
    const spot = { x: s.x, z: s.z, r: 0 }; spots.push(spot);
    const pace = 1.4 / Math.sqrt(bodyHeight(model) / 0.6);                     // big creatures plod, small ones scurry
    console.info(`creature: ${name} ${model.mm.x.toFixed(0)}x${model.mm.y.toFixed(0)}x${model.mm.z.toFixed(0)} mm, ${model.tris} triangles, colour ${colour}`);
    ticks.push((t) => {
      const dt = s.last < 0 ? 0 : Math.min(0.05, t - s.last); s.last = t; if (dt <= 0) return;
      let moving = false; const W = CREATURE.wake;
      // waking up: lands grey and sits still, shivers, its colour climbs from the feet up, then a big stretch and a first hop
      if (s.landed && s.wakeT === Infinity) s.wakeT = t + W.sleep + W.shiver;
      if (!s.awake && t >= s.wakeT) { s.awake = true; wake(t); }
      const sinceWake = t - s.wakeT, shiver = s.landed && sinceWake > -W.shiver && sinceWake < 0;
      if (s.awake && sinceWake > W.sweep && s.hopT === 0 && s.vy === 0 && !s.target) { s.vy = 4.5; s.y += 0.01; s.hopT = 0.001; s.rest = 0.4; }   // first excited hop
      if (s.landed && sinceWake > W.sweep + 0.6) {
        if (!s.target) { s.rest -= dt; if (s.rest < 0) { const a = rnd() * 6.283, d = 1 + rnd() * 3, c = onLand(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, 0.9); if (open(c)) s.target = c; else s.rest = 0.2; } }
        else { const dx = s.target.x - s.x, dz = s.target.y - s.z, d = Math.hypot(dx, dz);
          if (d < 0.1) { s.target = null; s.rest = 0.8 + rnd() * 2.5; }
          else { moving = true; s.x += (dx / d) * pace * dt; s.z += (dz / d) * pace * dt; s.facing = Math.atan2(dx, dz); s.hopT += dt * 3.2 * pace / 1.4; } }
      }
      const floor = floorAt(s.x, s.y, s.z);
      if (s.y > floor + 0.01 || s.vy > 0) { s.vy -= 14 * dt; s.y = Math.max(floor, s.y + s.vy * dt); if (s.y === floor) { if (!s.landed || s.vy < -3) s.landT = t; s.landed = true; s.vy = 0; } }
      else s.y += Math.min(floor - s.y, 3 * dt);
      // hop + squash while walking, a big squash when it lands from the sky, gentle breathing when resting
      const ph = s.hopT % 1, hop = moving ? 4 * ph * (1 - ph) * 0.18 * bodyHeight(model) : 0;
      const sq = (moving ? spring(s.hopT, 1, 22, 6) * 0.12 : 0) + (t - s.landT < 2 ? spring(t - s.landT, 99, 18, 5) * 0.35 : 0), br = 1 + Math.sin(t * 2.2 + n) * 0.03;
      const breathe = s.awake ? br : 1, stretch = s.awake && sinceWake > W.sweep - 0.3 && sinceWake < W.sweep + 0.5 ? Math.sin(((sinceWake - W.sweep + 0.3) / 0.8) * Math.PI) * 0.22 : 0;
      g.position.set(s.x + (shiver ? Math.sin(t * 90) * 0.03 : 0), s.y, s.z + (shiver ? Math.cos(t * 77) * 0.03 : 0)); body.position.y = hop;
      body.scale.set((1 + sq - stretch * 0.4) / Math.sqrt(breathe), (1 - sq * 1.6 + stretch) * breathe, (1 + sq - stretch * 0.4) / Math.sqrt(breathe));
      g.rotation.y += ((s.facing - g.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 8);
      spot.x = s.x; spot.z = s.z; spot.r = s.y - floor < 0.6 ? Math.max(model.size.x, model.size.z) * 0.6 : 0;   // parts the grass once it's down
    });
  }

  // a small message at the bottom of the screen, so a kid knows why their model didn't appear
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;left:50%;bottom:58px;transform:translateX(-50%);padding:8px 14px;border-radius:12px;background:#fff6e6;color:#4a1d4f;font:700 14px Courier New,monospace;box-shadow:0 2px 0 #4a1d4f55;opacity:0;transition:opacity .3s;pointer-events:none';
  document.body.appendChild(note); let noteTimer = 0;
  const say = (text: string) => { note.textContent = text; note.style.opacity = '1'; clearTimeout(noteTimer); noteTimer = window.setTimeout(() => (note.style.opacity = '0'), 4000); };
  let count = 0;
  const read = (files: FileList | null | undefined) => {
    for (const f of [...(files ?? [])]) {
      if (!/\.stl$/i.test(f.name)) { say(`${f.name} isn't an STL. In Tinkercad, use Export, then .STL`); continue; }
      if (f.size > CREATURE.maxFileMB * 1024 * 1024) { say(`${f.name} is too big (over ${CREATURE.maxFileMB} MB)`); continue; }
      if (count >= CREATURE.maxCreatures) { say(`The island is full (${CREATURE.maxCreatures} creatures)`); break; }
      count++;
      f.arrayBuffer().then((b) => spawn(b, f.name)).catch((e: Error) => { count--; say(`Couldn't use ${f.name}: ${e.message}. Try exporting it again from Tinkercad.`); console.warn(`import failed: ${f.name}`, e); });
    }
  };
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); read(e.dataTransfer?.files); });
  const btn = document.createElement('label'); btn.id = 'addModel';
  btn.style.cssText = 'position:fixed;right:12px;bottom:12px;padding:8px 14px;border-radius:999px;background:#fff6e6;color:#4a1d4f;font:700 14px Courier New,monospace;cursor:pointer;box-shadow:0 2px 0 #4a1d4f55';
  btn.innerHTML = '+ Add a Tinkercad model <input type="file" accept=".stl" multiple hidden>';
  btn.querySelector('input')!.addEventListener('change', (e) => { const inp = e.target as HTMLInputElement; read(inp.files); inp.value = ''; });   // so the same file can be added again
  document.body.appendChild(btn);
  return (t) => { ticks.forEach((f) => f(t)); island.partGrass(spots); };
}
