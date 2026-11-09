import type { IslandLayout } from '../look/island';

/** The starting island: just the dream meadow (sky, sea, land, meadow grass), nothing placed on it. */
export const MEADOW_ISLAND: IslandLayout = { seed: 1, radius: 7, grass: 1, zones: [], pinned: [] };

/** The example island with approved things on it (open with ?layout=example). Laid out in the editor. Pinned = exactly here. Zones = "put this many of these somewhere in this circle",
 *  filled from the seed. Edit it by hand, or open the island with ?edit, move things about, press "Copy layout" and paste it here. */
export const EXAMPLE_ISLAND: IslandLayout = {
  seed: 1,
  radius: 7,
  grass: 1,
  zones: [],
  pinned: [
    { kind: 'coral', x: 3.2, z: -2.4, ry: 0.6, s: 1.336 },
    { kind: 'shelf', x: 0.83, z: -0.3, ry: 2.86, s: 0.9 },
    { kind: 'shelf', x: -4.03, z: -2.91, ry: 4.48, s: 1.089 },
    { kind: 'shelf', x: -4.18, z: -1.68, ry: 2.13, s: 1.754 },
    { kind: 'rocks', x: -1.8, z: -0.15, ry: 4.76, s: 1.67 },
    { kind: 'lantern', x: 0.94, z: 4.43, ry: 0, s: 1 },
    { kind: 'mushtree', x: -4.84, z: 2.84, ry: 0, s: 0.896 },
  ],
};
