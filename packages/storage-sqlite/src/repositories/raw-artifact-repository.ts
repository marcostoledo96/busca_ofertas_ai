import {
  type RawArtifact,
  type RawArtifactReason,
  type RawArtifactRepository,
  createRawArtifact,
} from '@busca-ofertas-ai/core';
import type { SqliteDatabase } from '../database/types.js';
import {
  RawArtifactIdentityCollisionError,
  StorageCorruptionError,
} from '../errors/storage-errors.js';

interface RawArtifactRow {
  readonly id: string;
  readonly relative_path: string;
  readonly kind: string;
  readonly size_bytes: number;
  readonly fingerprint: string;
  readonly reason: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly run_id: string | null;
  readonly source_run_id: string | null;
  readonly content_type: string;
  readonly metadata: string | null;
}

const EXACT_CANONICAL_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function parseIsoDate(isoString: string, fieldName: string, entityId: string): Date {
  if (typeof isoString !== 'string' || !EXACT_CANONICAL_UTC_REGEX.test(isoString)) {
    throw new StorageCorruptionError(
      `Corrupted persisted RawArtifact '${entityId}': '${fieldName}' must be a canonical ISO UTC date string in 'YYYY-MM-DDTHH:mm:ss.sssZ' format, got '${String(isoString)}'`,
    );
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== isoString) {
    throw new StorageCorruptionError(
      `Corrupted persisted RawArtifact '${entityId}': '${fieldName}' is not a valid ISO date ('${isoString}')`,
    );
  }
  return date;
}

function rehydrateRawArtifact(row: RawArtifactRow): RawArtifact {
  const createdAt = parseIsoDate(row.created_at, 'created_at', row.id);
  const expiresAt = parseIsoDate(row.expires_at, 'expires_at', row.id);

  let metadata: Record<string, unknown> | null = null;
  if (row.metadata !== null && row.metadata !== undefined) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch (e) {
      throw new StorageCorruptionError(
        `Corrupted persisted RawArtifact '${row.id}': metadata JSON is invalid: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return createRawArtifact({
    id: row.id,
    relativePath: row.relative_path,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    fingerprint: row.fingerprint,
    reason: row.reason as RawArtifactReason,
    contentType: row.content_type,
    createdAt,
    expiresAt,
    runId: row.run_id,
    sourceRunId: row.source_run_id,
    metadata,
  });
}

export class SqliteRawArtifactRepository implements RawArtifactRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public async save(artifact: RawArtifact): Promise<void> {
    const existing = await this.getById(artifact.id);
    if (existing !== null) {
      throw new RawArtifactIdentityCollisionError(artifact.id);
    }

    const metadataJson = artifact.metadata ? JSON.stringify(artifact.metadata) : null;

    try {
      this.db
        .prepare(
          `
        INSERT INTO raw_artifacts (
          id, relative_path, kind, size_bytes, fingerprint, reason,
          created_at, expires_at, run_id, source_run_id, content_type, metadata
        ) VALUES (
          :id, :relative_path, :kind, :size_bytes, :fingerprint, :reason,
          :created_at, :expires_at, :run_id, :source_run_id, :content_type, :metadata
        )
      `,
        )
        .run({
          id: artifact.id,
          relative_path: artifact.relativePath,
          kind: artifact.kind,
          size_bytes: artifact.sizeBytes,
          fingerprint: artifact.fingerprint,
          reason: artifact.reason,
          created_at: artifact.createdAt.toISOString(),
          expires_at: artifact.expiresAt.toISOString(),
          run_id: artifact.runId ?? null,
          source_run_id: artifact.sourceRunId ?? null,
          content_type: artifact.contentType,
          metadata: metadataJson,
        });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('UNIQUE constraint failed: raw_artifacts.id') ||
          err.message.includes('PRIMARY KEY constraint failed'))
      ) {
        throw new RawArtifactIdentityCollisionError(artifact.id, undefined, { cause: err });
      }
      throw err;
    }
  }

  public getById(id: string): Promise<RawArtifact | null> {
    try {
      const row = this.db
        .prepare(
          `
        SELECT * FROM raw_artifacts WHERE id = :id LIMIT 1
      `,
        )
        .get({ id }) as RawArtifactRow | undefined;

      return Promise.resolve(row ? rehydrateRawArtifact(row) : null);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  public listByRunId(runId: string): Promise<readonly RawArtifact[]> {
    try {
      const rows = this.db
        .prepare(
          `
        SELECT * FROM raw_artifacts WHERE run_id = :run_id ORDER BY created_at ASC
      `,
        )
        .all({ run_id: runId }) as unknown as readonly RawArtifactRow[];

      return Promise.resolve(rows.map(rehydrateRawArtifact));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  public listBySourceRunId(sourceRunId: string): Promise<readonly RawArtifact[]> {
    try {
      const rows = this.db
        .prepare(
          `
        SELECT * FROM raw_artifacts WHERE source_run_id = :source_run_id ORDER BY created_at ASC
      `,
        )
        .all({ source_run_id: sourceRunId }) as unknown as readonly RawArtifactRow[];

      return Promise.resolve(rows.map(rehydrateRawArtifact));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  public listExpired(now: Date): Promise<readonly RawArtifact[]> {
    try {
      const nowIso = now.toISOString();
      const rows = this.db
        .prepare(
          `
        SELECT * FROM raw_artifacts WHERE expires_at <= :now_iso ORDER BY expires_at ASC
      `,
        )
        .all({ now_iso: nowIso }) as unknown as readonly RawArtifactRow[];

      return Promise.resolve(rows.map(rehydrateRawArtifact));
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  public deleteById(id: string): Promise<boolean> {
    try {
      const result = this.db
        .prepare(
          `
        DELETE FROM raw_artifacts WHERE id = :id
      `,
        )
        .run({ id });

      return Promise.resolve(result.changes > 0);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  public getTotalSizeBytesByRunId(runId: string): Promise<number> {
    try {
      const row = this.db
        .prepare(
          `
        SELECT coalesce(sum(size_bytes), 0) AS total_bytes
        FROM raw_artifacts
        WHERE run_id = :run_id
      `,
        )
        .get({ run_id: runId }) as { total_bytes: number } | undefined;

      return Promise.resolve(row ? Number(row.total_bytes) : 0);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }

  public getCountByRunId(runId: string): Promise<number> {
    try {
      const row = this.db
        .prepare(
          `
        SELECT count(*) AS total_count
        FROM raw_artifacts
        WHERE run_id = :run_id
      `,
        )
        .get({ run_id: runId }) as { total_count: number } | undefined;

      return Promise.resolve(row ? Number(row.total_count) : 0);
    } catch (err) {
      return Promise.reject(toError(err));
    }
  }
}
