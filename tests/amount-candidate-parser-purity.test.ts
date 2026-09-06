import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('BOAI-018: parseAmountCandidate Architectural Purity & Non-Functional Invariants (Sección 23)', () => {
  it('does not use forbidden impure globals or I/O in parser implementation', () => {
    const parserFilePath = path.resolve(
      __dirname,
      '../packages/core/src/domain/price/amount-candidate.ts',
    );
    const sourceContent = fs.readFileSync(parserFilePath, 'utf-8');

    const forbiddenPatterns = [
      'Date.now(',
      'new Date(',
      'Math.random(',
      'crypto.randomUUID(',
      'fetch(',
      'eval(',
      'new Function(',
      'process.env',
      'node:fs',
      'node:http',
      'node:https',
      'node:net',
      'parseFloat(',
    ];

    for (const pattern of forbiddenPatterns) {
      expect(sourceContent.includes(pattern)).toBe(false);
    }
  });

  it('has no external imports other than pure core common errors', () => {
    const parserFilePath = path.resolve(
      __dirname,
      '../packages/core/src/domain/price/amount-candidate.ts',
    );
    const sourceContent = fs.readFileSync(parserFilePath, 'utf-8');

    const importLines = sourceContent
      .split('\n')
      .filter((line) => line.trim().startsWith('import '));

    for (const line of importLines) {
      expect(line).toMatch(/^import\s+.*\s+from\s+['"]\.\.\/common\/index\.js['"];$/);
    }
  });
});
