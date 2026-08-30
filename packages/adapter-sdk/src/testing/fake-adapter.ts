import type { SourceHealth } from '@busca-ofertas-ai/core';
import type {
  AdapterContext,
  AuthenticationRequest,
  AuthenticationResult,
  HealthCheckRequest,
  ListingReference,
  OperationControl,
  RawListingCandidate,
  RawListingDetails,
  SourceAdapter,
  SourceCapabilities,
  SourceSearchRequest,
  SourceSearchResult,
} from '../index.js';
import {
  ADAPTER_SDK_VERSION,
  createSourceDiagnostics,
  createSuccessSearchResult,
  createZeroResultsConfirmedSearchResult,
  isAbortedOrExpired,
  SourceAdapterError,
} from '../index.js';

export interface InMemoryConformanceAdapterOptions {
  readonly id?: string | undefined;
  readonly version?: string | undefined;
  readonly sdkVersion?: string | undefined;
  readonly capabilities?: Partial<SourceCapabilities> | undefined;
  readonly defaultItems?: readonly RawListingCandidate[] | undefined;
  readonly simulateMode?:
    | 'SUCCESS'
    | 'ZERO_RESULTS'
    | 'FAIL_NETWORK'
    | 'FAIL_TIMEOUT'
    | 'FAIL_AUTH'
    | 'FAIL_RATE_LIMIT'
    | undefined;
}

/**
 * In-memory test double adapter implementing SourceAdapter.
 * Used for testing and verifying the reusable contract test suite without live network or external dependencies.
 */
export class InMemoryConformanceAdapter implements SourceAdapter {
  readonly id: string;
  readonly version: string;
  readonly sdkVersion: string;
  readonly capabilities: SourceCapabilities;

  private _initialized = false;
  private _disposed = false;
  private _initCount = 0;
  private _disposeCount = 0;
  private _context?: AdapterContext | undefined;
  private _simulateMode:
    'SUCCESS' | 'ZERO_RESULTS' | 'FAIL_NETWORK' | 'FAIL_TIMEOUT' | 'FAIL_AUTH' | 'FAIL_RATE_LIMIT';
  private _items: readonly RawListingCandidate[];

