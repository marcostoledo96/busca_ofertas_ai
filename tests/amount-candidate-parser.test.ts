import { describe, it, expect } from 'vitest';
import {
  parseAmountCandidate,
  parseArsAmountText,
  AmountParsingEvidenceCodes,
  InvariantViolationError,
} from '@busca-ofertas-ai/core';

describe('BOAI-018: parseAmountCandidate Unit Test Matrix', () => {
  describe('1. Formatos ARS obligatorios y positivos (Sección 8 y 22)', () => {
    it('parses "ARS 250000" as integer 250000 with explicit ARS evidence', () => {
      const result = parseAmountCandidate('ARS 250000');
      expect(result.rawText).toBe('ARS 250000');
      expect(result.amount).toBe(250000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(1.0);
      expect(result.currencySignals).toContain('ARS');
      expect(result.evidence).toContain('NUMERIC_TOKEN:250000');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.ARS_PREFIX);
    });

    it('parses "ARS 250.000" as integer 250000 with dot thousands separator', () => {
      const result = parseAmountCandidate('ARS 250.000');
      expect(result.rawText).toBe('ARS 250.000');
      expect(result.amount).toBe(250000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(1.0);
      expect(result.currencySignals).toContain('ARS');
      expect(result.evidence).toContain('NUMERIC_TOKEN:250000');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.SEPARATOR_DOT_THOUSANDS);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.ARS_PREFIX);
    });

    it('parses case-insensitive variants "ars 250.000" and "Ars 250.000"', () => {
      const lower = parseAmountCandidate('ars 250.000');
      expect(lower.amount).toBe(250000);
      expect(lower.confidence).toBe(1.0);
      expect(lower.currencySignals).toContain('ARS');

      const mixed = parseAmountCandidate('Ars 250.000');
      expect(mixed.amount).toBe(250000);
      expect(mixed.confidence).toBe(1.0);
      expect(mixed.currencySignals).toContain('ARS');
    });

    it('parses suffix ARS variants "250.000 ARS" and "250000 ARS"', () => {
      const dotSuffix = parseAmountCandidate('250.000 ARS');
      expect(dotSuffix.amount).toBe(250000);
      expect(dotSuffix.confidence).toBe(1.0);
      expect(dotSuffix.currencySignals).toContain('ARS');
      expect(dotSuffix.evidence).toContain(AmountParsingEvidenceCodes.ARS_SUFFIX);

      const plainSuffix = parseAmountCandidate('250000 ARS');
      expect(plainSuffix.amount).toBe(250000);
      expect(plainSuffix.confidence).toBe(1.0);
      expect(plainSuffix.currencySignals).toContain('ARS');
      expect(plainSuffix.evidence).toContain(AmountParsingEvidenceCodes.ARS_SUFFIX);
    });

    it('parses "$ 250.000 pesos" and variants with dollar sign and word pesos', () => {
      const result = parseAmountCandidate('$ 250.000 pesos');
      expect(result.rawText).toBe('$ 250.000 pesos');
      expect(result.amount).toBe(250000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(0.9);
      expect(result.currencySignals).toContain('DOLLAR_SYMBOL');
      expect(result.currencySignals).toContain('PESOS');
      expect(result.evidence).toContain('NUMERIC_TOKEN:250000');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.SEPARATOR_DOT_THOUSANDS);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.DOLLAR_SYMBOL);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.PESOS_WORD);

      const glued = parseAmountCandidate('$250.000 pesos');
      expect(glued.amount).toBe(250000);
      expect(glued.confidence).toBe(0.9);

      const plainGlued = parseAmountCandidate('$250000 pesos');
      expect(plainGlued.amount).toBe(250000);
      expect(plainGlued.confidence).toBe(0.9);
    });

    it('parses "250 mil pesos" with multiplier mil', () => {
      const result = parseAmountCandidate('250 mil pesos');
      expect(result.rawText).toBe('250 mil pesos');
      expect(result.amount).toBe(250000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(0.9);
      expect(result.currencySignals).toContain('PESOS');
      expect(result.evidence).toContain('NUMERIC_TOKEN:250000');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.MULTIPLIER_MIL);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.PESOS_WORD);
    });

    it('parses "250000 pesos argentinos" and "250 000 pesos argentinos"', () => {
      const plain = parseAmountCandidate('250000 pesos argentinos');
      expect(plain.amount).toBe(250000);
      expect(plain.confidence).toBe(1.0);
      expect(plain.currencySignals).toContain('PESOS_ARGENTINOS');
      expect(plain.currencySignals).toContain('PESOS');
      expect(plain.evidence).toContain(AmountParsingEvidenceCodes.PESOS_ARGENTINOS_PHRASE);

      const space = parseAmountCandidate('250 000 pesos argentinos');
      expect(space.amount).toBe(250000);
      expect(space.confidence).toBe(1.0);
      expect(space.evidence).toContain(AmountParsingEvidenceCodes.SEPARATOR_SPACE_THOUSANDS);
      expect(space.evidence).toContain(AmountParsingEvidenceCodes.PESOS_ARGENTINOS_PHRASE);
    });

    it('parses "250 000 pesos" and "250.000 pesos"', () => {
      const space = parseAmountCandidate('250 000 pesos');
      expect(space.amount).toBe(250000);
      expect(space.confidence).toBe(0.9);
      expect(space.currencySignals).toContain('PESOS');
      expect(space.evidence).toContain(AmountParsingEvidenceCodes.SEPARATOR_SPACE_THOUSANDS);

      const dot = parseAmountCandidate('250.000 pesos');
      expect(dot.amount).toBe(250000);
      expect(dot.confidence).toBe(0.9);
      expect(dot.currencySignals).toContain('PESOS');
      expect(dot.evidence).toContain(AmountParsingEvidenceCodes.SEPARATOR_DOT_THOUSANDS);
    });

    it('parses "ARS 250 000" with space thousands and prefix ARS', () => {
      const result = parseAmountCandidate('ARS 250 000');
      expect(result.amount).toBe(250000);
      expect(result.confidence).toBe(1.0);
      expect(result.currencySignals).toContain('ARS');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.SEPARATOR_SPACE_THOUSANDS);
    });
  });

  describe('2. Preservación absoluta de rawText (Sección 6)', () => {
    it('preserves exact string identity including leading/trailing spaces', () => {
      const input = '   ARS 250.000   ';
      const result = parseAmountCandidate(input);
      expect(result.rawText).toBe(input);
      expect(result.amount).toBe(250000);
    });

    it('preserves non-breaking spaces and tabs without destructive normalization', () => {
      const input = '\t\u00A0$ 250.000 pesos\u00A0\t';
      const result = parseAmountCandidate(input);
      expect(result.rawText).toBe(input);
      expect(result.amount).toBe(250000);
    });

    it('preserves casing, tildes, and surrounding punctuation in rawText', () => {
      const input = '¡OFERTA ÚNICA! Nintendo Switch Lite — $250.000 pesos argentinos.';
      const result = parseAmountCandidate(input);
      expect(result.rawText).toBe(input);
      expect(result.amount).toBe(250000);
    });
  });

  describe('3. Enteros solamente y sin punto flotante (Sección 7)', () => {
    it('always returns safe integers or null', () => {
      const result = parseAmountCandidate('250 mil pesos');
      expect(Number.isInteger(result.amount)).toBe(true);
      expect(Number.isSafeInteger(result.amount)).toBe(true);
      expect(result.amount).toBe(250000);
    });

    it('does not parse fractional mil (e.g. "250,5 mil pesos")', () => {
      const result = parseAmountCandidate('250,5 mil pesos');
      // Fractional amounts are unsupported for the MVP integer-only contract
      expect(result.amount).toBeNull();
      expect(result.status).toBe('AMBIGUOUS');
    });
  });

  describe('4. Sufijo mil y defensas contra falsos positivos (Sección 10)', () => {
    it('multiplies base integer by 1000 for "250 mil"', () => {
      const result = parseAmountCandidate('250 mil');
      expect(result.amount).toBe(250000);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.MULTIPLIER_MIL);
    });

    it('does not match "militares", "milímetros", or "millas" as multiplier mil', () => {
      const militares = parseAmountCandidate('250 militares');
      expect(militares.amount).toBeNull();
      expect(militares.status).toBe('NO_NUMERIC_AMOUNT');

      const milimetros = parseAmountCandidate('250 milímetros');
      expect(milimetros.amount).toBeNull();
      expect(milimetros.status).toBe('NO_NUMERIC_AMOUNT');

      const millas = parseAmountCandidate('250 millas');
      expect(millas.amount).toBeNull();
      expect(millas.status).toBe('NO_NUMERIC_AMOUNT');
    });
  });

  describe('5. Entradas sin precio / ausencia esperada de importe (Sección 11 y 22)', () => {
    const noPriceCases = [
      '',
      '   ',
      'Gratis',
      'GRATIS',
      'Consultar',
      'consultar precio',
      'Precio a consultar',
      'Sin precio',
      'Consultar por privado',
      'Oferta disponible',
      'Nintendo Switch Lite',
      'Nintendo Switch Lite azul impecable',
    ];

    for (const input of noPriceCases) {
      it(`returns amount: null and NO_NUMERIC_AMOUNT for "${input}"`, () => {
        const result = parseAmountCandidate(input);
        expect(result.rawText).toBe(input);
        expect(result.amount).toBeNull();
        expect(result.confidence).toBe(0);
        expect(result.status).toBe('NO_NUMERIC_AMOUNT');
        expect(result.candidates).toHaveLength(0);
      });
    }
  });

  describe('6. Formatos ambiguos y fail-closed (Sección 9 y 22)', () => {
    it('extracts candidate 300 for "$300" but marks dollar currency as ambiguous with confidence 0.6', () => {
      const result = parseAmountCandidate('$300');
      expect(result.rawText).toBe('$300');
      expect(result.amount).toBe(300);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(0.6);
      expect(result.currencySignals).toEqual(['DOLLAR_SYMBOL']);
      expect(result.currencySignals).not.toContain('ARS');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.CURRENCY_AMBIGUOUS_DOLLAR_SIGN);
    });

    it('fails closed on comma thousands "$ 250,000" returning amount: null and AMBIGUOUS', () => {
      const result = parseAmountCandidate('$ 250,000');
      expect(result.rawText).toBe('$ 250,000');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('AMBIGUOUS');
      expect(result.confidence).toBe(0);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.AMBIGUOUS_SEPARATOR_COMMA);
    });

    it('fails closed on bare "1,234" with comma returning amount: null and AMBIGUOUS', () => {
      const result = parseAmountCandidate('1,234');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('AMBIGUOUS');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.AMBIGUOUS_SEPARATOR_COMMA);
    });

    it('fails closed on bare "1.234" without currency returning amount: null and AMBIGUOUS', () => {
      const result = parseAmountCandidate('1.234');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('AMBIGUOUS');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.AMBIGUOUS_BARE_NUMBER);
    });

    it('resolves "ARS 1.234" correctly when explicit ARS is present', () => {
      const result = parseAmountCandidate('ARS 1.234');
      expect(result.amount).toBe(1234);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(1.0);
    });

    it('fails closed on decimal fractions "12.34" and "12,34"', () => {
      const dotFrac = parseAmountCandidate('12.34');
      expect(dotFrac.amount).toBeNull();
      expect(dotFrac.status).toBe('AMBIGUOUS');
      expect(dotFrac.evidence).toContain(AmountParsingEvidenceCodes.DECIMAL_FRACTION_UNSUPPORTED);

      const commaFrac = parseAmountCandidate('12,34');
      expect(commaFrac.amount).toBeNull();
      expect(commaFrac.status).toBe('AMBIGUOUS');
      expect(commaFrac.evidence).toContain(AmountParsingEvidenceCodes.DECIMAL_FRACTION_UNSUPPORTED);
    });
  });

  describe('7. Falsos positivos de especificaciones y modelos (Sección 22)', () => {
    it('ignores "año 2024" as non-price number', () => {
      const result = parseAmountCandidate('año 2024');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('NO_NUMERIC_AMOUNT');
      expect(result.evidence).toContain(
        `${AmountParsingEvidenceCodes.NON_PRICE_NUMBER_IGNORED}:2024`,
      );
    });

    it('ignores "modelo 300" as non-price number', () => {
      const result = parseAmountCandidate('modelo 300');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('NO_NUMERIC_AMOUNT');
      expect(result.evidence).toContain(
        `${AmountParsingEvidenceCodes.NON_PRICE_NUMBER_IGNORED}:300`,
      );
    });

    it('ignores "versión 2" as non-price number', () => {
      const result = parseAmountCandidate('versión 2');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('NO_NUMERIC_AMOUNT');
      expect(result.evidence).toContain(`${AmountParsingEvidenceCodes.NON_PRICE_NUMBER_IGNORED}:2`);
    });

    it('ignores hardware spec units like "32GB"', () => {
      const result = parseAmountCandidate('Nintendo Switch 32GB');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('NO_NUMERIC_AMOUNT');
    });
  });

  describe('8. Múltiples números en el mismo texto (Sección 19 y 22)', () => {
    it('extracts real price and ignores non-price year in "Modelo 2024 — 250.000 pesos"', () => {
      const result = parseAmountCandidate('Modelo 2024 — 250.000 pesos');
      expect(result.amount).toBe(250000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(0.9);
      expect(result.evidence).toContain(
        `${AmountParsingEvidenceCodes.NON_PRICE_NUMBER_IGNORED}:2024`,
      );
    });

    it('extracts real price and ignores item count in "2 controles, precio 250.000 pesos"', () => {
      const result = parseAmountCandidate('2 controles, precio 250.000 pesos');
      expect(result.amount).toBe(250000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.confidence).toBe(0.9);
      expect(result.evidence).toContain(`${AmountParsingEvidenceCodes.NON_PRICE_NUMBER_IGNORED}:2`);
    });

    it('fails closed on conflicting price amounts "ARS 250.000 antes 300.000"', () => {
      const result = parseAmountCandidate('ARS 250.000 antes 300.000');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('AMBIGUOUS');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.MULTIPLE_PRICE_AMOUNTS);
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]?.amount).toBe(250000);
      expect(result.candidates[1]?.amount).toBe(300000);
    });

    it('fails closed on "12 cuotas de 30000" and "12 cuotas de 30.000"', () => {
      const plain = parseAmountCandidate('12 cuotas de 30000');
      expect(plain.amount).toBeNull();
      expect(plain.status).toBe('AMBIGUOUS');
      expect(plain.evidence).toContain(AmountParsingEvidenceCodes.INSTALLMENT_KEYWORD_DETECTED);

      const dot = parseAmountCandidate('12 cuotas de 30.000');
      expect(dot.amount).toBeNull();
      expect(dot.status).toBe('AMBIGUOUS');
      expect(dot.evidence).toContain(AmountParsingEvidenceCodes.INSTALLMENT_KEYWORD_DETECTED);
    });

    it('fails closed on "seña 20000 precio final 250000"', () => {
      const result = parseAmountCandidate('seña 20000 precio final 250000');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('AMBIGUOUS');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.DEPOSIT_KEYWORD_DETECTED);
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.MULTIPLE_PRICE_AMOUNTS);
    });
  });

  describe('9. Sin clasificación de señas/cuotas prematura (Sección 18)', () => {
    it('extracts candidate from "Seña $20.000" without setting kind DEPOSIT', () => {
      const result = parseAmountCandidate('Seña $20.000');
      expect(result.amount).toBe(20000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.evidence).toContain(`${AmountParsingEvidenceCodes.PARTIAL_PRICE_KEYWORD}:seña`);
      // Does not assign kind - kind belongs to ResolvedPrice in BOAI-020
      expect((result as unknown as Record<string, unknown>)['kind']).toBeUndefined();
    });

    it('extracts candidate from "desde $50.000" without setting kind FROM_PRICE', () => {
      const result = parseAmountCandidate('desde $50.000');
      expect(result.amount).toBe(50000);
      expect(result.status).toBe('EXTRACTED');
      expect(result.evidence).toContain(
        `${AmountParsingEvidenceCodes.PARTIAL_PRICE_KEYWORD}:desde`,
      );
      expect((result as unknown as Record<string, unknown>)['kind']).toBeUndefined();
    });
  });

  describe('10. Límites de magnitud y overflow (Sección 20 y 22)', () => {
    it('parses boundary amounts: 0, 1, 100, 999, 1000, 999999', () => {
      expect(parseAmountCandidate('ARS 0').amount).toBe(0);
      expect(parseAmountCandidate('$ 0 pesos').amount).toBe(0);
      expect(parseAmountCandidate('$ 1 pesos').amount).toBe(1);
      expect(parseAmountCandidate('ARS 100').amount).toBe(100);
      expect(parseAmountCandidate('ARS 999').amount).toBe(999);
      expect(parseAmountCandidate('ARS 1000').amount).toBe(1000);
      expect(parseAmountCandidate('ARS 1.000').amount).toBe(1000);
      expect(parseAmountCandidate('ARS 999999').amount).toBe(999999);
      expect(parseAmountCandidate('ARS 999.999').amount).toBe(999999);
    });

    it('parses exactly Number.MAX_SAFE_INTEGER when formatted', () => {
      const maxSafe = Number.MAX_SAFE_INTEGER; // 9007199254740991
      const result = parseAmountCandidate(`ARS ${String(maxSafe)}`);
      expect(result.amount).toBe(maxSafe);
      expect(result.status).toBe('EXTRACTED');
    });

    it('fails closed on overflow: MAX_SAFE_INTEGER + 1', () => {
      const overflowStr = '9007199254740992'; // MAX_SAFE_INTEGER + 1
      const result = parseAmountCandidate(`ARS ${overflowStr}`);
      expect(result.amount).toBeNull();
      expect(result.status).toBe('INVALID_NUMERIC');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.NUMERIC_OVERFLOW);
    });

    it('fails closed on massive 100-digit number without catastrophic failure', () => {
      const huge = '1' + '0'.repeat(100);
      const result = parseAmountCandidate(`ARS ${huge}`);
      expect(result.amount).toBeNull();
      expect(result.status).toBe('INVALID_NUMERIC');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.NUMERIC_OVERFLOW);
    });

    it('fails closed on negative numbers without throwing', () => {
      const result = parseAmountCandidate('ARS -250.000');
      expect(result.amount).toBeNull();
      expect(result.status).toBe('INVALID_NUMERIC');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.NEGATIVE_AMOUNT_UNSUPPORTED);
    });

    it('rejects input exceeding 10,000 characters fail-closed', () => {
      const hugeInput = 'A'.repeat(10_001);
      const result = parseAmountCandidate(hugeInput);
      expect(result.amount).toBeNull();
      expect(result.status).toBe('INVALID_NUMERIC');
      expect(result.evidence).toContain(AmountParsingEvidenceCodes.INPUT_EXCEEDS_MAX_LENGTH);
    });
  });

  describe('11. Input inválido vs No Match (Sección 12)', () => {
    it('throws InvariantViolationError if input is not a string', () => {
      expect(() => parseAmountCandidate(null as unknown as string)).toThrow(
        InvariantViolationError,
      );
      expect(() => parseAmountCandidate(undefined as unknown as string)).toThrow(
        InvariantViolationError,
      );
      expect(() => parseAmountCandidate(12345 as unknown as string)).toThrow(
        InvariantViolationError,
      );
      expect(() => parseAmountCandidate({} as unknown as string)).toThrow(InvariantViolationError);
    });
  });

  describe('12. Batch safety (Sección 24)', () => {
    it('processes heterogeneous batch without throwing or aborting', () => {
      const batch = [
        'ARS 250.000',
        'Consultar',
        '???',
        '250 mil pesos',
        '$300',
        'Gratis',
        '12 cuotas de 30000',
        'Nintendo Switch Lite año 2024 — 250.000 pesos',
        '9007199254740992',
        '-500',
      ];

      const results = batch.map(parseAmountCandidate);
      expect(results).toHaveLength(10);
      expect(results[0]?.amount).toBe(250000);
      expect(results[1]?.amount).toBeNull();
      expect(results[2]?.amount).toBeNull();
      expect(results[3]?.amount).toBe(250000);
      expect(results[4]?.amount).toBe(300);
      expect(results[5]?.amount).toBeNull();
      expect(results[6]?.amount).toBeNull();
      expect(results[7]?.amount).toBe(250000);
      expect(results[8]?.amount).toBeNull();
      expect(results[9]?.amount).toBeNull();
    });
  });

  describe('13. No USD resolution in this issue (Sección 17)', () => {
    it('extracts candidate 300 from "USD 300" with USD signal but does not resolve currency to USD', () => {
      const result = parseAmountCandidate('USD 300');
      expect(result.amount).toBe(300);
      expect(result.status).toBe('EXTRACTED');
      expect(result.currencySignals).toContain('USD');
      // Must not contain resolved currency object or final currency decision
      expect((result as unknown as Record<string, unknown>)['currency']).toBeUndefined();
    });
  });

  describe('14. Alias parseArsAmountText', () => {
    it('functions identically to parseAmountCandidate', () => {
      const r1 = parseAmountCandidate('ARS 250.000');
      const r2 = parseArsAmountText('ARS 250.000');
      expect(r1).toEqual(r2);
    });
  });
});
