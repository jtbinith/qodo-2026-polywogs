import { describe, expect, it } from 'vitest';
import { CARD, cleanName } from './cards';

describe('polywog names', () => {
  it('drop the .stl and the (1) Tinkercad adds to copies', () => expect(cleanName('Daring Juttuli-Bojo (2).stl')).toBe('Daring Juttuli-Bojo'));
  it('keep letters from any language', () => expect(cleanName('Zoë the Ñandú')).toBe('Zoë the Ñandú'));
  it('strip anything that could be code or markup', () => expect(cleanName('<img src=x onerror=alert(1)>Bob')).not.toMatch(/[<>=()]/));
  it(`are at most ${CARD.maxName} characters`, () => expect(cleanName('a'.repeat(100)).length).toBe(CARD.maxName));
  it('are never empty', () => { expect(cleanName('')).toBe('Polywog'); expect(cleanName('<<<>>>')).toBe('Polywog'); });
});