  constructor(options: InMemoryConformanceAdapterOptions = {}) {
    this.id = options.id ?? 'conformance-fake-adapter';
    this.version = options.version ?? '1.0.0';
    this.sdkVersion = options.sdkVersion ?? ADAPTER_SDK_VERSION;
    this.capabilities = {
      textSearch: true,
      exactUrlWatch: true,
      listingDetails: true,
      authentication: true,
      pagination: true,
      geographicSearch: true,
      priceAndCurrency: true,
      stock: true,
      advertisedDiscount: true,
      ...options.capabilities,
    };
    this._simulateMode = options.simulateMode ?? 'SUCCESS';
    this._items = options.defaultItems ?? [
      {
        sourceId: this.id,
        externalId: 'ext-1001',
        canonicalUrl: 'https://example.com/listings/1001',
        title: 'Nintendo Switch Lite Coral',
        description: 'Excellent condition with original charger and box.',
        rawPriceText: '$180.00',
        sourceCurrencyCode: 'USD',
        rawLocationText: 'Capital Federal',
        rawConditionText: 'Used - Like New',
        rawAvailabilityText: 'In Stock',
        imageUrls: ['https://example.com/images/1001.jpg'],
        observedAt: new Date('2026-08-30T12:00:00Z'),
        sourceMetadata: { category: 'consoles' },
      },
      {
        sourceId: this.id,
        externalId: 'ext-1002',
        canonicalUrl: 'https://example.com/listings/1002',
        title: 'Nintendo Switch Lite Gray',
        description: 'Console only, minor scratches.',
        rawPriceText: '$150.00',
        sourceCurrencyCode: 'USD',
        rawLocationText: 'Buenos Aires',
        rawConditionText: 'Used - Good',
        rawAvailabilityText: 'In Stock',
        imageUrls: ['https://example.com/images/1002.jpg'],
        observedAt: new Date('2026-08-30T12:05:00Z'),
        sourceMetadata: { category: 'consoles' },
      },
    ];
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

  setSimulateMode(
    mode:
      | 'SUCCESS'
      | 'ZERO_RESULTS'
      | 'FAIL_NETWORK'
      | 'FAIL_TIMEOUT'
      | 'FAIL_AUTH'
      | 'FAIL_RATE_LIMIT',
  ): void {
    this._simulateMode = mode;
  }

  setItems(items: readonly RawListingCandidate[]): void {
    this._items = items;
  }

  initialize(context: AdapterContext): Promise<void> {
    this._initCount++;
    this._initialized = true;
    this._context = context;
    context.logger.info('adapter.initialized', { adapterId: this.id });
    return Promise.resolve();
  }

  healthCheck(request: HealthCheckRequest): Promise<SourceHealth> {
    const error = this.checkUsable(request.control);
    if (error) {
      return Promise.reject(error);
    }

    if (this._simulateMode === 'FAIL_NETWORK' || this._simulateMode === 'FAIL_TIMEOUT') {
      return Promise.resolve({
        sourceId: this.id,
        status: 'UNAVAILABLE',
        checkedAt: this._context?.clock.now() ?? new Date(),
        evidence: ['Endpoint unreachable during health check simulation'],
      });
    }

    if (this._simulateMode === 'FAIL_AUTH') {
      return Promise.resolve({
        sourceId: this.id,
        status: 'AUTH_REQUIRED',
        checkedAt: this._context?.clock.now() ?? new Date(),
        evidence: ['Authentication session expired'],
      });
    }

    return Promise.resolve({
      sourceId: this.id,
      status: 'HEALTHY',
      checkedAt: this._context?.clock.now() ?? new Date(),
      evidence: ['Source endpoint reachable and healthy'],
    });
  }

  search(request: SourceSearchRequest): Promise<SourceSearchResult> {
    const error = this.checkUsable(request.control);
    if (error) {
      return Promise.reject(error);
    }

    if (this._simulateMode === 'FAIL_NETWORK') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'NETWORK_ERROR',
          message: 'Network connection failed during search',
          retryable: true,
          evidence: ['DNS lookup timeout', 'GET /search status 503'],
        }),
      );
    }

    if (this._simulateMode === 'FAIL_TIMEOUT') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'TIMEOUT',
          message: 'Search query exceeded configured deadline',
          retryable: true,
          evidence: ['Deadline expired after 5000ms'],
        }),
      );
    }

    if (this._simulateMode === 'FAIL_AUTH') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication session expired',
          retryable: false,
          evidence: ['HTTP 401 Unauthorized'],
        }),
      );
    }

    if (this._simulateMode === 'FAIL_RATE_LIMIT') {
      return Promise.reject(
        new SourceAdapterError({
          code: 'RATE_LIMITED',
          message: 'Too many requests; rate limit triggered',
          retryable: true,
          evidence: ['HTTP 429 Too Many Requests'],
        }),
      );
    }

    if (this._simulateMode === 'ZERO_RESULTS' || this._items.length === 0) {
      const diagnostics = createSourceDiagnostics({
        pagesRequested: 1,
        pagesCompleted: 1,
        rawItemsCount: 0,
        parsedItemsCount: 0,
        rejectedItemsCount: 0,
        stopReason: 'NO_MORE_RESULTS',
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

    // Apply pagination limits
    const maxItems = request.pagination.maxItems;
    const slicedItems = this._items.slice(0, maxItems);
    const hasMore = this._items.length > maxItems;

    const diagnostics = createSourceDiagnostics({
      pagesRequested: request.pagination.maxPages,
      pagesCompleted: 1,
      rawItemsCount: this._items.length,
      parsedItemsCount: slicedItems.length,
      rejectedItemsCount: 0,
      stopReason: hasMore ? 'MAX_ITEMS_REACHED' : 'ALL_PAGES_FETCHED',
      collectorId: 'in-memory-fixture',
    });

    return Promise.resolve(
      createSuccessSearchResult({
        sourceId: this.id,
        items: slicedItems,
        pagesRead: 1,
        hasMore,
        diagnostics,
      }),
    );
  }

  getDetails(reference: ListingReference, control: OperationControl): Promise<RawListingDetails> {
    const error = this.checkUsable(control);
    if (error) {
      return Promise.reject(error);
    }

    const found = this._items.find((i) => i.externalId === reference.externalId);
    if (!found) {
      return Promise.reject(
        new SourceAdapterError({
          code: 'PARSER_FAILED',
          message: `Listing with external ID '${reference.externalId}' not found in fixture`,
          retryable: false,
        }),
      );
    }

    return Promise.resolve({
      sourceId: this.id,
      externalId: found.externalId,
      canonicalUrl: found.canonicalUrl,
      title: found.title,
      description: found.description,
      rawPriceText: found.rawPriceText,
      sourceCurrencyCode: found.sourceCurrencyCode,
      rawLocationText: found.rawLocationText,
      rawConditionText: found.rawConditionText,
      rawAvailabilityText: found.rawAvailabilityText,
      imageUrls: found.imageUrls,
      attributes: { condition: 'good' },
      fetchedAt: this._context?.clock.now() ?? new Date(),
      sourceMetadata: found.sourceMetadata,
    });
  }

  authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
    const error = this.checkUsable(request.control);
    if (error) {
      return Promise.reject(error);
    }

    if (this._simulateMode === 'FAIL_AUTH') {
      return Promise.resolve({
        status: 'AUTHENTICATION_REQUIRED',
        reason: 'Credentials rejected by fake provider',
        loginUrl: 'https://example.com/login',
      });
    }

    return Promise.resolve({
      status: 'AUTHENTICATED',
      sessionExpiresAt: new Date(Date.now() + 3600_000),
      metadata: { userId: 'fake-user-123' },
    });
  }

  dispose(): Promise<void> {
    this._disposeCount++;
    this._disposed = true;
    this._context?.logger.info('adapter.disposed', { adapterId: this.id });
    return Promise.resolve();
  }

  private checkUsable(control: OperationControl): SourceAdapterError | null {
    if (this._disposed) {
      return new SourceAdapterError({
        code: 'CONFIGURATION_UNSUPPORTED',
        message: 'Cannot perform operation on disposed adapter',
        retryable: false,
      });
    }

    if (isAbortedOrExpired(control, this._context?.clock)) {
      return new SourceAdapterError({
        code: 'TIMEOUT',
        message: 'Operation aborted by signal or exceeded deadline',
        retryable: false,
        evidence: ['OperationControl signal aborted or deadline reached'],
      });
    }

    return null;
  }
}
