import { describe, expect, it } from 'vitest';
import { importIFC } from '../ifc-import';
import { ImportLimitError, IMPORT_LIMITS } from '../import-limits';

const small = [
  'ISO-10303-21;',
  'HEADER;FILE_SCHEMA((\'IFC4\'));ENDSEC;',
  'DATA;',
  '#1=IFCCARTESIANPOINT((0.,0.,0.));',
  '#2=IFCCARTESIANPOINT((1000.,0.,0.));',
  '#3=IFCPOLYLINE((#1,#2));',
  '#4=IFCSHAPEREPRESENTATION($,$,$,(#3));',
  '#5=IFCPRODUCTDEFINITIONSHAPE($,$,(#4));',
  '#6=IFCAXIS2PLACEMENT3D(#1,$,$);',
  '#7=IFCLOCALPLACEMENT($,#6);',
  "#8=IFCWALL('g',$,'w',$,$,#7,#5,$);",
  'ENDSEC;',
  'END-ISO-10303-21;',
].join('\n');

describe('importIFC', () => {
  it('parses correctly after a previous import was aborted by an import limit', () => {
    const records = Array.from(
      { length: IMPORT_LIMITS.ifc.maxEntities + 1 },
      (_, i) => `#${i + 1}=IFCCARTESIANPOINT((0.,0.,0.));`,
    ).join('\n');
    const big = `ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;\nDATA;\n${records}\nENDSEC;`;
    expect(() => importIFC(big)).toThrow(ImportLimitError);
    const r = importIFC(small);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0].kind).toBe('wall');
  });
});
