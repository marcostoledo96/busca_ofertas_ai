import { describe, it, expect } from 'vitest';
import { type Run, type SourceRun, createRun, createSourceRun } from '@busca-ofertas-ai/core';

describe('Discriminated Unions Type-Narrowing & State Representation (BOAI-002)', () => {
  const baseDate = new Date('2026-08-30T12:00:00.000Z');
  const finishDate = new Date('2026-08-30T12:05:00.000Z');

  describe('Run Discriminated Union Narrowing', () => {
    it('narrows fields accurately based on status discriminant', () => {
      const failedRun: Run = createRun({
        id: 'run-fail',
        savedSearchId: 'search-1',
        status: 'FAILED',
        startedAt: baseDate,
        finishedAt: finishDate,
        error: 'Network outage during run execution',
      });

      if (failedRun.status === 'FAILED') {
        // TypeScript proves that finishedAt and error are required and non-optional on FailedRun
        const errMessage: string = failedRun.error;
        const finished: Date = failedRun.finishedAt;
        expect(errMessage).toBe('Network outage during run execution');
        expect(finished).toEqual(finishDate);
      } else {
        throw new Error('Failed to narrow FailedRun');
      }

      const successRun: Run = createRun({
        id: 'run-ok',
        savedSearchId: 'search-1',
        status: 'SUCCESS',
        startedAt: baseDate,
        finishedAt: finishDate,
      });

      if (successRun.status === 'SUCCESS') {
        const finished: Date = successRun.finishedAt;
        expect(finished).toEqual(finishDate);
      } else {
        throw new Error('Failed to narrow SuccessRun');
      }

      const runningRun: Run = createRun({
        id: 'run-in-progress',
        savedSearchId: 'search-1',
        status: 'RUNNING',
        startedAt: baseDate,
      });

      if (runningRun.status === 'RUNNING') {
        expect(runningRun.startedAt).toEqual(baseDate);
      } else {
        throw new Error('Failed to narrow RunningRun');
      }
    });
  });

  describe('SourceRun Discriminated Union Narrowing', () => {
    it('narrows ZERO_RESULTS_CONFIRMED to itemsCount literal 0 and finishedAt Date', () => {
      const zeroRun: SourceRun = createSourceRun({
        id: 'src-zero',
        runId: 'run-1',
        sourceId: 'facebook',
        status: 'ZERO_RESULTS_CONFIRMED',
        startedAt: baseDate,
        finishedAt: finishDate,
        itemsCount: 0,
      });

      if (zeroRun.status === 'ZERO_RESULTS_CONFIRMED') {
        // Narrowing guarantees itemsCount is literal 0 type
        const count: 0 = zeroRun.itemsCount;
        const finished: Date = zeroRun.finishedAt;
        expect(count).toBe(0);
        expect(finished).toEqual(finishDate);
      } else {
        throw new Error('Failed to narrow ZeroResultsConfirmedSourceRun');
      }
    });

    it('narrows SUCCESS to required itemsCount number and finishedAt Date', () => {
      const successSourceRun: SourceRun = createSourceRun({
        id: 'src-ok',
        runId: 'run-1',
        sourceId: 'facebook',
        status: 'SUCCESS',
        startedAt: baseDate,
        finishedAt: finishDate,
        itemsCount: 42,
      });

      if (successSourceRun.status === 'SUCCESS') {
        const count: number = successSourceRun.itemsCount;
        const finished: Date = successSourceRun.finishedAt;
        expect(count).toBe(42);
        expect(finished).toEqual(finishDate);
      } else {
        throw new Error('Failed to narrow SuccessSourceRun');
      }
    });

    it('narrows error statuses to require diagnostic error message and finishedAt', () => {
      const rateLimitedRun: SourceRun = createSourceRun({
        id: 'src-limited',
        runId: 'run-1',
        sourceId: 'facebook',
        status: 'RATE_LIMITED',
        startedAt: baseDate,
        finishedAt: finishDate,
        error: 'Too many requests: backoff 60s',
      });

      if (rateLimitedRun.status === 'RATE_LIMITED') {
        const errorText: string = rateLimitedRun.error;
        const finished: Date = rateLimitedRun.finishedAt;
        expect(errorText).toBe('Too many requests: backoff 60s');
        expect(finished).toEqual(finishDate);
      } else {
        throw new Error('Failed to narrow RateLimitedSourceRun');
      }
    });
  });
});
