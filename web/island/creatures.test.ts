import { describe, expect, it } from 'vitest';
import { moveTuning } from './creatures';

const base = { speed: 5, bounce: 5, stamina: 5 };
describe('stats change how a polywog moves', () => {
  it('more Speed walks faster', () => expect(moveTuning({ ...base, speed: 9 }, 1).pace).toBeGreaterThan(moveTuning({ ...base, speed: 2 }, 1).pace));
  it('more Bounce hops higher', () => expect(moveTuning({ ...base, bounce: 9 }, 1).hopHigh).toBeGreaterThan(moveTuning({ ...base, bounce: 2 }, 1).hopHigh));
  it('more Stamina goes further before resting', () => expect(moveTuning({ ...base, stamina: 9 }, 1).stamina).toBeGreaterThan(moveTuning({ ...base, stamina: 2 }, 1).stamina));
  it('bigger polywogs plod, at the same Speed', () => expect(moveTuning(base, 2).pace).toBeLessThan(moveTuning(base, 0.6).pace));
  it('even the slowest polywog still moves, and a zero height cannot make it race', () => {
    expect(moveTuning({ speed: 1, bounce: 1, stamina: 1 }, 2).pace).toBeGreaterThan(0);
    expect(Number.isFinite(moveTuning(base, 0).pace)).toBe(true); expect(moveTuning(base, 0).pace).toBeLessThan(10);
  });
});
