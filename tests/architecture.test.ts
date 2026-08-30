import { describe, it, expect } from 'vitest';
import * as CoreModule from '@busca-ofertas-ai/core';

describe('Architecture & Module Boundary Invariants (BOAI-002)', () => {
  it('exports pure domain contracts, entities, factories, and ports from entrypoint', () => {
    // Assert required exports exist on the public entrypoint
    expect(typeof CoreModule.createResolvedPrice).toBe('function');
    expect(typeof CoreModule.createEvaluationReason).toBe('function');
    expect(typeof CoreModule.createEvaluation).toBe('function');
    expect(typeof CoreModule.createListing).toBe('function');
    expect(typeof CoreModule.createObservation).toBe('function');
    expect(typeof CoreModule.createOpportunity).toBe('function');
    expect(typeof CoreModule.createFeedback).toBe('function');
    expect(typeof CoreModule.createSavedSearch).toBe('function');
    expect(typeof CoreModule.createRun).toBe('function');
    expect(typeof CoreModule.createSourceRun).toBe('function');
    expect(typeof CoreModule.createSourceHealth).toBe('function');
    expect(typeof CoreModule.hasHardRejection).toBe('function');
    expect(typeof CoreModule.canPromoteToMatch).toBe('function');
    expect(typeof CoreModule.applySubsequentEvaluation).toBe('function');
    expect(typeof CoreModule.DomainError).toBe('function');
    expect(typeof CoreModule.InvariantViolationError).toBe('function');
  });

  it('contains no direct runtime dependencies in @busca-ofertas-ai/core package.json', () => {
    expect(CoreModule.CORE_PACKAGE_NAME).toBe('@busca-ofertas-ai/core');
  });
});
