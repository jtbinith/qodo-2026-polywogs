import * as THREE from 'three';
import { DREAM as D, INK } from '../look/palette';
import { bands } from '../look/helpers';
import { drawIcon, JOB_LOOK } from '../look/bubbles';
import { JOB_ORDER, JOBS, type Job, type Stats } from '../look/roles';

/** A trump card for each polywog: its picture, a name the kid can change, its job, its stats, what it does,
 *  and buttons to change the job or download the model again for Tinkercad. Pops up big, then tucks into a stack. */
export interface Polywog { name: string; job: Job; stats: Stats; colour: string; geo: THREE.BufferGeometry; size: THREE.Vector3; stl: ArrayBuffer;
  setJob: (j: Job) => void; rename: (n: string) => void }
export const CARD = { showFor: 5, maxName: 20 };   // seconds big before it tucks away; longest name

const STAT_LABEL: Record<keyof Stats, string> = { speed: 'Speed', bounce: 'Bounce', stamina: 'Stamina' };
const css = `
  .pw-stack { position: fixed; top: 12px; right: 12px; max-height: calc(100vh - 80px); overflow-y: auto; overscroll-behavior: contain; padding: 0 6px 6px 0; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; z-index: 5; font-family: 'Courier New', monospace; color: ${INK}; }
  .pw-card { background: #fff6e6; border: 3px solid ${INK}; border-radius: 16px; box-shadow: 4px 4px 0 ${INK}55; transition: transform .25s; }
  .pw-mini { display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; cursor: pointer; font: 700 13px 'Courier New', monospace; }
  .pw-mini img { width: 34px; height: 34px; border-radius: 8px; background: #1d1d6e; }
  .pw-big { position: fixed; right: 24px; top: 50%; transform: translateY(-50%) scale(var(--pop, 1)); width: 250px; max-width: calc(100vw - 48px); max-height: calc(100vh - 24px); overflow-y: auto; box-sizing: border-box; padding: 12px; z-index: 6; }
  .pw-big .close { position: sticky; float: right; top: 0; margin: -6px -4px 0 0; z-index: 1; }
  .pw-big .pic { width: 100%; aspect-ratio: 1; border-radius: 12px; background: #1d1d6e; display: block; }
  .pw-big input { width: 100%; box-sizing: border-box; margin: 8px 0 4px; padding: 4px 6px; border: 2px dashed ${INK}66; border-radius: 8px; background: transparent; font: 700 18px 'Courier New', monospace; color: ${INK}; }
  .pw-big .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 2px; border-radius: 999px; border: 2px solid ${INK}; font: 700 14px 'Courier New', monospace; text-transform: uppercase; }
  .pw-big .badge img { width: 28px; height: 28px; }
  .pw-big .stat { display: grid; grid-template-columns: 70px 1fr 18px; align-items: center; gap: 6px; font: 700 12px 'Courier New', monospace; margin-top: 5px; }
  .pw-big .bar { height: 10px; border-radius: 6px; border: 2px solid ${INK}; overflow: hidden; } .pw-big .bar i { display: block; height: 100%; }
  .pw-big .does { font: 13px 'Courier New', monospace; margin: 8px 0; }
  .pw-big .row { display: flex; gap: 6px; } .pw-big button { flex: 1; padding: 6px; border-radius: 10px; border: 2px solid ${INK}; background: #fff; font: 700 12px 'Courier New', monospace; color: ${INK}; cursor: pointer; }
  .pw-big .close { flex: none; border: 0; background: none; font-size: 18px; padding: 0 4px; }
  @media (max-height: 520px) { .pw-big { width: 380px; } .pw-big .pic { width: 40%; float: left; margin: 0 10px 4px 0; } .pw-big input { width: 55%; } }   /* short landscape: picture beside the name, so it all fits */`;

