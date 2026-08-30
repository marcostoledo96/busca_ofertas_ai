import { InvariantViolationError } from '../common/index.js';

export type PriceCurrency = 'ARS' | 'USD' | 'UNKNOWN';
export type PriceResolution = 'EXPLICIT' | 'SOURCE_METADATA' | 'TEXT_INFERENCE' | 'AMBIGUOUS';
export type PriceKind = 'TOTAL' | 'DEPOSIT' | 'INSTALLMENT' | 'FROM_PRICE' | 'UNKNOWN';
export type ExchangeRateOrigin = 'MANUAL';

export interface ConvertedPrice {
  readonly amount: number;
  readonly currency: 'ARS';
  readonly exchangeRate: number;
  readonly exchangeRateOrigin: ExchangeRateOrigin;
  readonly convertedAt: Date;
}

export interface ResolvedPrice {
  readonly rawText: string;
  readonly amount: number | null;
  readonly currency: PriceCurrency;
  readonly resolution: PriceResolution;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly kind: PriceKind;
  readonly converted?: ConvertedPrice;
}

export interface CreateResolvedPriceParams {
  readonly rawText: string;
  readonly amount: number | null;
  readonly currency: PriceCurrency;
  readonly resolution: PriceResolution;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly kind?: PriceKind;
  readonly converted?: ConvertedPrice;
}

export const createResolvedPrice = (params: CreateResolvedPriceParams): ResolvedPrice => {
  if (typeof params.rawText !== 'string' || params.rawText.trim().length === 0) {
    throw new InvariantViolationError('ResolvedPrice rawText cannot be empty');
  }

  if (
    typeof params.confidence !== 'number' ||
    !Number.isFinite(params.confidence) ||
    params.confidence < 0 ||
    params.confidence > 1
  ) {
    throw new InvariantViolationError(
      `ResolvedPrice confidence must be a finite number between 0 and 1, got ${String(params.confidence)}`,
    );
  }

  if (params.amount !== null) {
    if (
      typeof params.amount !== 'number' ||
      !Number.isFinite(params.amount) ||
      !Number.isInteger(params.amount) ||
      params.amount < 0
    ) {
      throw new InvariantViolationError(
        `ResolvedPrice amount must be a non-negative integer or null, got ${String(params.amount)}`,
      );
    }
  }

  if (params.converted !== undefined) {
    if (params.currency === 'UNKNOWN' || params.resolution === 'AMBIGUOUS') {
      throw new InvariantViolationError(
        'Cannot convert an ambiguous or UNKNOWN currency to ARS automatically',
      );
    }

    if (
      typeof params.converted.amount !== 'number' ||
      !Number.isFinite(params.converted.amount) ||
      !Number.isInteger(params.converted.amount) ||
      params.converted.amount < 0
    ) {
      throw new InvariantViolationError(
        `Converted amount must be a non-negative integer, got ${String(params.converted.amount)}`,
      );
    }

    if (
      typeof params.converted.exchangeRate !== 'number' ||
      !Number.isFinite(params.converted.exchangeRate) ||
      params.converted.exchangeRate <= 0
    ) {
      throw new InvariantViolationError(
        `Converted exchangeRate must be a positive number, got ${String(params.converted.exchangeRate)}`,
      );
    }

    if (
      !(params.converted.convertedAt instanceof Date) ||
      Number.isNaN(params.converted.convertedAt.getTime())
    ) {
      throw new InvariantViolationError('Converted convertedAt must be a valid Date');
    }
  }

  return {
    rawText: params.rawText,
    amount: params.amount,
    currency: params.currency,
    resolution: params.resolution,
    confidence: params.confidence,
    evidence: [...params.evidence],
    kind: params.kind ?? 'UNKNOWN',
    ...(params.converted !== undefined ? { converted: params.converted } : {}),
  };
};
