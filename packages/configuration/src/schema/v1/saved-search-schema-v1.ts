import { z } from 'zod';
import { detectForbiddenSecrets } from '../../security/secret-detector.js';

export const MAX_PAGES_LIMIT = 100;
export const MAX_ITEMS_LIMIT = 10000;

const kebabCaseRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const searchCategorySchema = z.enum(['PRODUCT', 'REAL_ESTATE', 'VEHICLE'], {
  errorMap: () => ({
    message: 'category must be one of: PRODUCT, REAL_ESTATE, VEHICLE.',
  }),
});

const listingConditionSchema = z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'FOR_PARTS', 'UNKNOWN'], {
  errorMap: () => ({
    message:
      'condition accepted values must be from: NEW, LIKE_NEW, GOOD, FAIR, FOR_PARTS, UNKNOWN.',
  }),
});

const priceCurrencySchema = z.enum(['ARS', 'USD', 'UNKNOWN'], {
  errorMap: () => ({
    message: 'targetCurrency must be one of: ARS, USD, UNKNOWN.',
  }),
});

const foreignCurrencyPolicySchema = z
  .object({
    mode: z.enum(['MANUAL_RATE', 'IGNORE', 'STRICT'], {
      errorMap: () => ({
        message: 'foreignCurrency.mode must be MANUAL_RATE, IGNORE, or STRICT.',
      }),
    }),
    onUnknown: z.enum(['REVIEW', 'REJECT'], {
      errorMap: () => ({
        message: 'foreignCurrency.onUnknown must be REVIEW or REJECT.',
      }),
    }),
  })
  .strict();

const priceSchema = z
  .object({
    targetCurrency: priceCurrencySchema,
    maximum: z.number().positive('price.maximum must be a positive number.').nullable().optional(),
    minimumPlausible: z
      .number()
      .positive('price.minimumPlausible must be a positive number.')
      .nullable()
      .optional(),
    foreignCurrency: foreignCurrencyPolicySchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      typeof val.maximum === 'number' &&
      typeof val.minimumPlausible === 'number' &&
      val.maximum < val.minimumPlausible
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximum'],
        message: `price.maximum (${val.maximum}) cannot be less than price.minimumPlausible (${val.minimumPlausible}).`,
        params: {
          suggestion: 'Ensure price.maximum is greater than or equal to price.minimumPlausible.',
        },
      });
    }
  });

const locationSchema = z
  .object({
    mode: z.enum(['REGION', 'RADIUS', 'CUSTOM'], {
      errorMap: () => ({
        message: 'location.mode must be REGION, RADIUS, or CUSTOM.',
      }),
    }),
    region: z.string().min(1, 'location.region cannot be empty.').optional(),
    radiusKm: z.number().positive('location.radiusKm must be a positive number.').optional(),
    coordinates: z
      .object({
        latitude: z.number().min(-90).max(90, 'latitude must be between -90 and 90.'),
        longitude: z.number().min(-180).max(180, 'longitude must be between -180 and 180.'),
      })
      .strict()
      .optional(),
  })
  .strict();

const conditionSchema = z
  .object({
    accepted: z
      .array(listingConditionSchema)
      .min(1, 'condition.accepted must contain at least one condition.'),
  })
  .strict();

const sourceOptionsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .superRefine((options, ctx) => {
    if (!options) return;
    const maxPages = options['maxPages'];
    if (maxPages !== undefined) {
      if (
        typeof maxPages !== 'number' ||
        !Number.isInteger(maxPages) ||
        maxPages <= 0 ||
        maxPages > MAX_PAGES_LIMIT
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPages'],
          message: `options.maxPages must be an integer between 1 and ${MAX_PAGES_LIMIT}.`,
          params: {
            suggestion: `Set maxPages to a positive integer <= ${MAX_PAGES_LIMIT}.`,
          },
        });
      }
    }
    const maxItems = options['maxItems'];
    if (maxItems !== undefined) {
      if (
        typeof maxItems !== 'number' ||
        !Number.isInteger(maxItems) ||
        maxItems <= 0 ||
        maxItems > MAX_ITEMS_LIMIT
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxItems'],
          message: `options.maxItems must be an integer between 1 and ${MAX_ITEMS_LIMIT}.`,
          params: {
            suggestion: `Set maxItems to a positive integer <= ${MAX_ITEMS_LIMIT}.`,
          },
        });
      }
    }
  });

const sourceSchema = z
  .object({
    id: z.string().min(1, 'source.id cannot be empty.'),
    enabled: z.boolean(),
    queries: z.array(z.string().min(1, 'Query terms cannot be empty strings.')),
    options: sourceOptionsSchema,
    sessionRef: z.string().min(1, 'sessionRef cannot be empty string.').optional(),
  })
  .strict();

const productSchema = z
  .object({
    expectedModels: z.array(z.string().min(1)).optional(),
    requireFunctional: z.boolean().optional(),
    chargerRequired: z.boolean().optional(),
    boxRequired: z.boolean().optional(),
  })
  .strict();

