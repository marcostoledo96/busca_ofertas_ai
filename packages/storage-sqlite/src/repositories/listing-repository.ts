import {
  type Listing,
  type ListingRepository,
  type CreateListingParams,
  createListing,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import { ListingIdentityCollisionError, StorageCorruptionError } from '../errors/storage-errors.js';

interface ListingRow {
  readonly id: string;
  readonly source_id: string;
  readonly external_id: string;
  readonly canonical_url: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

const EXACT_CANONICAL_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseIsoDate(isoString: string, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string' || !EXACT_CANONICAL_UTC_REGEX.test(isoString)) {
    throw new StorageCorruptionError(
      `Corrupted persisted Listing '${entityId}': '${fieldName}' must be a canonical ISO UTC date string in 'YYYY-MM-DDTHH:mm:ss.sssZ' format, got '${String(isoString)}'`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== isoString) {
    throw new StorageCorruptionError(
      `Corrupted persisted Listing '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function rehydrateListing(row: ListingRow): Listing {
  try {
    const firstSeenAt = parseIsoDate(row.first_seen_at, 'first_seen_at', row.id);
    const lastSeenAt = parseIsoDate(row.last_seen_at, 'last_seen_at', row.id);

    const params: CreateListingParams = {
      id: row.id,
      sourceId: row.source_id,
      externalId: row.external_id,
      canonicalUrl: row.canonical_url,
      firstSeenAt,
      lastSeenAt,
    };

    return createListing(params);
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      throw err;
    }
    throw new StorageCorruptionError(
      `Corrupted persisted Listing '${row.id}': domain rehydration failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export class SqliteListingRepository implements ListingRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): Promise<Listing | null> {
    try {
      const stmt = this.db.prepare<ListingRow, [string]>(
        `SELECT id, source_id, external_id, canonical_url, first_seen_at, last_seen_at
         FROM listings
         WHERE id = ?`,
      );
      const row = stmt.get(id);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateListing(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  getBySourceAndExternalId(sourceId: string, externalId: string): Promise<Listing | null> {
    try {
      const stmt = this.db.prepare<ListingRow, [string, string]>(
        `SELECT id, source_id, external_id, canonical_url, first_seen_at, last_seen_at
         FROM listings
         WHERE source_id = ? AND external_id = ?`,
      );
      const row = stmt.get(sourceId, externalId);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(rehydrateListing(row));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  save(listing: Listing): Promise<void> {
    try {
      const firstSeenAtIso = listing.firstSeenAt.toISOString();
      const lastSeenAtIso = listing.lastSeenAt.toISOString();

      this.db.transaction((tx) => {
        // 1. Check if a listing with (source_id, external_id) already exists
        const existingByNaturalKeyStmt = tx.prepare<
          {
            id: string;
            source_id: string;
            external_id: string;
            first_seen_at: string;
            last_seen_at: string;
          },
          [string, string]
        >(
          `SELECT id, source_id, external_id, first_seen_at, last_seen_at
           FROM listings
           WHERE source_id = ? AND external_id = ?`,
        );
        const existingByNaturalKey = existingByNaturalKeyStmt.get(
          listing.sourceId,
          listing.externalId,
        );

        if (existingByNaturalKey) {
          if (existingByNaturalKey.id !== listing.id) {
            throw new ListingIdentityCollisionError({
              sourceId: listing.sourceId,
              externalId: listing.externalId,
              existingId: existingByNaturalKey.id,
              attemptingId: listing.id,
            });
          }

          // Same identity -> update canonicalUrl, preserve earliest first_seen_at and latest last_seen_at (Finding C4)
          const existingFirstSeen = parseIsoDate(
            existingByNaturalKey.first_seen_at,
            'first_seen_at',
            existingByNaturalKey.id,
          );
          const existingLastSeen = parseIsoDate(
            existingByNaturalKey.last_seen_at,
            'last_seen_at',
            existingByNaturalKey.id,
          );

          const earliestFirstSeen =
            listing.firstSeenAt.getTime() < existingFirstSeen.getTime()
              ? listing.firstSeenAt
              : existingFirstSeen;

          const latestLastSeen =
            listing.lastSeenAt.getTime() > existingLastSeen.getTime()
              ? listing.lastSeenAt
              : existingLastSeen;

          const updateStmt = tx.prepare(
            `UPDATE listings
             SET canonical_url = ?, first_seen_at = ?, last_seen_at = ?
             WHERE id = ?`,
          );
          updateStmt.run(
            listing.canonicalUrl,
            earliestFirstSeen.toISOString(),
            latestLastSeen.toISOString(),
            listing.id,
          );
          return;
        }

        // 2. Check if the PK id already exists under different natural keys
        const existingByIdStmt = tx.prepare<
          { id: string; source_id: string; external_id: string },
          [string]
        >(
          `SELECT id, source_id, external_id
           FROM listings
           WHERE id = ?`,
        );
        const existingById = existingByIdStmt.get(listing.id);

        if (existingById) {
          throw new ListingIdentityCollisionError({
            sourceId: listing.sourceId,
            externalId: listing.externalId,
            existingId: existingById.id,
            attemptingId: listing.id,
          });
        }

        // 3. Insert new listing
        const insertStmt = tx.prepare(
          `INSERT INTO listings (
            id, source_id, external_id, canonical_url, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        insertStmt.run(
          listing.id,
          listing.sourceId,
          listing.externalId,
          listing.canonicalUrl,
          firstSeenAtIso,
          lastSeenAtIso,
        );
      });

      return Promise.resolve();
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
