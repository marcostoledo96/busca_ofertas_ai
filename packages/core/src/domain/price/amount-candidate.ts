import { InvariantViolationError } from '../common/index.js';

/**
 * Status of an extracted amount candidate.
 */
export type AmountCandidateStatus =
  'EXTRACTED' | 'NO_NUMERIC_AMOUNT' | 'AMBIGUOUS' | 'INVALID_NUMERIC';

/**
 * Textual currency indicator signals detected in the raw text.
 * These represent syntactic observations in the text, NOT final resolved currency.
 */
export type CurrencyTextSignal =
  'ARS' | 'PESOS' | 'PESOS_ARGENTINOS' | 'DOLLAR_SYMBOL' | 'USD' | 'DOLARES';

/**
 * Stable, structured evidence codes emitted during extraction.
 */
export const AmountParsingEvidenceCodes = {
  NUMERIC_TOKEN: 'NUMERIC_TOKEN',
  SEPARATOR_DOT_THOUSANDS: 'SEPARATOR_DOT_THOUSANDS',
  SEPARATOR_SPACE_THOUSANDS: 'SEPARATOR_SPACE_THOUSANDS',
  MULTIPLIER_MIL: 'MULTIPLIER_MIL',
  ARS_PREFIX: 'ARS_PREFIX',
  ARS_SUFFIX: 'ARS_SUFFIX',
  PESOS_WORD: 'PESOS_WORD',
  PESOS_ARGENTINOS_PHRASE: 'PESOS_ARGENTINOS_PHRASE',
  DOLLAR_SYMBOL: 'DOLLAR_SYMBOL',
  STANDALONE_NUMERIC: 'STANDALONE_NUMERIC',
  NO_EXPLICIT_CURRENCY: 'NO_EXPLICIT_CURRENCY',
  CURRENCY_AMBIGUOUS_DOLLAR_SIGN: 'CURRENCY_AMBIGUOUS_DOLLAR_SIGN',
  USD_PREFIX: 'USD_PREFIX',
  USD_SUFFIX: 'USD_SUFFIX',
  DOLARES_WORD: 'DOLARES_WORD',
  PARTIAL_PRICE_KEYWORD: 'PARTIAL_PRICE_KEYWORD',
  AMBIGUOUS_SEPARATOR_COMMA: 'AMBIGUOUS_SEPARATOR_COMMA',
  AMBIGUOUS_BARE_NUMBER: 'AMBIGUOUS_BARE_NUMBER',
  DECIMAL_FRACTION_UNSUPPORTED: 'DECIMAL_FRACTION_UNSUPPORTED',
  MULTIPLE_PRICE_AMOUNTS: 'MULTIPLE_PRICE_AMOUNTS',
  AMBIGUOUS_MULTIPLE_NUMBERS: 'AMBIGUOUS_MULTIPLE_NUMBERS',
  INSTALLMENT_KEYWORD_DETECTED: 'INSTALLMENT_KEYWORD_DETECTED',
  DEPOSIT_KEYWORD_DETECTED: 'DEPOSIT_KEYWORD_DETECTED',
  NON_PRICE_NUMBER_IGNORED: 'NON_PRICE_NUMBER_IGNORED',
  NO_NUMERIC_CONTENT: 'NO_NUMERIC_CONTENT',
  KEYWORD_GRATIS: 'KEYWORD_GRATIS',
  KEYWORD_CONSULTAR: 'KEYWORD_CONSULTAR',
  KEYWORD_SIN_PRECIO: 'KEYWORD_SIN_PRECIO',
  NUMERIC_OVERFLOW: 'NUMERIC_OVERFLOW',
  NEGATIVE_AMOUNT_UNSUPPORTED: 'NEGATIVE_AMOUNT_UNSUPPORTED',
  INPUT_EXCEEDS_MAX_LENGTH: 'INPUT_EXCEEDS_MAX_LENGTH',
} as const;

export type AmountParsingEvidenceCode =
  (typeof AmountParsingEvidenceCodes)[keyof typeof AmountParsingEvidenceCodes];

/**
 * An individual token candidate discovered within the text.
 */
