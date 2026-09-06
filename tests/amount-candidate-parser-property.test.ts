import { describe, it, expect } from 'vitest';
import { parseAmountCandidate } from '@busca-ofertas-ai/core';

/**
 * Deterministic Linear Congruential Generator (LCG) for reproducible property-based testing
 * without external non-standard dependencies.
 */
class DeterministicRng {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
  }

  public nextFloat(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  public nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  public nextString(length: number): string {
    const chars =
      ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,$-_/*+=:;!¡?¿\u00A0\t\nñáéíóú';
    let str = '';
    for (let i = 0; i < length; i++) {
      const idx = this.nextInt(0, chars.length - 1);
      str += chars[idx];
    }
    return str;
  }
}

describe('BOAI-018: parseAmountCandidate Property-Based Invariant Tests', () => {
  it('Property A: Format explicit ARS integer -> parse -> same integer (roundtrip)', () => {
    const rng = new DeterministicRng(42);

    for (let i = 0; i < 200; i++) {
      const expectedInt = rng.nextInt(0, 10_000_000);
      const formats = [
        `ARS ${String(expectedInt)}`,
        `ars ${String(expectedInt)}`,
        `${String(expectedInt)} ARS`,
        `${String(expectedInt)} pesos argentinos`,
      ];

      for (const formatted of formats) {
        const result = parseAmountCandidate(formatted);
        expect(result.amount).toBe(expectedInt);
        expect(result.status).toBe('EXTRACTED');
        expect(result.confidence).toBe(1.0);
      }
    }
  });

  it('Property B: Amount is always null OR a non-negative safe integer', () => {
    const rng = new DeterministicRng(101);

    for (let i = 0; i < 200; i++) {
      const testStr = rng.nextString(rng.nextInt(1, 50));
      const result = parseAmountCandidate(testStr);

      if (result.amount !== null) {
        expect(typeof result.amount).toBe('number');
        expect(Number.isInteger(result.amount)).toBe(true);
        expect(Number.isSafeInteger(result.amount)).toBe(true);
        expect(result.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('Property C: Determinism — repeated invocation on identical string yields identical deep output', () => {
    const rng = new DeterministicRng(202);

    for (let i = 0; i < 100; i++) {
      const testStr = rng.nextString(rng.nextInt(0, 40));
      const run1 = parseAmountCandidate(testStr);
      const run2 = parseAmountCandidate(testStr);
      const run3 = parseAmountCandidate(testStr);

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
    }
  });

  it('Property D: rawText is strictly bit-by-bit identical to input', () => {
    const rng = new DeterministicRng(303);

    for (let i = 0; i < 150; i++) {
      const testStr = rng.nextString(rng.nextInt(0, 60));
      const result = parseAmountCandidate(testStr);
      expect(result.rawText).toBe(testStr);
    }
  });

  it('Property E: Parser never emits NaN, Infinity, -Infinity, or fractional numbers', () => {
    const rng = new DeterministicRng(404);

    for (let i = 0; i < 200; i++) {
      const testStr = rng.nextString(rng.nextInt(0, 50));
      const result = parseAmountCandidate(testStr);

      if (result.amount !== null) {
        expect(Number.isNaN(result.amount)).toBe(false);
        expect(Number.isFinite(result.amount)).toBe(true);
        expect(result.amount).not.toBe(Infinity);
        expect(result.amount).not.toBe(-Infinity);
        expect(Math.floor(result.amount)).toBe(result.amount);
      }

      expect(Number.isNaN(result.confidence)).toBe(false);
      expect(Number.isFinite(result.confidence)).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('Property F: Fuzzing with arbitrary deterministic strings never throws', () => {
    const rng = new DeterministicRng(505);

    for (let i = 0; i < 300; i++) {
      const fuzzStr = rng.nextString(rng.nextInt(0, 100));
      expect(() => parseAmountCandidate(fuzzStr)).not.toThrow();
    }
  });
});
