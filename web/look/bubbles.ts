import * as THREE from 'three';
import { INK } from './palette';
import type { Job } from './roles';

/** Comic bubbles over a polywog's head, icons only (no words, so kids who don't read yet get it too).
 *  'think' = a thought cloud with three dots; a job = a speech bubble with that job's icon. */
export const JOB_LOOK: Record<Job, { colour: string }> = {
  courier: { colour: '#ffb347' },   // lantern gold: a lightning bolt, quick
  keeper: { colour: '#a8d44a' },    // moss green: neat rows, like a crop field
  fan: { colour: '#6fd3ff' },       // toy-ball blue: spinning blades, cool air
  bridge: { colour: '#ffb56a' },    // mushroom peach: an arch
};
const CREAM = '#fff6e6', S = 256;

/** Draws a job's icon centred on (cx, cy) at size r. Also used on the trump card. */
export function drawIcon(g: CanvasRenderingContext2D, job: Job, cx: number, cy: number, r: number): void {
  g.save(); g.translate(cx, cy); g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = r * 0.12; g.strokeStyle = INK; g.fillStyle = JOB_LOOK[job].colour;
  g.beginPath();
  if (job === 'courier') { const p = [[0.15, -1], [-0.55, 0.12], [-0.02, 0.12], [-0.2, 1], [0.6, -0.2], [0.05, -0.2], [0.35, -1]]; p.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r))); g.closePath(); g.fill(); g.stroke(); }
  else if (job === 'keeper') { for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) { const x = (col - 1) * 0.62 * r, y = (row - 1) * 0.62 * r; g.beginPath(); g.roundRect(x - 0.24 * r, y - 0.24 * r, 0.48 * r, 0.48 * r, 0.1 * r); g.fill(); g.stroke(); } }
  else if (job === 'fan') { for (let k = 0; k < 3; k++) { g.save(); g.rotate((k / 3) * Math.PI * 2); g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(0.55 * r, -0.25 * r, 0.85 * r, -0.85 * r, 0.25 * r, -0.95 * r); g.bezierCurveTo(0, -0.6 * r, 0.05 * r, -0.3 * r, 0, 0); g.fill(); g.stroke(); g.restore(); }
    g.beginPath(); g.arc(0, 0, 0.16 * r, 0, Math.PI * 2); g.fillStyle = CREAM; g.fill(); g.stroke(); }
  else { g.moveTo(-r, 0.55 * r); g.lineTo(-r, 0.05 * r); g.quadraticCurveTo(0, -0.95 * r, r, 0.05 * r); g.lineTo(r, 0.55 * r); g.lineTo(0.55 * r, 0.55 * r); g.quadraticCurveTo(0, -0.3 * r, -0.55 * r, 0.55 * r); g.closePath(); g.fill(); g.stroke(); }
  g.restore();
}

const images = new Map<string, string>();
function bubble(kind: Job | 'think', dots = 3): string {
  const key = kind + dots; if (images.has(key)) return images.get(key)!;
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d')!;
  g.lineWidth = 10; g.strokeStyle = INK; g.fillStyle = CREAM; g.lineJoin = 'round';
  if (kind === 'think') {                                                  // thought cloud + two little puffs leading down
    g.beginPath(); for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; g.moveTo(128 + Math.cos(a) * 62 + 30, 100 + Math.sin(a) * 40); g.arc(128 + Math.cos(a) * 62, 100 + Math.sin(a) * 40, 30, 0, Math.PI * 2); }
    g.stroke(); g.fill(); g.beginPath(); g.ellipse(128, 100, 80, 52, 0, 0, Math.PI * 2); g.fill();
    for (const [x, y, r] of [[112, 178, 14], [100, 214, 8]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
    g.fillStyle = INK; for (let i = 0; i < dots; i++) { g.beginPath(); g.arc(98 + i * 30, 102, 9, 0, Math.PI * 2); g.fill(); }
  } else {                                                                 // speech bubble with a tail, and the job's icon
    g.beginPath(); g.roundRect(40, 30, 176, 150, 44); g.moveTo(110, 178); g.lineTo(122, 232); g.lineTo(150, 178); g.stroke();
    g.beginPath(); g.roundRect(40, 30, 176, 150, 44); g.fill(); g.beginPath(); g.moveTo(104, 172); g.lineTo(122, 230); g.lineTo(156, 172); g.closePath(); g.fill();
    drawIcon(g, kind, 128, 106, 52);
  }
  const url = c.toDataURL(); images.set(key, url); return url;
}

/** A bubble pinned over a point in the world (drawn on top of the 3D view, so the island's glow can't wash it out). */
export interface Bubble { show: (kind: Job | 'think' | null, t: number) => void; tick: (t: number) => void; remove: () => void }
let layer: HTMLDivElement | null = null;
export function makeBubble(anchor: THREE.Object3D, camera: THREE.Camera, size = 110): Bubble {
  if (!layer) { layer = document.body.appendChild(document.createElement('div')); layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden'; }
  const img = layer.appendChild(document.createElement('img')); img.style.cssText = `position:absolute;width:${size}px;height:${size}px;transform-origin:50% 100%;display:none`;
  let kind: Job | 'think' | null = null, since = 0; const v = new THREE.Vector3(), cam = new THREE.Vector3();
  return {
    show: (k, t) => { kind = k; since = t; if (k) img.src = bubble(k); },
    tick: (t) => {
      const u = t - since, pop = kind ? Math.min(1, u / 0.18) : Math.max(0, 1 - u / 0.15);
      anchor.getWorldPosition(v); camera.getWorldPosition(cam); const dist = v.distanceTo(cam); v.project(camera);
      if (pop <= 0 || v.z > 1) { img.style.display = 'none'; return; }
      if (kind === 'think') { const src = bubble('think', 1 + (Math.floor(u * 3) % 3)); if (img.src !== src) img.src = src; }
      const wob = 1 + Math.sin(u * 18) * Math.exp(-u * 5) * 0.12, k = Math.min(1.6, Math.max(0.45, 8 / dist)) * pop * wob;   // a springy pop, smaller when far away
      img.style.display = 'block'; img.style.left = `${(v.x + 1) / 2 * innerWidth - size / 2}px`; img.style.top = `${(1 - v.y) / 2 * innerHeight - size}px`;
      img.style.transform = `scale(${k})`;
    },
    remove: () => img.remove(),
  };
}
