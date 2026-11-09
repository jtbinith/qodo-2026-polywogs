// Polywogs look: the single source of truth for the APPROVED look. Only approved ingredients live here.
// The guide page reads from here, the world renders from here, and skills/polywogs-look/SKILL.md points here.

/** The outline colour for everything in daylight: a deep plum instead of black, for a vibrant, colourful line. */
export const INK = '#4a1d4f';

/** Approved 1: the dream meadow combo (night meadow + toy toon + ink lines). Values are exactly the approved version. */
export const DREAM = {
  name: 'Dream meadow (combo)',
  from: 'night meadow + toy toon + ink lines',
  how: 'The painted night meadow as the world, with toon-shaded toy creatures on top (3 hard light bands lit by cool moonlight and the warm lantern) and a wobbly hand-drawn ink outline that redraws 8 times a second so they read clearly and feel alive.',
  render: { toneMapping: 'ACES filmic', exposure: 1.1, bloom: { strength: 0.45, radius: 0.5, threshold: 0.7 } },
  camera: { fov: 34, position: [0, 6, 10] as [number, number, number], lookAt: [0, 0.5, 0] as [number, number, number] },
  sky: '#060a24',
  fog: { color: '#0b1238', near: 9, far: 20 },
  fill: { sky: '#4b5bd6', ground: '#12082a', intensity: 1.4 },
  moon: { color: '#9aa8ff', intensity: 1.4, position: [-4, 9, -3] as [number, number, number], shadowSoftness: 6 },
  frontMoon: { color: '#b9c3ff', intensity: 0.55, position: [3, 4, 8] as [number, number, number] },
  ground: '#1d1d6e',
  meadow: { cards: 7000, card: [0.4, 0.5] as [number, number], from: 1.0, to: 8, emissive: '#1a1450',
    palette: ['#3b3fd9', '#4a2fb8', '#6b2fc0', '#8a3bd0', '#2f5fe0', '#b047c8'], path: '#c13fa8', brightness: [0.75, 1.25] as [number, number] },
  stars: { count: 1500, color: '#dfe6ff', size: 0.08 },
  toon: { bands: [95, 185, 255] },
  creatures: { cube: '#ff4f6d', ball: '#6fd3ff' },
  ink: { color: '#fff0d2', dark: '#120a2e', width: 0.014, boil: 0.9, redrawsPerSecond: 8 },
  lantern: { core: '#ffb347', light: '#ff9a3c', intensity: 4, halo: ['rgba(255,190,110,1)', 'rgba(255,140,60,.55)', 'rgba(255,90,40,0)'] },
};

/** Approved 2: water. Two flat colours from slow noise + noisy foam rings (approved W1);
 *  ponds can add twinkling star sparkles and a sandy shallow shore (approved W3). */
export const CEL_WATER = {
  name: 'Water',
  how: 'Two flat water colours from slow noise, no gradients. Foam rings drift outward and wobble, change width and break up like ripples. Ponds can add twinkling gold star sparkles and a sandy shallow edge with a foam line.',
  deep: '#2d8fa0', light: '#7fd8d0', foam: '#fff6e6', sparkle: '#ffe7a3', sand: '#f3d9ab',
  rings: { spacing: 1.2, speed: 0.25, width: 0.05, wobble: 0.55, broken: 0.38 },
  sparkles: { share: 0.22, perUnit: 2.2 },
  shore: { from: 0.86, sandMix: 0.75 },
};

