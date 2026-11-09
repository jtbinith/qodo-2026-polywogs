import * as THREE from 'three';
// Shared helpers, ported exactly from the dream-meadow combo the look is based on.

export const NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }`;

/** Cube with soft edges; origin at the bottom so it can squash and wobble from the floor. */
export function cubeGeo(size = 1.5, r = 0.16, seg = 20): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size, seg, seg, seg), p = g.attributes.position, v = new THREE.Vector3(), h = size / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(THREE.MathUtils.clamp(v.x, -h, h), THREE.MathUtils.clamp(v.y, -h, h), THREE.MathUtils.clamp(v.z, -h, h));
    v.sub(c).normalize().multiplyScalar(r).add(c); p.setXYZ(i, v.x, v.y + size / 2, v.z);
  }
  g.computeVertexNormals(); return g;
}

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Toon light bands, e.g. [95, 185, 255] = 3 hard bands. */
export function bands(levels: number[]): THREE.DataTexture {
  const d = new Uint8Array(levels), t = new THREE.DataTexture(d, levels.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

/** Inverted-hull outline pushed out along the normal; `boil` makes it redraw 8 times a second like a hand-drawn line. */
export function outline(geo: THREE.BufferGeometry, color: string, width: number, boil = 0): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const m = new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, w: { value: width }, t: { value: 0 }, boil: { value: boil } }, side: THREE.BackSide,
    vertexShader: NOISE + `uniform float w; uniform float t; uniform float boil;
      void main(){ float st = floor(t*8.);
        float j = boil * (hash(position.xy*7. + st) - .5);
        vec3 p = position + normal * (w * (1. + j));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.); }`,
    fragmentShader: `uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.); }`,
  });
  return new THREE.Mesh(geo, m);
}

/** A poke that wobbles then settles. */
export const spring = (t: number, period: number, freq: number, damp: number): number => { const ph = t % period; return Math.exp(-damp * ph) * Math.sin(freq * ph); };

/** A soft tapered brush stroke, used for the meadow cards. */
export function brushTex(): THREE.CanvasTexture {
  return canvasTex(64, 256, (g) => { for (let k = 0; k < 6; k++) { const x = 32 + (Math.random() - 0.5) * 18; const gr = g.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = gr; g.lineWidth = 8 + Math.random() * 10; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, 256); g.quadraticCurveTo(x + (Math.random() - 0.5) * 30, 120, x + (Math.random() - 0.5) * 20, 10); g.stroke(); } });
}

export type Tick = (t: number) => void;
