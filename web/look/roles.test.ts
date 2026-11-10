import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { jobFor, measure, scores, statsFor, type Job, type Shape } from './roles';

const job = (g: THREE.BufferGeometry) => jobFor(measure(g));

describe('job from shape', () => {
  it('a chunky block is a keeper', () => expect(job(new THREE.BoxGeometry(1, 1, 1))).toBe('keeper'));
  it('a ball is a keeper', () => expect(job(new THREE.SphereGeometry(0.5, 32, 16))).toBe('keeper'));
  it('a long, thin stick is a courier', () => expect(job(new THREE.BoxGeometry(3, 0.6, 0.6))).toBe('courier'));
  it('a flat tag is a bridge', () => expect(job(new THREE.BoxGeometry(2, 0.1, 2))).toBe('bridge'));
  it('a cone is a fan', () => expect(job(new THREE.ConeGeometry(0.5, 1, 32))).toBe('fan'));
});

describe('stats from shape', () => {
  it('are whole numbers from 1 to 10', () => {
    for (const g of [new THREE.BoxGeometry(1, 1, 1), new THREE.ConeGeometry(0.5, 1, 32), new THREE.BoxGeometry(2, 0.05, 2), new THREE.BoxGeometry(9, 0.1, 0.1)])
      for (const v of Object.values(statsFor(measure(g)))) { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); }
  });
  it('differ between two models with the same job', () => {
    const slim = statsFor(measure(new THREE.BoxGeometry(3, 0.4, 0.4))), stubby = statsFor(measure(new THREE.BoxGeometry(3, 1.6, 1.6)));
    expect(jobFor(measure(new THREE.BoxGeometry(3, 0.4, 0.4)))).toBe('courier'); expect(jobFor(measure(new THREE.BoxGeometry(3, 1.6, 1.6)))).toBe('courier');
    expect(slim.speed).toBeGreaterThan(stubby.speed);
  });
  it('a ball bounces more than a block or a cone', () => {
    const ball = statsFor(measure(new THREE.SphereGeometry(0.5, 32, 16))).bounce;
    expect(ball).toBeGreaterThan(statsFor(measure(new THREE.BoxGeometry(1, 1, 1))).bounce); expect(ball).toBeGreaterThan(statsFor(measure(new THREE.ConeGeometry(0.5, 1, 32))).bounce);
  });
  it('a solid block has more stamina than an airy cone', () =>
    expect(statsFor(measure(new THREE.BoxGeometry(1, 1, 1))).stamina).toBeGreaterThan(statsFor(measure(new THREE.ConeGeometry(0.5, 1, 32))).stamina));
  it('the same model always gets the same result', () => {
    const a = measure(new THREE.TorusGeometry(1, 0.3, 16, 48)), b = measure(new THREE.TorusGeometry(1, 0.3, 16, 48));
    expect(jobFor(a)).toBe(jobFor(b)); expect(statsFor(a)).toEqual(statsFor(b));
  });
});

describe('weighted scores', () => {
  it('are all between 0 and 1', () => {
    for (const g of [new THREE.BoxGeometry(1, 1, 1), new THREE.ConeGeometry(0.5, 1, 32), new THREE.BoxGeometry(2, 0.05, 2), new THREE.BoxGeometry(9, 0.1, 0.1)])
      for (const v of Object.values(scores(measure(g)))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('a broken measurement (NaN) safely becomes a keeper', () => {
    const broken: Shape = { size: NaN, long: NaN, flat: NaN, fill: NaN, pointy: NaN };
    expect(jobFor(broken)).toBe('keeper');
    for (const v of Object.values(statsFor(broken))) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('what the island needs', () => {
  // a borderline shape: a bit long, a bit chunky (courier and keeper score close)
  const borderline: Shape = { size: 1, long: 1.55, flat: 0.8, fill: 0.7, pointy: 0.15 };
  const keepers = (n: number): Job[] => Array(n).fill('keeper');
  it('the first polywog is judged on its shape alone', () => expect(jobFor(borderline, [])).toBe(jobFor(borderline)));
  it('a close call tips towards a job the island is short of', () => {
    const lots = jobFor(borderline, keepers(6)), none = jobFor(borderline, ['courier', 'courier', 'courier', 'courier']);
    expect(lots).toBe('courier'); expect(none).toBe('keeper');
  });
  it('a clear shape always keeps its job, however crowded that job is', () => {
    const stick = measure(new THREE.BoxGeometry(3, 0.5, 0.5)), tag = measure(new THREE.BoxGeometry(2, 0.08, 2));
    expect(jobFor(stick, Array(20).fill('courier'))).toBe('courier');
    expect(jobFor(tag, Array(20).fill('bridge'))).toBe('bridge');
  });
  it('a lonely bridge makes the next borderline flat-ish model its partner', () => {
    const flatish: Shape = { size: 1, long: 1.1, flat: 0.22, fill: 0.6, pointy: 0.1 };   // bridge and keeper score within a whisker
    const couriers: Job[] = ['courier', 'courier', 'courier', 'courier'];
    expect(jobFor(flatish, couriers)).toBe('keeper');
    expect(jobFor(flatish, [...couriers, 'bridge'])).toBe('bridge');
  });
  it('ties always break the same way', () => {
    const s: Shape = { size: 1, long: 1, flat: 1, fill: 0, pointy: 0 };
    expect(new Set(Array.from({ length: 20 }, () => jobFor(s, ['fan', 'courier']))).size).toBe(1);
  });
});