/** Approved 3: the mushroom tree. Fan-shaped caps curling up, a twisting birch trunk with dark marks, on a dirt patch. */
export const MUSHTREE = {
  name: 'Mushroom tree',
  from: 'from the sketch, in the toy toon + ink look',
  how: 'Four fan-shaped caps step up and around a twisting, tapering birch trunk. Caps have peach tops with soft light spots and bright salmon gills underneath, and their edges and tips curl up. The trunk has spiral grooves and short dark birch marks. It stands on a dirt patch. Caps sway, spores drift up.',
  background: '#6e6e6e',
  camera: { fov: 34, position: [0.6, 3.6, 11] as [number, number, number], target: [0, 2.7, 0] as [number, number, number] },
  light: { sky: '#fff1dc', ground: '#5a4a52', fill: 1.25, key: '#fff2dc', keyIntensity: 2.2, keyPosition: [-5, 8, 6] as [number, number, number] },
  ink: { color: INK, width: 0.014, capWidth: 0.016 },
  trunk: { color: '#e6d6bc', marks: '#33262b', grooveDepth: 0.86 },
  caps: [ // y, radius, facing angle, fan span, tilt, then top / spots / gills / gill lines
    { y: 2.85, r: 1.95, angle: 0.5, span: 4.1, tilt: 0.1, top: '#ffb56a', spot: '#ffd9a0', gill: '#e86f55', line: '#b8463a' },
    { y: 3.65, r: 1.6, angle: 2.7, span: 3.9, tilt: -0.06, top: '#ffa862', spot: '#ffd29a', gill: '#e5664f', line: '#b03f35' },
    { y: 4.35, r: 1.2, angle: -0.8, span: 3.7, tilt: 0.08, top: '#ffb370', spot: '#ffdcaa', gill: '#ea7560', line: '#b84a3e' },
    { y: 4.95, r: 0.85, angle: 1.7, span: 3.5, tilt: -0.05, top: '#ffbd7a', spot: '#ffe0b0', gill: '#ee7a64', line: '#bf5244' },
  ],
  curl: { rim: 0.13, tips: 0.22 },
  gillGlow: 0.45,
  dirt: '#7a4a2a', spores: '#fff1d0',
};

/** Approved 4: maple leaves. They lie in drifts; a walker kicks them up; they tumble, flutter and settle.
 *  About 1 in 12 kicked-up leaves catches the sun while in the air and glows warm in a lighter tone of its own colour (never white). */
export const LEAVES = {
  name: 'Maple leaves',
  how: 'Maple leaves lie in drifts and a scatter. When something walks through, the leaves it touches get kicked up: they tumble, flutter side to side, drift down slowly and settle flat. About 1 in 12 kicked-up leaves catches the sun while in the air and glows warm in a lighter tone of its own colour, never white. Three colour sets.',
  shape: 'maple', size: 1.9, count: 2600, kickRadius: 0.75,
  palettes: {
    golden: ['#ffc21a', '#ffb000', '#ff9a1a', '#f6d040', '#ffd24a', '#e8861a', '#b8862a', '#8f8a3a'],
    ember: ['#ff6a1a', '#ff8a1a', '#ff4a2a', '#e8501f', '#ffa03a', '#c7341f', '#ffb84a', '#9a3a1a'],
    rosy: ['#ff3d7f', '#ff5f9a', '#ff2e63', '#ff7ab0', '#ff4fa8', '#f0405a', '#d6307a', '#ff8a8a'],
  },
  paletteNames: { golden: 'Golden', ember: 'Ember', rosy: 'Rosy' },
  weights: [5, 5, 4, 4, 3, 2, 1, 0.6],
  glowTint: { golden: '#ffe08a', ember: '#ffb060', rosy: '#ffa0cc' },
  glow: { share: 1 / 12, from: 0.35, power: 1.2, brightness: 2.3, bloom: { strength: 0.6, radius: 0.6, threshold: 1.0 } },
  sun: [-0.5, 0.7, 0.5] as [number, number, number],
};
export type LeafPalette = keyof typeof LEAVES.palettes;

/** Approved 5: rocks. Round faceted boulders in 3 flat tones, cut-in cracks with a light lip, pebbles at the base,
 *  and cushion moss: small puffy toon clumps where layered noise says moss grows (patchy, mostly on top, hanging over edges). */
export const ROCKS = {
  name: 'Rocks',
  how: 'Round boulders with lots of small flat faces, lit in 3 flat tones (light top, mid side, dark shade side). Long wiggly cracks cut across some faces with a thin light lip on one side. Pebbles sit around the bases. Cushion moss grows where layered noise says so: patchy, mostly on top, hanging over the edges, made of small puffy toon clumps that are darker deep down and bright lime at the sunny tips, with a thin damp green rim on the stone. Noise bumps the lighting on each clump so the band edges go lumpy, and splits it into a few big flat blotches of the neighbouring moss greens. Three stone colours.',
  shape: { points: 70, jitter: 0.05 },
  colours: {
    taupe: { light: '#b3aa9e', mid: '#8f877d', dark: '#625c56', crack: '#4a443f' },
    slate: { light: '#9aa3ad', mid: '#77808c', dark: '#505864', crack: '#3a4049' },
    sandstone: { light: '#d8b9a0', mid: '#b8957e', dark: '#86685a', crack: '#6a4e44' },
  },
  colourNames: { taupe: 'Warm taupe', slate: 'Cool slate', sandstone: 'Sandstone' },
  ink: INK,
  moss: ['#3f6a22', '#5f8f2a', '#86b83a', '#a8d44a', '#cde86a'],          // dark crevice -> sunny tips
  mossDensity: 900,                                                        // clumps per unit of rock top area
  mossTexture: { bump: 0.55, bumpFreq: 38, mottleFreq: 9 },               // noise on each clump: lumpy band edges + big flat blotches
  sun: [-0.75, 0.55, 0.4] as [number, number, number],
};
export type RockColour = keyof typeof ROCKS.colours;

