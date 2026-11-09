import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { DREAM as D } from './palette';
import { bands, outline, type Tick } from './helpers';

/** Turning a kid's Tinkercad STL into a creature in the Polywogs toy-toon look. No per-model styling: every import gets this. */
export const CREATURE = {
  worldPerMm: 0.05,                 // Tinkercad's 20 mm default shapes come out 1.0 tall, well above the meadow grass
  minSize: 0.5, maxSize: 2.0,       // tiny or huge models are clamped so they stay creature-sized
  crease: 35,                       // faces meeting more sharply than this keep a hard edge (cube corners); softer ones go smooth (spheres)
  // candy colours from the look guide: toy cube, toy ball, lantern, mushroom cap, moss tips, meadow violet
  colours: [D.creatures.cube, D.creatures.ball, '#ffb347', '#ffb56a', '#a8d44a', '#b047c8'],
};

export interface CreatureModel { geo: THREE.BufferGeometry; size: THREE.Vector3; mm: THREE.Vector3; tris: number }

/** STL bytes -> upright, centred, sitting-on-the-ground geometry at creature scale. Tinkercad exports Z-up in millimetres. */
export function creatureModel(bytes: ArrayBuffer): CreatureModel {
  let g = new STLLoader().parse(bytes);
  g.deleteAttribute('normal'); g.rotateX(-Math.PI / 2);                        // Z-up -> Y-up
  g.computeBoundingBox(); const mm = g.boundingBox!.getSize(new THREE.Vector3());
  const big = Math.max(mm.x, mm.y, mm.z), size = THREE.MathUtils.clamp(big * CREATURE.worldPerMm, CREATURE.minSize, CREATURE.maxSize);
  g.scale(size / big, size / big, size / big); g.computeBoundingBox();
  const b = g.boundingBox!, c = b.getCenter(new THREE.Vector3()); g.translate(-c.x, -b.min.y, -c.z);   // centred, feet on y = 0
  g = toCreasedNormals(g, THREE.MathUtils.degToRad(CREATURE.crease));
  g.computeBoundingBox();
  return { geo: g, size: g.boundingBox!.getSize(new THREE.Vector3()), mm, tris: g.attributes.position.count / 3 };
}

/** The toy-toon look: 3 hard light bands, its own candy colour, the boiling cream ink outline. */
export function creatureMesh(m: CreatureModel, colour: string): { mesh: THREE.Mesh; tick: Tick } {
  const mesh = new THREE.Mesh(m.geo, new THREE.MeshToonMaterial({ color: colour, gradientMap: bands(D.toon.bands) }));
  mesh.castShadow = true;
  const o = outline(m.geo, D.ink.color, D.ink.width, D.ink.boil, false); mesh.add(o);
  return { mesh, tick: (t) => (o.material.uniforms.t.value = t) };
}
