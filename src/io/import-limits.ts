export interface ImportTextLimits {
  maxBytes: number;
  maxLines?: number;
  maxNestingDepth?: number;
  maxEntities?: number;
  maxOutputItems?: number;
  nesting?: 'json' | 'step';
}

export class ImportLimitError extends Error {
  constructor(
    public readonly format: string,
    public readonly limit: string,
  ) {
    super(`${format} import rejected: ${limit}`);
    this.name = 'ImportLimitError';
  }
}

export const IMPORT_LIMITS = {
  project: { maxBytes: 20 * 1024 * 1024, maxNestingDepth: 128, nesting: 'json' },
  dxf: {
    maxBytes: 30 * 1024 * 1024,
    maxLines: 1_000_000,
    maxEntities: 50_000,
    maxOutputItems: 250_000,
  },
  ifc: {
    maxBytes: 50 * 1024 * 1024,
    maxLines: 1_500_000,
    maxNestingDepth: 96,
    maxEntities: 250_000,
    nesting: 'step',
  },
  cableCsv: { maxBytes: 5 * 1024 * 1024, maxLines: 50_001 },
} as const satisfies Record<string, ImportTextLimits>;

const assertLineLimit = (text: string, format: string, maxLines: number): void => {
  let lines = text.length === 0 ? 0 : 1;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10 && ++lines > maxLines) {
      throw new ImportLimitError(format, `more than ${maxLines.toLocaleString()} lines`);
    }
  }
};

const assertNestingLimit = (
  text: string,
  format: string,
  maxDepth: number,
  mode: 'json' | 'step',
): void => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const quote = mode === 'json' ? '"' : "'";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (mode === 'json' && escaped) {
        escaped = false;
      } else if (mode === 'json' && char === '\\') {
        escaped = true;
      } else if (mode === 'step' && char === quote && text[index + 1] === quote) {
        index++;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === quote) {
      inString = true;
      continue;
    }
    const isOpen = mode === 'json' ? char === '{' || char === '[' : char === '(';
    const isClose = mode === 'json' ? char === '}' || char === ']' : char === ')';
    if (isOpen && ++depth > maxDepth) {
      throw new ImportLimitError(format, `nesting depth exceeds ${maxDepth}`);
    }
    if (isClose) depth = Math.max(0, depth - 1);
  }
};

export const assertImportTextLimits = (
  text: string,
  format: string,
  limits: ImportTextLimits,
): void => {
  // UTF-16 length is a cheap lower bound for UTF-8 size in the common ASCII
  // file formats. Only allocate the encoded buffer if that first check passes.
  if (text.length > limits.maxBytes) {
    throw new ImportLimitError(format, `file exceeds ${limits.maxBytes.toLocaleString()} bytes`);
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > limits.maxBytes) {
    throw new ImportLimitError(format, `UTF-8 payload exceeds ${limits.maxBytes.toLocaleString()} bytes`);
  }
  if (limits.maxLines !== undefined) assertLineLimit(text, format, limits.maxLines);
  if (limits.maxNestingDepth !== undefined && limits.nesting !== undefined) {
    assertNestingLimit(text, format, limits.maxNestingDepth, limits.nesting);
  }
};
