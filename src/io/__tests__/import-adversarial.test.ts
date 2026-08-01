import { describe, expect, it } from 'vitest';
import { parseDXF } from '../dxf-import';
import { importIFC } from '../ifc-import';
import { importProjectJSON } from '../project';

const randomText = (seed: number, length: number): string => {
  let state = seed >>> 0;
  let result = '';
  const alphabet = '0ABCDEF#=(),;\\r\\n\\u0000\\u2028{}[]"+-eE ';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    result += alphabet[state % alphabet.length];
  }
  return result;
};

describe('adversarial import corpus', () => {
  it('keeps deterministic malformed IFC and DXF inputs bounded', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const text = randomText(seed, 64 + seed * 7);
      try {
        const result = importIFC(text);
        expect(result.entities.length).toBeLessThanOrEqual(50_000);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      try {
        const result = parseDXF(text);
        expect(result.vectors?.length ?? 0).toBeLessThanOrEqual(100_000);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  it('rejects prototype-shaped and recursively damaged project payloads', () => {
    const before = ({} as Record<string, unknown>).polluted;
    const hostile = JSON.stringify({
      format: 'opencad-electrical',
      version: 1,
      project: JSON.parse('{"__proto__":{"polluted":true},"id":"x","name":"x","sheets":{}}'),
    });
    expect(() => importProjectJSON(hostile)).toThrow(/damaged|incomplete/);
    expect(({} as Record<string, unknown>).polluted).toBe(before);

    let deep = 'null';
    for (let depth = 0; depth < 2_000; depth += 1) deep = `{"x":${deep}}`;
    const nested = `{"format":"opencad-electrical","version":1,"project":${deep}}`;
    expect(() => importProjectJSON(nested)).toThrow();
  });
});
