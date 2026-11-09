import * as THREE from 'three';
import { CEL_WATER as W } from './palette';
import { NOISE, type Tick } from './helpers';

export interface WaterOptions { rings?: boolean; sparkles?: boolean; shore?: boolean }

/** Polywogs water (approved): 2 flat colours from slow noise + noisy foam rings; ponds can add star sparkles + a sandy shore. */
export function celWater(o: WaterOptions, width = 6, depth = 3.6): { mesh: THREE.Mesh; tick: Tick } {
  const t = { value: 0 };
  const geo = new THREE.CircleGeometry(1, 128); geo.scale(width / 2, depth / 2, 1);
  const f = (b?: boolean) => (b ? 1 : 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { t, deep: { value: new THREE.Color(W.deep) }, light: { value: new THREE.Color(W.light) }, foam: { value: new THREE.Color(W.foam) },
      spark: { value: new THREE.Color(W.sparkle) }, sand: { value: new THREE.Color(W.sand) }, halfSize: { value: new THREE.Vector2(width / 2, depth / 2) },
      spacing: { value: W.rings.spacing }, speed: { value: W.rings.speed }, ringW: { value: W.rings.width },
      uRings: { value: f(o.rings) }, uSpark: { value: f(o.sparkles) }, uShore: { value: f(o.shore) } },
    vertexShader: `varying vec3 vW; varying vec2 vL; void main(){ vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: NOISE + `uniform float t, spacing, speed, ringW, uRings, uSpark, uShore; uniform vec3 deep, light, foam, spark, sand; uniform vec2 halfSize; varying vec3 vW; varying vec2 vL;
      vec2 h2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
      // a 4-pointed twinkle star
      float star(vec2 p, float r){ p = abs(p); return step(pow(p.x, .5) + pow(p.y, .5), r); }
      void main(){ vec2 p = vW.xz;
        float edgeR = length(vL / halfSize);                                         // 0 centre, 1 at the rim
        float n = fbm(p * .9 + t * .1); vec3 c = n > .5 ? light : deep;          // approved: 2 flat colours from slow noise
        // foam rings; with noise they wobble, thicken, thin and break up like ripples
        vec2 rp = p * vec2(1., 1.6);
        if (uRings > .5) {
          float wob = (fbm(p * 1.4 + t * .2) - .5) * .55;
          float ring = fract(length(rp) * spacing + wob - t * speed);
          float wd = ringW * (1. + (fbm(p * 3. - t * .3) * 1.6 - .5));
          if (ring < wd && step(.38, fbm(p * 2.2 + 7.)) > .5) c = foam; }
        // shallow sandy edge with a soft foam line where water meets sand
        if (uShore > .5) { float sh = edgeR + (fbm(p * 1.5 + t * .1) - .5) * .12;
          if (sh > .86) c = mix(c, sand, .75); if (abs(sh - .86) < .018 + .01 * sin(t * 2. + p.x * 3.)) c = foam; }
        // twinkling star sparkles
        if (uSpark > .5) { vec2 g = floor(p * 2.2), fr = fract(p * 2.2) - .5; vec2 rnd = h2(g);
          float on = step(.78, rnd.x) * (.5 + .5 * sin(t * (2. + rnd.y * 3.) + rnd.x * 30.));
          if (star((fr - (rnd - .5) * .5) * 1.8, .75 * on) > .5) c = spark; }
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2;
  return { mesh, tick: (s) => (t.value = s) };
}