const icon = (job: Job, px = 64): string => { const c = document.createElement('canvas'); c.width = c.height = px; drawIcon(c.getContext('2d')!, job, px / 2, px / 2, px * 0.36); return c.toDataURL(); };
let thumbR: THREE.WebGLRenderer | null = null;
function picture(p: Polywog): string {
  thumbR ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.setSize(220, 220);
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(D.fill.sky, D.fill.ground, 2.2)); const l = new THREE.DirectionalLight('#fff2dc', 2.4); l.position.set(-2, 3, 4); scene.add(l);
  scene.add(new THREE.Mesh(p.geo, new THREE.MeshToonMaterial({ color: p.colour, gradientMap: bands(D.toon.bands) })));
  const h = Math.max(p.size.x, p.size.y, p.size.z), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50); cam.position.set(h * 1.4, h * 1.1 + p.size.y * 0.3, h * 2.3); cam.lookAt(0, p.size.y * 0.45, 0);
  thumbR.render(scene, cam); return thumbR.domElement.toDataURL();
}
/** Keep names short and plain: letters, numbers, spaces and a few marks only. */
export const cleanName = (s: string): string => s.replace(/\.stl$/i, '').replace(/\s*\(\d+\)$/, '').replace(/[^\p{L}\p{N} '\-_.!?]/gu, '').trim().slice(0, CARD.maxName) || 'Polywog';

export function makeCards(): { add: (p: Polywog) => void } {
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
  const stack = document.body.appendChild(document.createElement('div')); stack.className = 'pw-stack';
  let open: HTMLElement | null = null, timer = 0;
  const close = () => { open?.remove(); open = null; clearTimeout(timer); };

  type Mini = HTMLDivElement & { refresh?: () => void };
  function mini(p: Polywog, pic: string): Mini {
    const m: Mini = document.createElement('div'); m.className = 'pw-card pw-mini'; m.title = 'Show card';
    const img = m.appendChild(document.createElement('img')); img.src = pic; img.alt = '';
    const nm = m.appendChild(document.createElement('span')); const ic = m.appendChild(document.createElement('img')); ic.style.cssText = 'width:24px;height:24px;background:none';
    const refresh = () => { nm.textContent = p.name; ic.src = icon(p.job, 48); m.style.borderColor = JOB_LOOK[p.job].colour; };
    refresh(); m.refresh = refresh;
    m.onclick = () => big(p, pic, m, false);
    return m;
  }

  function big(p: Polywog, pic: string, m: Mini, auto: boolean): void {
    close();
    const c = document.createElement('div'); c.className = 'pw-card pw-big'; open = c;
    const x = c.appendChild(document.createElement('button')); x.className = 'close'; x.textContent = '×'; x.title = 'Tuck away'; x.onclick = close;
    const img = c.appendChild(document.createElement('img')); img.className = 'pic'; img.src = pic; img.alt = '';
    const name = c.appendChild(document.createElement('input')); name.value = p.name; name.maxLength = CARD.maxName; name.title = 'Change its name'; name.setAttribute('aria-label', 'Name');
    name.oninput = () => { p.name = cleanName(name.value); p.rename(p.name); m.refresh?.(); clearTimeout(timer); };
    name.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); };       // typing a name mustn't move the camera
    const badge = c.appendChild(document.createElement('div')); badge.className = 'badge';
    const bIcon = badge.appendChild(document.createElement('img')); bIcon.alt = ''; const bText = badge.appendChild(document.createElement('span'));
    for (const k of Object.keys(STAT_LABEL) as (keyof Stats)[]) {
      const row = c.appendChild(document.createElement('div')); row.className = 'stat';
      row.appendChild(document.createElement('span')).textContent = STAT_LABEL[k];
      const bar = row.appendChild(document.createElement('div')); bar.className = 'bar'; const fill = bar.appendChild(document.createElement('i'));
      fill.style.width = `${p.stats[k] * 10}%`; fill.style.background = p.colour;
      row.appendChild(document.createElement('span')).textContent = String(p.stats[k]);
    }
    const does = c.appendChild(document.createElement('div')); does.className = 'does';
    const paint = () => { bIcon.src = icon(p.job); bText.textContent = JOBS[p.job].label; badge.style.background = JOB_LOOK[p.job].colour; does.textContent = JOBS[p.job].does; };
    const rowB = c.appendChild(document.createElement('div')); rowB.className = 'row';
    const swap = rowB.appendChild(document.createElement('button')); swap.textContent = 'Change job';
    swap.onclick = () => { p.job = JOB_ORDER[(JOB_ORDER.indexOf(p.job) + 1) % JOB_ORDER.length]; p.setJob(p.job); paint(); m.refresh?.(); clearTimeout(timer); };
    const exp = rowB.appendChild(document.createElement('button')); exp.textContent = 'Export for Tinkercad'; exp.title = 'Download this model as an STL';
    exp.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([p.stl], { type: 'model/stl' })); a.download = `${p.name}.stl`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    paint(); document.body.appendChild(c);
    c.style.setProperty('--pop', '0.6'); requestAnimationFrame(() => c.style.setProperty('--pop', '1'));
    if (auto) timer = window.setTimeout(close, CARD.showFor * 1000);                            // tucks away on its own the first time
  }

  return { add: (p) => { const pic = picture(p), m = mini(p, pic); stack.appendChild(m); big(p, pic, m, true); } };
}