const rulesSchema = z
  .object({
    profile: z.string().min(1).optional(),
    include: z.array(z.string().min(1)).optional(),
    exclude: z.array(z.string().min(1)).optional(),
  })
  .strict();

const evaluationSchema = z
  .object({
    matchThreshold: z
      .number()
      .min(0, 'matchThreshold must be >= 0.')
      .max(100, 'matchThreshold must be <= 100.'),
    reviewThreshold: z
      .number()
      .min(0, 'reviewThreshold must be >= 0.')
      .max(100, 'reviewThreshold must be <= 100.'),
    precisionProfile: z.enum(['STRICT', 'BALANCED', 'PERMISSIVE', 'MIXED']).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.matchThreshold <= val.reviewThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['matchThreshold'],
        message: `evaluation.matchThreshold (${val.matchThreshold}) must be strictly greater than evaluation.reviewThreshold (${val.reviewThreshold}).`,
        params: {
          suggestion: 'Ensure matchThreshold is greater than reviewThreshold.',
        },
      });
    }
  });

const aiSchema = z
  .object({
    enabled: z.boolean(),
    evaluateOnlyReview: z.boolean(),
    provider: z.string().min(1).optional(),
    requireConfirmation: z.boolean(),
    maxEvaluationsPerRun: z
      .number()
      .int('maxEvaluationsPerRun must be an integer.')
      .positive('maxEvaluationsPerRun must be positive.'),
  })
  .strict();

const retentionSchema = z
  .object({
    rawArtifacts: z.enum(['NONE', 'ERRORS_ONLY', 'ERRORS_AND_REVIEW', 'ALL_LIMITED', 'ALL'], {
      errorMap: () => ({
        message:
          'retention.rawArtifacts must be NONE, ERRORS_ONLY, ERRORS_AND_REVIEW, ALL_LIMITED, or ALL.',
      }),
    }),
    rawDataDays: z
      .number()
      .int('rawDataDays must be an integer.')
      .positive('rawDataDays must be a positive integer.'),
  })
  .strict();

const reportSchema = z
  .object({
    openAutomatically: z.boolean().optional(),
    includeRejected: z.enum(['COLLAPSED', 'EXPANDED', 'OMITTED']).optional(),
    exports: z.array(z.enum(['HTML', 'JSON', 'CSV'])).optional(),
  })
  .strict();

export const savedSearchSchemaV1 = z
  .object({
    schemaVersion: z.literal(1, {
      errorMap: () => ({
        message: 'schemaVersion must be 1 for v1 schema.',
      }),
    }),
    id: z
      .string()
      .min(1, 'id cannot be empty.')
      .regex(kebabCaseRegex, 'id must be non-empty kebab-case (e.g. switch-lite-amba).'),
    name: z.string().min(1, 'name cannot be empty.'),
    enabled: z.boolean(),
    category: searchCategorySchema,
    sources: z
      .array(sourceSchema)
      .min(1, 'sources must contain at least one source configuration.'),
    location: locationSchema.nullable().optional(),
    price: priceSchema.nullable().optional(),
    condition: conditionSchema.nullable().optional(),
    product: productSchema.optional(),
    rules: rulesSchema.optional(),
    evaluation: evaluationSchema,
    ai: aiSchema,
    retention: retentionSchema,
    report: reportSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Check at least one enabled source
    const hasEnabledSource = data.sources.some((s) => s.enabled);
    if (!hasEnabledSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'At least one source must be enabled in SavedSearch.',
        params: {
          suggestion: 'Set enabled: true on at least one source entry.',
        },
      });
    }

    // Check unique source IDs
    const seenSourceIds = new Set<string>();
    for (let i = 0; i < data.sources.length; i++) {
      const source = data.sources[i];
      if (source && seenSourceIds.has(source.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sources', i, 'id'],
          message: `Duplicate source ID "${source.id}" found in sources configuration.`,
          params: {
            suggestion: 'Each source configuration in a SavedSearch must have a unique source ID.',
          },
        });
      } else if (source) {
        seenSourceIds.add(source.id);
      }
    }

    // Run recursive secret scanning
    const secretViolations = detectForbiddenSecrets(data);
    for (const violation of secretViolations) {
      const pathParts = violation.path.split('.').flatMap((p) => {
        const arrayMatch = p.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch && arrayMatch[1] && arrayMatch[2]) {
          return [arrayMatch[1], Number.parseInt(arrayMatch[2], 10)];
        }
        return [p];
      });

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: pathParts,
        message: `Inline secret is forbidden at ${violation.path}. Use sessionRef or SecretProvider.`,
        params: {
          code: 'CONFIG_SECRET_FORBIDDEN',
          suggestion: `Remove inline secret key "${violation.key}" and reference credentials via sessionRef or SecretProvider.`,
        },
      });
    }
  });

export type SavedSearchSchemaV1Type = z.infer<typeof savedSearchSchemaV1>;
