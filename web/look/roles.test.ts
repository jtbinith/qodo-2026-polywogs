import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { jobFor, measure, statsFor } from './roles';

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
  it('a solid block has more stamina than an airy cone', () =>
    expect(statsFor(measure(new THREE.BoxGeometry(1, 1, 1))).stamina).toBeGreaterThan(statsFor(measure(new THREE.ConeGeometry(0.5, 1, 32))).stamina));
  it('the same model always gets the same result', () => {
    const a = measure(new THREE.TorusGeometry(1, 0.3, 16, 48)), b = measure(new THREE.TorusGeometry(1, 0.3, 16, 48));
    expect(jobFor(a)).toBe(jobFor(b)); expect(statsFor(a)).toEqual(statsFor(b));
  });
});
