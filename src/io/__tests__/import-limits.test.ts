import { describe, expect, it } from 'vitest';
import {
  assertImportTextLimits,
  IMPORT_LIMITS,
  ImportLimitError,
  type ImportTextLimits,
} from '../import-limits';
import { importProjectJSON } from '../project';
import { importIFC } from '../ifc-import';
import { parseDXF } from '../dxf-import';

describe('import resource limits', () => {
  it('rejects a UTF-8 payload whose byte length exceeds the cap', () => {
    const limits: ImportTextLimits = { maxBytes: 3 };
    expect(() => assertImportTextLimits('éé', 'fixture', limits)).toThrow(ImportLimitError);
  });

  it('rejects excessive line counts before a parser splits the payload', () => {
    const limits: ImportTextLimits = { maxBytes: 100, maxLines: 3 };
    expect(() => assertImportTextLimits('a\nb\nc\nd', 'fixture', limits)).toThrow(/more than 3 lines/);
  });

  it('rejects deeply nested project JSON before JSON.parse', () => {
    const deep = `${'{"a":'.repeat(130)}0${'}'.repeat(130)}`;
    expect(() => importProjectJSON(deep)).toThrow(/nesting depth exceeds 128/);
  });

  it('rejects deeply nested IFC argument structures before record parsing', () => {
    const deep = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;#1=IFCTEST(${'('.repeat(97)}0${')'.repeat(97)});ENDSEC;END-ISO-10303-21;`;
    expect(() => importIFC(deep)).toThrow(/nesting depth exceeds 96/);
  });

  it('rejects excessive DXF entity counts before rendering vectors', () => {
    const entities = '0\nLINE\n'.repeat(IMPORT_LIMITS.dxf.maxEntities + 1);
    const dxf = `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
    expect(() => parseDXF(dxf)).toThrow(/more than 50,000 entities/);
  });
});