export interface ParsedAmountCandidateToken {
  readonly rawToken: string;
  readonly amount: number | null;
  readonly confidence: number;
  readonly status: AmountCandidateStatus;
  readonly evidence: readonly string[];
  readonly currencySignals: readonly CurrencyTextSignal[];
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Result of parsing amount candidates from raw text.
 *
 * Guarantees:
 * 1. rawText is preserved bit-by-bit identical to input.
 * 2. amount is either a non-negative safe integer or null (never float, NaN, or Infinity).
 * 3. confidence is a finite number in [0, 1].
 * 4. currencySignals reflect textual observations without deciding final currency.
 */
export interface ParsedAmountCandidate {
  readonly rawText: string;
  readonly amount: number | null;
  readonly confidence: number;
  readonly status: AmountCandidateStatus;
  readonly evidence: readonly string[];
  readonly currencySignals: readonly CurrencyTextSignal[];
  readonly candidates: readonly ParsedAmountCandidateToken[];
}

const MAX_INPUT_LENGTH = 10_000;
const BIGINT_MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

// Non-price unit and context regexes
const YEAR_PREFIX_REGEX = /(?<![\p{L}\p{N}])(?:a[ñn]o|anio)\s*[:=]?\s*(\d{4})(?![\p{L}\p{N}])/giu;
const MODEL_PREFIX_REGEX =
  /(?<![\p{L}\p{N}])(?:modelo|model)\s*[:=]?\s*(\d+[\p{L}\p{N}]*)(?![\p{L}\p{N}])/giu;
const VERSION_PREFIX_REGEX =
  /(?<![\p{L}\p{N}])(?:versi[oó]n|version|ver|v)\s*[:=]?\s*(\d+)(?![\p{L}\p{N}])/giu;
const TECH_UNIT_SUFFIX_REGEX =
  /(?<![\p{L}\p{N}])(\d+)\s*(?:gb|tb|mb|mah|ghz|mhz|fps|pulgadas?|pulg|cm|mm|metros|mil[ií]metros|militares|millas)(?![\p{L}\p{N}])/giu;
const ITEM_COUNT_SUFFIX_REGEX =
  /(?<![\p{L}\p{N}])(\d+)\s*(?:controles|control|joysticks?|juegos?|accesorios?|cajas?|unidades?)(?![\p{L}\p{N}])/giu;
const INSTALLMENT_COUNT_PREFIX_REGEX =
  /(?<![\p{L}\p{N}])(\d+)\s*(?:cuotas?|meses?|pagos?)\s*(?:de)?/giu;

// Known no-price phrases
const GRATIS_REGEX = /(?<![\p{L}\p{N}])gratis(?![\p{L}\p{N}])/iu;
const CONSULTAR_REGEX =
  /(?<![\p{L}\p{N}])(?:consultar(?:\s+precio)?|precio\s+a\s+consultar|consultar\s+por\s+privado)(?![\p{L}\p{N}])/iu;
const SIN_PRECIO_REGEX = /(?<![\p{L}\p{N}])sin\s+precio(?![\p{L}\p{N}])/iu;

// Keyword indicators for installments, deposits, and price partials
const INSTALLMENT_KEYWORD_REGEX = /(?<![\p{L}\p{N}])(?:cuotas?|por\s+mes)(?![\p{L}\p{N}])/iu;
const DEPOSIT_KEYWORD_REGEX =
  /(?<![\p{L}\p{N}])(?:se[ñn]a|anticipo|reserva(?:\s+con)?|entrega\s+inicial)(?![\p{L}\p{N}])/iu;
const DESDE_KEYWORD_REGEX = /(?<![\p{L}\p{N}])(?:desde|precio\s+por\s+unidad)(?![\p{L}\p{N}])/iu;
const ANTES_KEYWORD_REGEX =
  /(?<![\p{L}\p{N}])(?:antes|precio\s+anterior|rebajado\s+de)(?![\p{L}\p{N}])/iu;

// Global currency signal matchers
const ARS_SIGNAL_REGEX = /(?<![\p{L}\p{N}])ars(?![\p{L}\p{N}])/iu;
const PESOS_ARG_SIGNAL_REGEX = /(?<![\p{L}\p{N}])pesos\s+argentinos(?![\p{L}\p{N}])/iu;
const PESOS_SIGNAL_REGEX = /(?<![\p{L}\p{N}])pesos(?![\p{L}\p{N}])/iu;
const DOLLAR_SIGNAL_REGEX = /\$/u;
const USD_SIGNAL_REGEX = /(?<![\p{L}\p{N}])(?:usd|us\$|u\$s)(?![\p{L}\p{N}])/iu;
const DOLARES_SIGNAL_REGEX = /(?<![\p{L}\p{N}])d[oó]lares(?![\p{L}\p{N}])/iu;

interface NonPriceSpan {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly value: string;
  readonly reason: string;
}

/**
 * Identifies character spans of numbers that correspond to non-price attributes
 * (years, models, hardware specs, item quantities, or installment counts).
 */
const findNonPriceSpans = (text: string): NonPriceSpan[] => {
  const spans: NonPriceSpan[] = [];

  const collectMatches = (regex: RegExp, reason: string, groupIndex = 1): void => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matchedGroup = match[groupIndex];
      if (matchedGroup) {
        const groupStart = match.index + match[0].indexOf(matchedGroup);
        spans.push({
          startIndex: groupStart,
          endIndex: groupStart + matchedGroup.length,
          value: matchedGroup,
          reason,
        });
      }
    }
  };

  collectMatches(YEAR_PREFIX_REGEX, 'YEAR');
  collectMatches(MODEL_PREFIX_REGEX, 'MODEL');
  collectMatches(VERSION_PREFIX_REGEX, 'VERSION');
  collectMatches(TECH_UNIT_SUFFIX_REGEX, 'TECH_UNIT');
  collectMatches(ITEM_COUNT_SUFFIX_REGEX, 'ITEM_COUNT');
  collectMatches(INSTALLMENT_COUNT_PREFIX_REGEX, 'INSTALLMENT_COUNT');

  return spans;
};

