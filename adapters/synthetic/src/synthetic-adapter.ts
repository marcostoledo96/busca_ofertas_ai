import type { SourceHealth } from '@busca-ofertas-ai/core';
import type {
  AdapterContext,
  DiagnosticsStopReason,
  HealthCheckRequest,
  ListingReference,
  OperationControl,
  RawListingCandidate,
  RawListingDetails,
  SourceAdapter,
  SourceCapabilities,
  SourceSearchRequest,
  SourceSearchResult,
} from '@busca-ofertas-ai/adapter-sdk';
import {
  ADAPTER_SDK_VERSION,
  createSourceDiagnostics,
  createSuccessSearchResult,
  createZeroResultsConfirmedSearchResult,
  isAbortedOrExpired,
  SourceAdapterError,
} from '@busca-ofertas-ai/adapter-sdk';
import { SYNTHETIC_FIXTURES } from './fixtures/synthetic-fixtures.js';
import type {
  SyntheticAdapterOptions,
  SyntheticHealthStatus,
  SyntheticListingFixture,
  SyntheticScenario,
} from './types.js';
import {
  DEFAULT_SYNTHETIC_PAGE_SIZE,
  deepCloneJson,
  isValidSyntheticPageSize,
  isSyntheticScenario,
  MAX_SYNTHETIC_PAGE_SIZE,
  MIN_SYNTHETIC_PAGE_SIZE,
  SYNTHETIC_ADAPTER_CAPABILITIES,
  SYNTHETIC_ADAPTER_ID,
  SYNTHETIC_ADAPTER_VERSION,
  validateSyntheticPageSize,
} from './types.js';

/**
 * SyntheticAdapter: 100% deterministic, offline source adapter implementing SourceAdapter.
 *
 * Contractual Reference: Issue #10 (BOAI-009), ADR-002, ADR-009, docs/03_ADAPTER_SDK.md.
 *
 * Design Invariants:
 * - Implements neutral SourceAdapter interface without any synthetic special casing in core or SDK.
 * - Zero external npm runtime dependencies and zero network calls (100% offline).
 * - Deterministic, non-random behavior (timestamps driven by injected AdapterContext clock).
 * - Full scenario matrix support (SUCCESS, ZERO_RESULTS, NETWORK_ERROR, TIMEOUT, RATE_LIMITED,
 *   AUTHENTICATION_REQUIRED, CONTRACT_CHANGED).
 * - Artificial multi-page pagination with accurate diagnostics and stopReason.
 * - Intentional cross-query duplicates preservation for downstream canonicalization verification.
 */
export class SyntheticAdapter implements SourceAdapter {
  readonly id: string = SYNTHETIC_ADAPTER_ID;
  readonly version: string = SYNTHETIC_ADAPTER_VERSION;
  readonly sdkVersion: string = ADAPTER_SDK_VERSION;
  readonly capabilities: SourceCapabilities = SYNTHETIC_ADAPTER_CAPABILITIES;

  private _initialized = false;
  private _disposed = false;
  private _initCount = 0;
  private _disposeCount = 0;
  private _context?: AdapterContext | undefined;
  private _scenario: SyntheticScenario;
  private _healthStatus: SyntheticHealthStatus;
  private _pageSize: number;
  private _fixtures: readonly SyntheticListingFixture[];

