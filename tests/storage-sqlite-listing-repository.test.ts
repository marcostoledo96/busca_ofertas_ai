import { describe, it, expect } from 'vitest';
import { createListing } from '@busca-ofertas-ai/core';
import {
  openSqliteDatabase,
  SqliteListingRepository,
  ListingIdentityCollisionError,
  StorageCorruptionError,
} from '@busca-ofertas-ai/storage-sqlite';
import {
  createTempDatabaseContext,
  withTempDatabase,
} from '@busca-ofertas-ai/storage-sqlite/testing';

describe('SqliteListingRepository (BOAI-011)', () => {
  const listing1 = createListing({
    id: 'listing-uuid-1',
    sourceId: 'fb-marketplace',
    externalId: 'ext-fb-123456',
    canonicalUrl: 'https://www.facebook.com/marketplace/item/123456',
    firstSeenAt: new Date('2026-08-30T10:00:00.000Z'),
    lastSeenAt: new Date('2026-08-30T12:00:00.000Z'),
  });

  const listing2 = createListing({
    id: 'listing-uuid-2',
    sourceId: 'mercadolibre',
    externalId: 'MLA-987654',
    canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-987654',
    firstSeenAt: new Date('2026-08-30T11:00:00.000Z'),
    lastSeenAt: new Date('2026-08-30T11:00:00.000Z'),
  });

  it('persists and retrieves listings by id and by natural key (sourceId, externalId) with full roundtrip', async () => {
    const ctx = createTempDatabaseContext();
    try {
      // 1. Save listings
      const db1 = openSqliteDatabase({ databasePath: ctx.databasePath });
      db1.migrate();
      const repo1 = new SqliteListingRepository(db1);

      await repo1.save(listing1);
      await repo1.save(listing2);
      db1.close();

      // 2. Reopen DB and query
      const db2 = openSqliteDatabase({ databasePath: ctx.databasePath });
      const repo2 = new SqliteListingRepository(db2);

      const byId1 = await repo2.getById(listing1.id);
      expect(byId1).not.toBeNull();
      expect(byId1).toEqual(listing1);

      const byNaturalKey1 = await repo2.getBySourceAndExternalId(
        listing1.sourceId,
        listing1.externalId,
      );
      expect(byNaturalKey1).not.toBeNull();
      expect(byNaturalKey1).toEqual(listing1);

      const byId2 = await repo2.getById(listing2.id);
      expect(byId2).not.toBeNull();
      expect(byId2).toEqual(listing2);

      const byNaturalKey2 = await repo2.getBySourceAndExternalId(
        listing2.sourceId,
        listing2.externalId,
      );
      expect(byNaturalKey2).not.toBeNull();
      expect(byNaturalKey2).toEqual(listing2);

      db2.close();
    } finally {
      ctx.cleanup();
    }
  });

  it('returns null when querying nonexistent listing', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteListingRepository(db);

      const byId = await repo.getById('nonexistent-id');
      expect(byId).toBeNull();

      const byNatural = await repo.getBySourceAndExternalId(
        'fb-marketplace',
        'nonexistent-external-id',
      );
      expect(byNatural).toBeNull();
    });
  });

  it('updates existing listing when saved with same id and natural key without duplicating records', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteListingRepository(db);

      await repo.save(listing1);

      // Update with new lastSeenAt and updated canonical URL
      const updatedListing = createListing({
        id: listing1.id,
        sourceId: listing1.sourceId,
        externalId: listing1.externalId,
        canonicalUrl:
          'https://www.facebook.com/marketplace/item/123456?referral_story_type=top_picks',
        firstSeenAt: listing1.firstSeenAt,
        lastSeenAt: new Date('2026-08-30T18:00:00.000Z'),
      });

      await repo.save(updatedListing);

      const retrieved = await repo.getById(listing1.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.lastSeenAt.toISOString()).toBe('2026-08-30T18:00:00.000Z');
      expect(retrieved!.canonicalUrl).toBe(
        'https://www.facebook.com/marketplace/item/123456?referral_story_type=top_picks',
      );

      // Verify table has exactly 1 row
      const countRow = db
        .prepare<{ total: number }, []>('SELECT COUNT(*) as total FROM listings')
        .get();
      expect(countRow?.total).toBe(1);
    });
  });

  it('rejects collision when saving listing with same (sourceId, externalId) but different internal ID with typed error', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();
      const repo = new SqliteListingRepository(db);

      await repo.save(listing1);

      // Attempt to save same natural key with a new conflicting UUID
      const conflictingListing = createListing({
        id: 'conflicting-new-uuid-999',
        sourceId: listing1.sourceId,
        externalId: listing1.externalId,
        canonicalUrl: listing1.canonicalUrl,
        firstSeenAt: new Date('2026-08-30T15:00:00.000Z'),
        lastSeenAt: new Date('2026-08-30T15:00:00.000Z'),
      });

      await expect(repo.save(conflictingListing)).rejects.toThrow(ListingIdentityCollisionError);

      try {
        await repo.save(conflictingListing);
      } catch (err) {
        expect(err).toBeInstanceOf(ListingIdentityCollisionError);
        if (err instanceof ListingIdentityCollisionError) {
          expect(err.code).toBe('LISTING_IDENTITY_COLLISION');
          expect(err.sourceId).toBe(listing1.sourceId);
          expect(err.externalId).toBe(listing1.externalId);
          expect(err.existingId).toBe(listing1.id);
          expect(err.attemptingId).toBe('conflicting-new-uuid-999');
        }
      }

      // Existing identity is preserved intact
      const preserved = await repo.getById(listing1.id);
      expect(preserved).not.toBeNull();
      expect(preserved!.id).toBe(listing1.id);
    });
  });

  it('enforces SQL CHECK constraints on Listing dates (last_seen_at >= first_seen_at)', () => {
    withTempDatabase((db) => {
      db.migrate();

      // Attempt to insert listing where lastSeenAt < firstSeenAt
      expect(() => {
        db.exec(`
          INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
          VALUES ('inconsistent-listing', 'fb', 'ext-1', 'https://fb.com/1', '2026-08-30T12:00:00.000Z', '2026-08-30T10:00:00.000Z');
        `);
      }).toThrow();
    });
  });

  it('fails closed when persisted Listing dates are invalid ISO strings', async () => {
    await withTempDatabase(async (db) => {
      db.migrate();

      db.exec(`
        INSERT INTO listings (id, source_id, external_id, canonical_url, first_seen_at, last_seen_at)
        VALUES ('corrupt-listing', 'fb', 'ext-1', 'https://fb.com/1', 'INVALID_DATE', 'INVALID_DATE');
      `);

      const repo = new SqliteListingRepository(db);
      await expect(repo.getById('corrupt-listing')).rejects.toThrow(StorageCorruptionError);
      await expect(repo.getBySourceAndExternalId('fb', 'ext-1')).rejects.toThrow(
        StorageCorruptionError,
      );
    });
  });
});