/**
 * Detects currency signals present anywhere in the raw text.
 */
const detectCurrencySignals = (text: string): CurrencyTextSignal[] => {
  const signals: CurrencyTextSignal[] = [];

  if (ARS_SIGNAL_REGEX.test(text)) {
    signals.push('ARS');
  }
  if (PESOS_ARG_SIGNAL_REGEX.test(text)) {
    signals.push('PESOS_ARGENTINOS');
    if (!signals.includes('PESOS')) {
      signals.push('PESOS');
    }
  } else if (PESOS_SIGNAL_REGEX.test(text)) {
    signals.push('PESOS');
  }
  if (DOLLAR_SIGNAL_REGEX.test(text)) {
    signals.push('DOLLAR_SYMBOL');
  }
  if (USD_SIGNAL_REGEX.test(text)) {
    signals.push('USD');
  }
  if (DOLARES_SIGNAL_REGEX.test(text)) {
    signals.push('DOLARES');
  }

  return signals;
};

interface RawMatchCandidate {
  startIndex: number;
  endIndex: number;
  rawMatchedText: string;
  kind:
    | 'MIL_SUFFIX'
    | 'DOT_THOUSANDS'
    | 'SPACE_THOUSANDS'
    | 'COMMA_THOUSANDS_AMBIGUOUS'
    | 'DECIMAL_FRACTION_AMBIGUOUS'
    | 'PLAIN_INTEGER'
    | 'NEGATIVE';
  integerAmount: number | null;
  isOverflow: boolean;
  isAmbiguous: boolean;
  evidence: string[];
}

/**
 * Scans text for candidate numeric expressions and extracts structured candidate tokens.
 */