  constructor(options: SyntheticAdapterOptions = {}) {
    this._scenario = options.defaultScenario ?? 'SUCCESS';
    this._healthStatus = options.healthStatus ?? 'HEALTHY';
    this._pageSize =
      options.pageSize !== undefined
        ? validateSyntheticPageSize(options.pageSize)
        : DEFAULT_SYNTHETIC_PAGE_SIZE;
    this._fixtures = (options.fixtures ?? SYNTHETIC_FIXTURES).map((f) => deepCloneJson(f));
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get initCount(): number {
    return this._initCount;
  }

  get disposeCount(): number {
    return this._disposeCount;
  }

  get scenario(): SyntheticScenario {
    return this._scenario;
  }

  get healthStatus(): SyntheticHealthStatus {
    return this._healthStatus;
  }

  get pageSize(): number {
    return this._pageSize;
  }

  public setScenario(scenario: SyntheticScenario): this {
    this._scenario = scenario;
    return this;
  }

  public setHealthStatus(status: SyntheticHealthStatus): this {
    this._healthStatus = status;
    return this;
  }

  public setPageSize(pageSize: number): this {
    this._pageSize = validateSyntheticPageSize(pageSize);
    return this;
  }

  public setFixtures(fixtures: readonly SyntheticListingFixture[]): this {
    this._fixtures = fixtures.map((f) => deepCloneJson(f));
    return this;
  }

  public initialize(context: AdapterContext): Promise<void> {
    this._initCount++;
    this._initialized = true;
    this._context = context;
    context.logger.info('adapter.initialized', { adapterId: this.id, version: this.version });
    return Promise.resolve();
  }

  public healthCheck(request: HealthCheckRequest): Promise<SourceHealth> {
    const unusableError = this.checkUsable(request.control);
    if (unusableError) {
      return Promise.reject(unusableError);
    }

    const checkedAt = this._context?.clock.now() ?? new Date();

    if (this._healthStatus === 'UNAVAILABLE') {
      return Promise.resolve({
        sourceId: this.id,
        status: 'UNAVAILABLE',
        checkedAt,
        evidence: ['Synthetic offline source simulated as unavailable'],
      });
    }

    if (this._healthStatus === 'AUTH_REQUIRED') {
      return Promise.resolve({
        sourceId: this.id,
        status: 'AUTH_REQUIRED',
        checkedAt,
        evidence: ['Synthetic offline source simulated authentication required'],
      });
    }

    if (this._healthStatus === 'DEGRADED') {
      return Promise.resolve({
        sourceId: this.id,
        status: 'DEGRADED',
        checkedAt,
        evidence: ['Synthetic source performance degraded', 'Partial fixture availability'],
      });
    }

    return Promise.resolve({
      sourceId: this.id,
      status: 'HEALTHY',
      checkedAt,
      evidence: ['Synthetic offline source operational', 'In-memory fixtures available'],
    });
  }

  public search(request: SourceSearchRequest): Promise<SourceSearchResult> {
    const unusableError = this.checkUsable(request.control);
    if (unusableError) {
      return Promise.reject(unusableError);
    }

    let activeScenario = this._scenario;

    if (request.sourceOptions && typeof request.sourceOptions === 'object') {
      const optionScenario = request.sourceOptions['scenario'];
      if (optionScenario !== undefined) {
        if (!isSyntheticScenario(optionScenario)) {
          const scenarioDisplay =
            typeof optionScenario === 'string'
              ? optionScenario
              : (JSON.stringify(optionScenario) ?? 'unknown');
          return Promise.reject(
            new SourceAdapterError({
              code: 'CONFIGURATION_UNSUPPORTED',
              message: `Invalid synthetic scenario '${scenarioDisplay}' specified in sourceOptions. Supported scenarios: SUCCESS, ZERO_RESULTS, ZERO_RESULTS_CONFIRMED, NETWORK_ERROR, TIMEOUT, RATE_LIMITED, AUTHENTICATION_REQUIRED, CONTRACT_CHANGED.`,
              retryable: false,
              evidence: [`sourceOptions.scenario = ${scenarioDisplay}`],
            }),
          );
        }
        activeScenario = optionScenario;
      }
    }

    if (activeScenario === 'NETWORK_ERROR') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'NETWORK_ERROR',
          message: 'Simulated network connection failure in synthetic adapter',
          retryable: true,
          evidence: ['Simulated TCP connection timeout', 'Synthetic DNS lookup failed'],
        }),
      );
    }

    if (activeScenario === 'TIMEOUT') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'TIMEOUT',
          message: 'Simulated search timeout in synthetic adapter',
          retryable: true,
          evidence: ['Simulated query deadline exceeded after 5000ms'],
        }),
      );
    }

    if (activeScenario === 'RATE_LIMITED') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'RATE_LIMITED',
          message: 'Simulated rate limit exceeded in synthetic adapter',
          retryable: true,
          evidence: ['Simulated HTTP 429 Too Many Requests'],
        }),
      );
    }

    if (activeScenario === 'AUTHENTICATION_REQUIRED') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Simulated authentication required in synthetic adapter',
          retryable: false,
          evidence: ['Simulated HTTP 401 Unauthorized / Session expired'],
        }),
      );
    }

    if (activeScenario === 'CONTRACT_CHANGED') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'CONTRACT_CHANGED',
          message: 'Simulated source contract change in synthetic adapter',
          retryable: false,
          evidence: [
            'Simulated payload schema mismatch',
            'Missing expected listing container in response',
          ],
        }),
      );
    }

    if (activeScenario === 'ZERO_RESULTS' || activeScenario === 'ZERO_RESULTS_CONFIRMED') {
      const diagnostics = createSourceDiagnostics({
        pagesRequested: request.pagination.maxPages,
        pagesCompleted: 1,
        rawItemsCount: 0,
        parsedItemsCount: 0,
        rejectedItemsCount: 0,
        stopReason: 'NO_MORE_RESULTS',
        collectorId: 'synthetic-fixture',
      });

      return Promise.resolve(
        createZeroResultsConfirmedSearchResult({
          sourceId: this.id,
          pagesRead: 1,
          hasMore: false,
          diagnostics,
        }),
      );
    }

    // Resolve candidates matching requested queries
    const matchedFixtures = this.resolveMatchingFixtures(request.queries);

    if (matchedFixtures.length === 0) {
      const diagnostics = createSourceDiagnostics({
        pagesRequested: request.pagination.maxPages,
        pagesCompleted: 1,
        rawItemsCount: 0,
        parsedItemsCount: 0,
        rejectedItemsCount: 0,
        stopReason: 'NO_MORE_RESULTS',
        collectorId: 'synthetic-fixture',
      });

      return Promise.resolve(
        createZeroResultsConfirmedSearchResult({
          sourceId: this.id,
          pagesRead: 1,
          hasMore: false,
          diagnostics,
        }),
      );
    }

    // Determine page size
    let pageSize = this._pageSize;
    if (request.sourceOptions && typeof request.sourceOptions === 'object') {
      const optionPageSize = request.sourceOptions['pageSize'];
      if (optionPageSize !== undefined) {
        if (!isValidSyntheticPageSize(optionPageSize)) {
          const pageSizeDisplay =
            typeof optionPageSize === 'string' ||
            typeof optionPageSize === 'number' ||
            typeof optionPageSize === 'boolean'
              ? String(optionPageSize)
              : (JSON.stringify(optionPageSize) ?? 'invalid');
          return Promise.reject(
            new SourceAdapterError({
              code: 'CONFIGURATION_UNSUPPORTED',
              message: `Invalid synthetic pageSize '${pageSizeDisplay}' specified in sourceOptions. Must be an integer between ${MIN_SYNTHETIC_PAGE_SIZE} and ${MAX_SYNTHETIC_PAGE_SIZE}.`,
              retryable: false,
              evidence: [`sourceOptions.pageSize = ${pageSizeDisplay}`],
            }),
          );
        }
        pageSize = optionPageSize;
      }
    }

    const maxPages = request.pagination.maxPages;
    const maxItems = request.pagination.maxItems;
    const observedAt = this._context?.clock.now() ?? new Date();

    let pagesRead = 0;
    const collectedCandidates: RawListingCandidate[] = [];
    let hasMore = false;
    let stopReason: DiagnosticsStopReason = 'ALL_PAGES_FETCHED';

    const totalItems = matchedFixtures.length;
    const totalPagesAvailable = Math.ceil(totalItems / pageSize);

    for (let page = 1; page <= maxPages; page++) {
      pagesRead = page;
      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalItems);

      if (startIndex >= totalItems) {
        break;
      }

      const pageFixtures = matchedFixtures.slice(startIndex, endIndex);

      for (const fixture of pageFixtures) {
        collectedCandidates.push({
          sourceId: this.id,
          externalId: fixture.externalId,
          canonicalUrl: fixture.canonicalUrl,
          title: fixture.title,
          description: fixture.description,
          rawPriceText: fixture.rawPriceText,
          sourceCurrencyCode: fixture.sourceCurrencyCode ?? null,
          rawLocationText: fixture.rawLocationText ?? null,
          rawConditionText: fixture.rawConditionText ?? null,
          rawAvailabilityText: fixture.rawAvailabilityText ?? null,
          imageUrls: deepCloneJson(fixture.imageUrls),
          observedAt,
          sourceMetadata: deepCloneJson(fixture.sourceMetadata),
        });

        if (collectedCandidates.length >= maxItems) {
          break;
        }
      }

      if (collectedCandidates.length >= maxItems) {
        stopReason = 'MAX_ITEMS_REACHED';
        hasMore = totalItems > collectedCandidates.length || page < totalPagesAvailable;
        break;
      }

      if (page === maxPages) {
        if (endIndex < totalItems) {
          stopReason = 'MAX_PAGES_REACHED';
          hasMore = true;
        } else {
          stopReason = 'ALL_PAGES_FETCHED';
          hasMore = false;
        }
        break;
      }

      if (endIndex >= totalItems) {
        stopReason = 'ALL_PAGES_FETCHED';
        hasMore = false;
        break;
      }
    }

    const diagnostics = createSourceDiagnostics({
      pagesRequested: maxPages,
      pagesCompleted: pagesRead,
      rawItemsCount: totalItems,
      parsedItemsCount: collectedCandidates.length,
      rejectedItemsCount: 0,
      stopReason,
      collectorId: 'synthetic-fixture',
    });

    return Promise.resolve(
      createSuccessSearchResult({
        sourceId: this.id,
        items: collectedCandidates,
        pagesRead,
        hasMore,
        diagnostics,
      }),
    );
  }

  public getDetails(
    reference: ListingReference,
    control: OperationControl,
  ): Promise<RawListingDetails> {
    const unusableError = this.checkUsable(control);
    if (unusableError) {
      return Promise.reject(unusableError);
    }

    const found = this._fixtures.find((f) => f.externalId === reference.externalId);
    if (!found) {
      return Promise.reject(
        new SourceAdapterError({
          code: 'PARSER_FAILED',
          message: `Listing with external ID '${reference.externalId}' not found in synthetic fixtures`,
          retryable: false,
          evidence: [`reference.externalId = ${reference.externalId}`],
        }),
      );
    }

    const fetchedAt = this._context?.clock.now() ?? new Date();

    return Promise.resolve({
      sourceId: this.id,
      externalId: found.externalId,
      canonicalUrl: found.canonicalUrl,
      title: found.title,
      description: found.description,
      rawPriceText: found.rawPriceText,
      sourceCurrencyCode: found.sourceCurrencyCode ?? null,
      rawLocationText: found.rawLocationText ?? null,
      rawConditionText: found.rawConditionText ?? null,
      rawAvailabilityText: found.rawAvailabilityText ?? null,
      imageUrls: deepCloneJson(found.imageUrls),
      sellerInfo: found.sellerInfo ? deepCloneJson(found.sellerInfo) : undefined,
      attributes: found.attributes
        ? deepCloneJson(found.attributes)
        : { condition: found.rawConditionText ?? 'used' },
      fetchedAt,
      sourceMetadata: deepCloneJson(found.sourceMetadata),
    });
  }

  public dispose(): Promise<void> {
    this._disposeCount++;
    this._disposed = true;
    this._context?.logger.info('adapter.disposed', { adapterId: this.id });
    return Promise.resolve();
  }

  private resolveMatchingFixtures(queries?: readonly string[]): readonly SyntheticListingFixture[] {
    if (!queries || queries.length === 0) {
      return this._fixtures;
    }

    const results: SyntheticListingFixture[] = [];

    for (const query of queries) {
      const q = query.trim().toLowerCase();
      if (!q) continue;

      const queryMatches = this._fixtures.filter((fixture) => {
        if (fixture.matchingQueries.some((mq) => mq.toLowerCase() === q)) {
          return true;
        }
        if (fixture.title.toLowerCase().includes(q)) {
          return true;
        }
        if (fixture.description.toLowerCase().includes(q)) {
          return true;
        }
        return false;
      });

      // Append matches preserving cross-query duplicates
      for (const item of queryMatches) {
        results.push(item);
      }
    }

    return results;
  }

  private checkUsable(control?: OperationControl): SourceAdapterError | null {
    if (this._disposed) {
      return new SourceAdapterError({
        code: 'CONFIGURATION_UNSUPPORTED',
        message: 'Cannot perform operation on disposed adapter',
        retryable: false,
      });
    }

    if (control && isAbortedOrExpired(control, this._context?.clock)) {
      return new SourceAdapterError({
        code: 'TIMEOUT',
        message: 'Operation aborted by signal or exceeded deadline',
        retryable: true,
        evidence: ['OperationControl signal aborted or deadline reached'],
      });
    }

    return null;
  }
}