/** Approved 6: coral mushroom tree. The approved caps on a branching coral-fungus trunk, on a burnt-paper patch.
 *  Shader colours are linear RGB triples (used as-is in GLSL); hex colours go through three's colour management. */
export const MUSHCORAL = {
  name: 'Coral mushroom tree',
  from: 'a variation of the mushroom tree, after a coral fungus photo',
  how: 'A cream fungus trunk sweeps up and forks like coral, with fibres along each branch, a peach blush at the tips, ridges like the rock cracks (dark groove, light lip) and mint and lavender lichen patches. The approved mushroom-tree caps sit at every branch tip and spiral up the trunk. It stands in a thick patch with a ragged burnt-paper edge that goes cream to peach to coral; the trunk flares out and goes right through it, with roots spreading over the top.',
  seed: 5,
  background: ['#9aa3ab', '#e3e7ea'] as [string, string],
  camera: { fov: 34, position: [0.5, 7.2, 14.5] as [number, number, number], target: [0, 3.2, 0] as [number, number, number] },
  light: { sky: '#fff1dc', ground: '#5a4a52', fill: 1.25, key: '#fff2dc', keyIntensity: 2.2, keyPosition: [-5, 8, 6] as [number, number, number] },
  ink: { color: INK, width: 0.012, capWidth: 0.016 },
  flesh: { color: '#fbeadb', tipBlush: [1, 0.72, 0.55] as const, ridge: [0.42, 0.3, 0.28] as const, ridgeLip: [1, 0.97, 0.92] as const },
  lichen: [[0.45, 0.86, 0.64], [0.68, 0.54, 0.92]] as const,
  base: { peach: [1, 0.69, 0.4] as const, coral: [0.81, 0.16, 0.09] as const, rim: [0.48, 0.06, 0.04] as const, thickness: 0.16 },
  caps: [ // top / spots / gills / gill lines, same as the mushroom tree
    ['#ffb56a', '#ffd9a0', '#e86f55', '#b8463a'], ['#ffa862', '#ffd29a', '#e5664f', '#b03f35'], ['#ffb370', '#ffdcaa', '#ea7560', '#b84a3e'], ['#ffbd7a', '#ffe0b0', '#ee7a64', '#bf5244'],
  ] as [string, string, string, string][],
};

/** Approved 7: shelf mushroom plant. Three of the approved caps stepping up a birch stalk, teal spore marks and falling spores. */
export const SHELF = {
  name: 'Shelf mushroom',
  from: 'a small plant from the mushroom-tree caps',
  how: 'Three baby mushroom-tree caps step up and around a short tapering birch stalk. Their tops carry teal spore specks, crowded by the stalk and thinning out to the rim, with soft teal patches; teal spores drift down off the gills. It sits on a little cream patch with a coral rim and sways gently.',
  seed: 9,
  background: ['#9aa3ab', '#e3e7ea'] as [string, string],
  camera: { fov: 34, position: [0.3, 1.5, 3.3] as [number, number, number], target: [0, 0.68, 0] as [number, number, number] },
  light: { sky: '#fff1dc', ground: '#5a4a52', fill: 1.25, key: '#fff2dc', keyIntensity: 2.2, keyPosition: [-5, 8, 6] as [number, number, number] },
  ink: { color: INK, width: 0.01, capWidth: 0.012 },
  stalk: { color: '#e6d6bc', r0: 0.09, r1: 0.035 },
  cap: { top: '#ffb56a', spot: '#ffd9a0', gill: '#e86f55', line: '#b8463a' },
  gillGlow: 0.45,
  caps: [ // height, radius, facing angle, spore amount
    { y: 0.45, r: 0.42, angle: 0.4, spores: 0.55 }, { y: 0.82, r: 0.34, angle: 2.6, spores: 0.55 }, { y: 1.18, r: 0.26, angle: -0.9, spores: 0.2 },
  ],
  spores: { color: '#2fa7a0', size: 0.02, count: 30 },
  patch: { color: '#fbeadb', rim: '#e86f55' },
};