const scanNumericCandidates = (
  text: string,
  nonPriceSpans: readonly NonPriceSpan[],
): RawMatchCandidate[] => {
  const candidates: RawMatchCandidate[] = [];

  // Match negative amounts e.g. -250000 or -$250
  const negativeRegex = /(?<![\p{L}\p{N}])-\s*(?:\$|ARS\s*)?(\d+(?:[.,]\d+)*)/giu;
  let negMatch: RegExpExecArray | null;
  while ((negMatch = negativeRegex.exec(text)) !== null) {
    candidates.push({
      startIndex: negMatch.index,
      endIndex: negMatch.index + negMatch[0].length,
      rawMatchedText: negMatch[0],
      kind: 'NEGATIVE',
      integerAmount: null,
      isOverflow: false,
      isAmbiguous: false,
      evidence: [AmountParsingEvidenceCodes.NEGATIVE_AMOUNT_UNSUPPORTED],
    });
  }

  // Helper to check if a numeric range overlaps with a recognized non-price span
  const overlapsNonPrice = (start: number, end: number): boolean =>
    nonPriceSpans.some(
      (nps) =>
        (start >= nps.startIndex && start < nps.endIndex) ||
        (end > nps.startIndex && end <= nps.endIndex) ||
        (start <= nps.startIndex && end >= nps.endIndex),
    );

  // 1. Scan for "mil" suffix multiplier: e.g. "250 mil", "250.000 mil"
  // Must respect unicode boundaries: avoids "250 militares", "250 milímetros", "250 millas"
  const milRegex = /(?<![\p{L}\p{N}])(\d{1,3}(?:\.\d{3})+|\d+)\s+mil(?![.\p{L}\p{N}])/giu;
  let milMatch: RegExpExecArray | null;
  while ((milMatch = milRegex.exec(text)) !== null) {
    const rawNumberPart = milMatch[1]!;
    const start = milMatch.index;
    const end = start + milMatch[0].length;

    if (overlapsNonPrice(start, end)) {
      continue;
    }

    const cleanedDigits = rawNumberPart.replace(/\./g, '');
    try {
      const baseVal = BigInt(cleanedDigits);
      const multiplied = baseVal * 1000n;
      if (multiplied > BIGINT_MAX_SAFE_INTEGER || multiplied < 0n) {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: milMatch[0],
          kind: 'MIL_SUFFIX',
          integerAmount: null,
          isOverflow: true,
          isAmbiguous: false,
          evidence: [
            AmountParsingEvidenceCodes.NUMERIC_OVERFLOW,
            AmountParsingEvidenceCodes.MULTIPLIER_MIL,
          ],
        });
      } else {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: milMatch[0],
          kind: 'MIL_SUFFIX',
          integerAmount: Number(multiplied),
          isOverflow: false,
          isAmbiguous: false,
          evidence: [
            `${AmountParsingEvidenceCodes.NUMERIC_TOKEN}:${String(multiplied)}`,
            AmountParsingEvidenceCodes.MULTIPLIER_MIL,
          ],
        });
      }
    } catch {
      candidates.push({
        startIndex: start,
        endIndex: end,
        rawMatchedText: milMatch[0],
        kind: 'MIL_SUFFIX',
        integerAmount: null,
        isOverflow: true,
        isAmbiguous: false,
        evidence: [AmountParsingEvidenceCodes.NUMERIC_OVERFLOW],
      });
    }
  }

  // 2. Scan for dot thousands separator: e.g. "250.000", "1.250.000", "1.234"
  const dotThousandsRegex = /(?<![\p{L}\p{N}])(\d{1,3}(?:\.\d{3})+)(?![\p{L}\p{N}])/giu;
  let dotMatch: RegExpExecArray | null;
  while ((dotMatch = dotThousandsRegex.exec(text)) !== null) {
    const start = dotMatch.index;
    const end = start + dotMatch[0].length;

    // Skip if already captured by milRegex
    if (candidates.some((c) => start >= c.startIndex && end <= c.endIndex)) {
      continue;
    }
    if (overlapsNonPrice(start, end)) {
      continue;
    }

    const digitsOnly = dotMatch[1]!.replace(/\./g, '');
    try {
      const bigVal = BigInt(digitsOnly);
      if (bigVal > BIGINT_MAX_SAFE_INTEGER) {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: dotMatch[0],
          kind: 'DOT_THOUSANDS',
          integerAmount: null,
          isOverflow: true,
          isAmbiguous: false,
          evidence: [
            AmountParsingEvidenceCodes.NUMERIC_OVERFLOW,
            AmountParsingEvidenceCodes.SEPARATOR_DOT_THOUSANDS,
          ],
        });
      } else {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: dotMatch[0],
          kind: 'DOT_THOUSANDS',
          integerAmount: Number(bigVal),
          isOverflow: false,
          isAmbiguous: false,
          evidence: [
            `${AmountParsingEvidenceCodes.NUMERIC_TOKEN}:${String(bigVal)}`,
            AmountParsingEvidenceCodes.SEPARATOR_DOT_THOUSANDS,
          ],
        });
      }
    } catch {
      candidates.push({
        startIndex: start,
        endIndex: end,
        rawMatchedText: dotMatch[0],
        kind: 'DOT_THOUSANDS',
        integerAmount: null,
        isOverflow: true,
        isAmbiguous: false,
        evidence: [AmountParsingEvidenceCodes.NUMERIC_OVERFLOW],
      });
    }
  }

  // 3. Scan for space / NBSP / thin-space thousands separator: e.g. "250 000", "1 250 000"
  const spaceThousandsRegex =
    /(?<![\p{L}\p{N}])(\d{1,3}(?:[ \u00A0\u202F]\d{3})+)(?![\p{L}\p{N}])/giu;
  let spaceMatch: RegExpExecArray | null;
  while ((spaceMatch = spaceThousandsRegex.exec(text)) !== null) {
    const start = spaceMatch.index;
    const end = start + spaceMatch[0].length;

    if (candidates.some((c) => start >= c.startIndex && end <= c.endIndex)) {
      continue;
    }
    if (overlapsNonPrice(start, end)) {
      continue;
    }

    const digitsOnly = spaceMatch[1]!.replace(/[ \u00A0\u202F]/g, '');
    try {
      const bigVal = BigInt(digitsOnly);
      if (bigVal > BIGINT_MAX_SAFE_INTEGER) {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: spaceMatch[0],
          kind: 'SPACE_THOUSANDS',
          integerAmount: null,
          isOverflow: true,
          isAmbiguous: false,
          evidence: [
            AmountParsingEvidenceCodes.NUMERIC_OVERFLOW,
            AmountParsingEvidenceCodes.SEPARATOR_SPACE_THOUSANDS,
          ],
        });
      } else {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: spaceMatch[0],
          kind: 'SPACE_THOUSANDS',
          integerAmount: Number(bigVal),
          isOverflow: false,
          isAmbiguous: false,
          evidence: [
            `${AmountParsingEvidenceCodes.NUMERIC_TOKEN}:${String(bigVal)}`,
            AmountParsingEvidenceCodes.SEPARATOR_SPACE_THOUSANDS,
          ],
        });
      }
    } catch {
      candidates.push({
        startIndex: start,
        endIndex: end,
        rawMatchedText: spaceMatch[0],
        kind: 'SPACE_THOUSANDS',
        integerAmount: null,
        isOverflow: true,
        isAmbiguous: false,
        evidence: [AmountParsingEvidenceCodes.NUMERIC_OVERFLOW],
      });
    }
  }

  // 4. Scan for ambiguous comma separator: e.g. "250,000", "1,234"
  const commaThousandsRegex = /(?<![\p{L}\p{N}])(\d{1,3}(?:,\d{3})+)(?![\p{L}\p{N}])/giu;
  let commaMatch: RegExpExecArray | null;
  while ((commaMatch = commaThousandsRegex.exec(text)) !== null) {
    const start = commaMatch.index;
    const end = start + commaMatch[0].length;

    if (candidates.some((c) => start >= c.startIndex && end <= c.endIndex)) {
      continue;
    }
    if (overlapsNonPrice(start, end)) {
      continue;
    }

    candidates.push({
      startIndex: start,
      endIndex: end,
      rawMatchedText: commaMatch[0],
      kind: 'COMMA_THOUSANDS_AMBIGUOUS',
      integerAmount: null,
      isOverflow: false,
      isAmbiguous: true,
      evidence: [AmountParsingEvidenceCodes.AMBIGUOUS_SEPARATOR_COMMA],
    });
  }

  // 5. Scan for decimal fraction (dot or comma followed by 1 or 2 digits): e.g. "12.34", "12,34", "250.5"
  const decimalFractionRegex = /(?<![\p{L}\p{N}])(\d+[.,]\d{1,2})(?![\p{L}\p{N}])/giu;
  let fracMatch: RegExpExecArray | null;
  while ((fracMatch = decimalFractionRegex.exec(text)) !== null) {
    const start = fracMatch.index;
    const end = start + fracMatch[0].length;

    if (candidates.some((c) => start >= c.startIndex && end <= c.endIndex)) {
      continue;
    }
    if (overlapsNonPrice(start, end)) {
      continue;
    }

    candidates.push({
      startIndex: start,
      endIndex: end,
      rawMatchedText: fracMatch[0],
      kind: 'DECIMAL_FRACTION_AMBIGUOUS',
      integerAmount: null,
      isOverflow: false,
      isAmbiguous: true,
      evidence: [AmountParsingEvidenceCodes.DECIMAL_FRACTION_UNSUPPORTED],
    });
  }

  // 6. Scan for plain continuous digits: e.g. "250000", "300", "0", "1"
  const plainIntegerRegex = /(?<![\p{L}\p{N}])(\d+)(?![\p{L}\p{N}])/giu;
  let plainMatch: RegExpExecArray | null;
  while ((plainMatch = plainIntegerRegex.exec(text)) !== null) {
    const start = plainMatch.index;
    const end = start + plainMatch[0].length;

    if (candidates.some((c) => start >= c.startIndex && end <= c.endIndex)) {
      continue;
    }
    if (overlapsNonPrice(start, end)) {
      continue;
    }

    const digits = plainMatch[1]!;
    try {
      const bigVal = BigInt(digits);
      if (bigVal > BIGINT_MAX_SAFE_INTEGER) {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: plainMatch[0],
          kind: 'PLAIN_INTEGER',
          integerAmount: null,
          isOverflow: true,
          isAmbiguous: false,
          evidence: [AmountParsingEvidenceCodes.NUMERIC_OVERFLOW],
        });
      } else {
        candidates.push({
          startIndex: start,
          endIndex: end,
          rawMatchedText: plainMatch[0],
          kind: 'PLAIN_INTEGER',
          integerAmount: Number(bigVal),
          isOverflow: false,
          isAmbiguous: false,
          evidence: [`${AmountParsingEvidenceCodes.NUMERIC_TOKEN}:${String(bigVal)}`],
        });
      }
    } catch {
      candidates.push({
        startIndex: start,
        endIndex: end,
        rawMatchedText: plainMatch[0],
        kind: 'PLAIN_INTEGER',
        integerAmount: null,
        isOverflow: true,
        isAmbiguous: false,
        evidence: [AmountParsingEvidenceCodes.NUMERIC_OVERFLOW],
      });
    }
  }

  // Sort candidates by position in text
  candidates.sort((a, b) => a.startIndex - b.startIndex);

  return candidates;
};

