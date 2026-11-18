import { describe, expect, it } from 'vitest';
import { hasDutchDashes, parseNlPlate } from '../src/plates/nl.js';

describe('parseNlPlate', () => {
  it.each([
    ['AB1234', 1, 'AB-12-34'],
    ['12-34-AB', 2, '12-34-AB'],
    ['12AB34', 3, '12-AB-34'],
    ['AB12CD', 4, 'AB-12-CD'],
    ['ABCD12', 5, 'AB-CD-12'],
    ['12ABCD', 6, '12-AB-CD'],
    ['12ABC3', 7, '12-ABC-3'],
    ['1ABC23', 8, '1-ABC-23'],
    ['AB123C', 9, 'AB-123-C'],
    ['A123BC', 10, 'A-123-BC'],
    ['ABC12D', 11, 'ABC-12-D'],
    ['A12BCD', 12, 'A-12-BCD'],
    ['1AB234', 13, '1-AB-234'],
    ['123AB4', 14, '123-AB-4'],
  ])('%s is sidecode %i', (input, sidecode, display) => {
    expect(parseNlPlate(input)).toEqual({
      ok: true,
      info: { plate: input.replace(/-/g, ''), sidecode, display },
    });
  });

  it('rejects other shapes', () => {
    expect(parseNlPlate('AB12CDE').ok).toBe(false);
    expect(parseNlPlate('ABCDEF').ok).toBe(false);
  });

  it('recognises Dutch dash positions', () => {
    expect(hasDutchDashes('A-12-BCD')).toBe(true);
    expect(hasDutchDashes('A12 BCD')).toBe(false);
  });
});