/**
 * Parses raw text and extracts an ARS amount candidate while strictly preserving raw text.
 *
 * @param rawText Input string to parse.
 * @throws InvariantViolationError if rawText is not a string.
 */
export const parseAmountCandidate = (rawText: string): ParsedAmountCandidate => {
  if (typeof rawText !== 'string') {
    throw new InvariantViolationError('rawText must be a string');
  }

  // DoS protection for pathological length
  if (rawText.length > MAX_INPUT_LENGTH) {
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'INVALID_NUMERIC',
      evidence: [AmountParsingEvidenceCodes.INPUT_EXCEEDS_MAX_LENGTH],
      currencySignals: [],
      candidates: [],
    };
  }

  const globalCurrencySignals = detectCurrencySignals(rawText);
  const nonPriceSpans = findNonPriceSpans(rawText);

  // Check for known non-price indicators
  const hasGratis = GRATIS_REGEX.test(rawText);
  const hasConsultar = CONSULTAR_REGEX.test(rawText);
  const hasSinPrecio = SIN_PRECIO_REGEX.test(rawText);

  // If text has no digits at all or is empty/whitespace
  const hasAnyDigits = /\d/.test(rawText);
  if (!hasAnyDigits) {
    const evidence: string[] = [AmountParsingEvidenceCodes.NO_NUMERIC_CONTENT];
    if (hasGratis) {
      evidence.push(AmountParsingEvidenceCodes.KEYWORD_GRATIS);
    }
    if (hasConsultar) {
      evidence.push(AmountParsingEvidenceCodes.KEYWORD_CONSULTAR);
    }
    if (hasSinPrecio) {
      evidence.push(AmountParsingEvidenceCodes.KEYWORD_SIN_PRECIO);
    }

    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'NO_NUMERIC_AMOUNT',
      evidence,
      currencySignals: globalCurrencySignals,
      candidates: [],
    };
  }

  // Scan candidates
  const rawCandidates = scanNumericCandidates(rawText, nonPriceSpans);

  // Record ignored non-price numbers in evidence if relevant
  const nonPriceEvidence = nonPriceSpans.map(
    (nps) => `${AmountParsingEvidenceCodes.NON_PRICE_NUMBER_IGNORED}:${nps.value}`,
  );

  // Check for partial price keywords in text
  const hasInstallment = INSTALLMENT_KEYWORD_REGEX.test(rawText);
  const hasDeposit = DEPOSIT_KEYWORD_REGEX.test(rawText);
  const hasAntes = ANTES_KEYWORD_REGEX.test(rawText);

  // If no price candidates remain after excluding non-price numbers
  if (rawCandidates.length === 0) {
    const evidence: string[] = [AmountParsingEvidenceCodes.NO_NUMERIC_CONTENT];
    if (hasGratis) evidence.push(AmountParsingEvidenceCodes.KEYWORD_GRATIS);
    if (hasConsultar) evidence.push(AmountParsingEvidenceCodes.KEYWORD_CONSULTAR);
    if (hasSinPrecio) evidence.push(AmountParsingEvidenceCodes.KEYWORD_SIN_PRECIO);
    evidence.push(...nonPriceEvidence);

    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'NO_NUMERIC_AMOUNT',
      evidence,
      currencySignals: globalCurrencySignals,
      candidates: [],
    };
  }

  // Build candidate tokens with individual contextual evidence
  const candidateTokens: ParsedAmountCandidateToken[] = rawCandidates.map((c) => {
    const localEvidence = [...c.evidence];
    const localSignals: CurrencyTextSignal[] = [];

    // Context windows around token (up to 30 chars before and after)
    const textBefore = rawText.slice(Math.max(0, c.startIndex - 30), c.startIndex);
    const textAfter = rawText.slice(c.endIndex, Math.min(rawText.length, c.endIndex + 30));

    // Prefix signals
    if (/(?<![\p{L}\p{N}])ars\s*$/iu.test(textBefore)) {
      localEvidence.push(AmountParsingEvidenceCodes.ARS_PREFIX);
      localSignals.push('ARS');
    } else if (/\$\s*$/u.test(textBefore)) {
      localEvidence.push(AmountParsingEvidenceCodes.DOLLAR_SYMBOL);
      localSignals.push('DOLLAR_SYMBOL');
    } else if (/(?<![\p{L}\p{N}])(?:usd|us\$|u\$s)\s*$/iu.test(textBefore)) {
      localEvidence.push(AmountParsingEvidenceCodes.USD_PREFIX);
      localSignals.push('USD');
    }

    // Suffix signals
    if (/^\s*ars(?![.\p{L}\p{N}])/iu.test(textAfter)) {
      localEvidence.push(AmountParsingEvidenceCodes.ARS_SUFFIX);
      if (!localSignals.includes('ARS')) localSignals.push('ARS');
    } else if (/^\s*(?:mil\s+)?pesos\s+argentinos(?![.\p{L}\p{N}])/iu.test(textAfter)) {
      localEvidence.push(AmountParsingEvidenceCodes.PESOS_ARGENTINOS_PHRASE);
      if (!localSignals.includes('PESOS_ARGENTINOS')) localSignals.push('PESOS_ARGENTINOS');
      if (!localSignals.includes('PESOS')) localSignals.push('PESOS');
    } else if (/^\s*(?:mil\s+)?pesos(?![.\p{L}\p{N}])/iu.test(textAfter)) {
      localEvidence.push(AmountParsingEvidenceCodes.PESOS_WORD);
      if (!localSignals.includes('PESOS')) localSignals.push('PESOS');
    } else if (/^\s*d[oó]lares(?![.\p{L}\p{N}])/iu.test(textAfter)) {
      localEvidence.push(AmountParsingEvidenceCodes.DOLARES_WORD);
      if (!localSignals.includes('DOLARES')) localSignals.push('DOLARES');
    }

    // Partial price keywords
    if (DEPOSIT_KEYWORD_REGEX.test(textBefore)) {
      localEvidence.push(`${AmountParsingEvidenceCodes.PARTIAL_PRICE_KEYWORD}:seña`);
    } else if (DESDE_KEYWORD_REGEX.test(textBefore)) {
      localEvidence.push(`${AmountParsingEvidenceCodes.PARTIAL_PRICE_KEYWORD}:desde`);
    }

    // Confidence determination for token
    let confidence = 0;
    let status: AmountCandidateStatus = 'EXTRACTED';

    if (c.isOverflow) {
      status = 'INVALID_NUMERIC';
      confidence = 0;
    } else if (c.isAmbiguous || c.kind === 'NEGATIVE') {
      status = c.kind === 'NEGATIVE' ? 'INVALID_NUMERIC' : 'AMBIGUOUS';
      confidence = 0;
    } else if (c.integerAmount !== null) {
      // Check for bare numbers without any currency signals
      const hasTokenCurrency = localSignals.length > 0;
      const hasGlobalCurrency = globalCurrencySignals.length > 0;

      // Special check: bare number with dot separator e.g. "1.234" without any currency
      if (c.kind === 'DOT_THOUSANDS' && !hasTokenCurrency && !hasGlobalCurrency) {
        status = 'AMBIGUOUS';
        confidence = 0;
        localEvidence.push(AmountParsingEvidenceCodes.AMBIGUOUS_BARE_NUMBER);
      } else if (
        localSignals.includes('ARS') ||
        localSignals.includes('PESOS_ARGENTINOS') ||
        globalCurrencySignals.includes('ARS') ||
        globalCurrencySignals.includes('PESOS_ARGENTINOS')
      ) {
        status = 'EXTRACTED';
        confidence = 1.0;
      } else if (localSignals.includes('PESOS') || globalCurrencySignals.includes('PESOS')) {
        status = 'EXTRACTED';
        confidence = 0.9;
      } else if (
        localSignals.includes('DOLLAR_SYMBOL') ||
        globalCurrencySignals.includes('DOLLAR_SYMBOL')
      ) {
        status = 'EXTRACTED';
        confidence = 0.6;
        localEvidence.push(AmountParsingEvidenceCodes.CURRENCY_AMBIGUOUS_DOLLAR_SIGN);
      } else if (
        localSignals.includes('USD') ||
        localSignals.includes('DOLARES') ||
        globalCurrencySignals.includes('USD') ||
        globalCurrencySignals.includes('DOLARES')
      ) {
        status = 'EXTRACTED';
        confidence = 0.5;
      } else {
        // Standalone or plain number without explicit currency
        status = 'EXTRACTED';
        confidence = 0.6;
        localEvidence.push(AmountParsingEvidenceCodes.STANDALONE_NUMERIC);
        localEvidence.push(AmountParsingEvidenceCodes.NO_EXPLICIT_CURRENCY);
      }
    }

    return {
      rawToken: c.rawMatchedText,
      amount: status === 'EXTRACTED' ? c.integerAmount : null,
      confidence,
      status,
      evidence: localEvidence,
      currencySignals: localSignals,
      startIndex: c.startIndex,
      endIndex: c.endIndex,
    };
  });

  // Collect overall evidence
  const overallEvidence: string[] = [];

  // 1. Check for negative amount error
  const hasNegative = candidateTokens.some(
    (ct) =>
      ct.status === 'INVALID_NUMERIC' &&
      ct.evidence.includes(AmountParsingEvidenceCodes.NEGATIVE_AMOUNT_UNSUPPORTED),
  );
  if (hasNegative) {
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'INVALID_NUMERIC',
      evidence: [AmountParsingEvidenceCodes.NEGATIVE_AMOUNT_UNSUPPORTED, ...nonPriceEvidence],
      currencySignals: globalCurrencySignals,
      candidates: candidateTokens,
    };
  }

  // 2. Check for overflow
  const hasOverflow = candidateTokens.some(
    (ct) =>
      ct.status === 'INVALID_NUMERIC' &&
      ct.evidence.includes(AmountParsingEvidenceCodes.NUMERIC_OVERFLOW),
  );
  if (hasOverflow) {
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'INVALID_NUMERIC',
      evidence: [AmountParsingEvidenceCodes.NUMERIC_OVERFLOW, ...nonPriceEvidence],
      currencySignals: globalCurrencySignals,
      candidates: candidateTokens,
    };
  }

  // 3. Ambiguous installment format: e.g. "12 cuotas de 30000"
  if (
    hasInstallment &&
    (candidateTokens.length > 1 || nonPriceSpans.some((n) => n.reason === 'INSTALLMENT_COUNT'))
  ) {
    overallEvidence.push(AmountParsingEvidenceCodes.INSTALLMENT_KEYWORD_DETECTED);
    overallEvidence.push(AmountParsingEvidenceCodes.AMBIGUOUS_MULTIPLE_NUMBERS);
    overallEvidence.push(...nonPriceEvidence);
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'AMBIGUOUS',
      evidence: overallEvidence,
      currencySignals: globalCurrencySignals,
      candidates: candidateTokens,
    };
  }

  // 4. Ambiguous deposit with multiple prices: e.g. "seña 20000 precio final 250000"
  if (hasDeposit && candidateTokens.length > 1) {
    overallEvidence.push(AmountParsingEvidenceCodes.DEPOSIT_KEYWORD_DETECTED);
    overallEvidence.push(AmountParsingEvidenceCodes.MULTIPLE_PRICE_AMOUNTS);
    overallEvidence.push(...nonPriceEvidence);
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'AMBIGUOUS',
      evidence: overallEvidence,
      currencySignals: globalCurrencySignals,
      candidates: candidateTokens,
    };
  }

  // 5. Multiple price candidates: e.g. "ARS 250.000 antes 300.000"
  if (candidateTokens.length > 1) {
    overallEvidence.push(AmountParsingEvidenceCodes.MULTIPLE_PRICE_AMOUNTS);
    if (hasAntes) {
      overallEvidence.push('PREVIOUS_PRICE_KEYWORD');
    }
    overallEvidence.push(...nonPriceEvidence);
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: 'AMBIGUOUS',
      evidence: overallEvidence,
      currencySignals: globalCurrencySignals,
      candidates: candidateTokens,
    };
  }

  // Exactly one candidate token found
  const single = candidateTokens[0]!;

  if (single.status !== 'EXTRACTED' || single.amount === null) {
    const evidence = [...single.evidence, ...nonPriceEvidence];
    return {
      rawText,
      amount: null,
      confidence: 0,
      status: single.status,
      evidence,
      currencySignals: globalCurrencySignals,
      candidates: candidateTokens,
    };
  }

  // Combine single token evidence with non-price evidence
  const evidence = [...single.evidence, ...nonPriceEvidence];

  return {
    rawText,
    amount: single.amount,
    confidence: single.confidence,
    status: 'EXTRACTED',
    evidence,
    currencySignals: globalCurrencySignals,
    candidates: candidateTokens,
  };
};

/**
 * Semantically explicit alias for parseAmountCandidate in ARS text extraction contexts.
 */
export const parseArsAmountText = parseAmountCandidate;
