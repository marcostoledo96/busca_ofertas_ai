import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SourceRegistry } from '@busca-ofertas-ai/configuration';
import {
  FakeTerminal,
  InMemorySavedSearchConfigStore,
  InMemoryTextFileAdapter,
  ConfigurationSubmenu,
  createCliApplication,
} from '@busca-ofertas-ai/cli';
import {
  RawArtifactService,
  createRawArtifact,
  type RawArtifactRepository,
  type ArtifactFileSystemPort,
  type RawArtifact,
} from '@busca-ofertas-ai/core';
import {
  createSqliteArtifactSanitizer,
  createNodeCryptoHasher,
} from '@busca-ofertas-ai/storage-sqlite';

class MockArtifactFileSystem implements ArtifactFileSystemPort {
  public files = new Map<string, Uint8Array>();

  writeSanitizedFile(path: string, bytes: Uint8Array): Promise<{ sizeBytes: number }> {
    this.files.set(path, bytes);
    return Promise.resolve({ sizeBytes: bytes.length });
  }
  readSanitizedFile(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  deleteFile(path: string): Promise<boolean> {
    return Promise.resolve(this.files.delete(path));
  }
  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }
}

class MockRawArtifactRepository implements RawArtifactRepository {
  public artifacts = new Map<string, RawArtifact>();

  save(artifact: RawArtifact): Promise<void> {
    this.artifacts.set(artifact.id, artifact);
    return Promise.resolve();
  }
  getById(id: string): Promise<RawArtifact | null> {
    return Promise.resolve(this.artifacts.get(id) ?? null);
  }
  listByRunId(runId: string): Promise<readonly RawArtifact[]> {
    return Promise.resolve(Array.from(this.artifacts.values()).filter((a) => a.runId === runId));
  }
  listBySourceRunId(sourceRunId: string): Promise<readonly RawArtifact[]> {
    return Promise.resolve(
      Array.from(this.artifacts.values()).filter((a) => a.sourceRunId === sourceRunId),
    );
  }
  listExpired(now: Date): Promise<readonly RawArtifact[]> {
    return Promise.resolve(
      Array.from(this.artifacts.values()).filter((a) => a.expiresAt.getTime() <= now.getTime()),
    );
  }
  deleteById(id: string): Promise<boolean> {
    return Promise.resolve(this.artifacts.delete(id));
  }
  async getTotalSizeBytesByRunId(runId: string): Promise<number> {
    return (await this.listByRunId(runId)).reduce((sum, a) => sum + a.sizeBytes, 0);
  }
  async getCountByRunId(runId: string): Promise<number> {
    return (await this.listByRunId(runId)).length;
  }
}

describe('CLI Manual and Startup Raw Artifact Cleanup (BOAI-016)', () => {
  let terminal: FakeTerminal;
  let registry: SourceRegistry;
  let store: InMemorySavedSearchConfigStore;
  let textPort: InMemoryTextFileAdapter;
  let abortController: AbortController;
  let fsPort: MockArtifactFileSystem;
  let repo: MockRawArtifactRepository;
  let rawArtifactService: RawArtifactService;

  const fixedNow = new Date('2026-09-03T12:00:00.000Z');

  beforeEach(() => {
    terminal = new FakeTerminal();
    registry = new SourceRegistry();
    store = new InMemorySavedSearchConfigStore('/test/searches');
    textPort = new InMemoryTextFileAdapter();
    abortController = new AbortController();
    fsPort = new MockArtifactFileSystem();
    repo = new MockRawArtifactRepository();

    rawArtifactService = new RawArtifactService({
      storagePort: fsPort,
      repository: repo,
      sanitizer: createSqliteArtifactSanitizer(),
      hasher: createNodeCryptoHasher(),
      clock: { now: () => fixedNow },
      idGenerator: { generate: () => 'id-1' },
    });
  });

  describe('ConfigurationSubmenu Manual Cleanup ("Limpiar artifacts vencidos")', () => {
    it('notifies when no expired artifacts exist and does zero prompt or deletion', async () => {
      // Option 4: Limpiar artifacts vencidos, then Option 5: Volver
      terminal.enqueueInput('4', '5');

      const submenu = new ConfigurationSubmenu({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
        rawArtifactService,
      });

      await submenu.run();

      const output = terminal.getRawOutput();
      expect(output).toContain('Limpiar artifacts vencidos');
      expect(output).toContain('No se encontraron artifacts vencidos para limpiar.');
    });

    it('displays count and size, and cancels deletion when user responds NO', async () => {
      // Seed 2 expired artifacts
      const art1 = createRawArtifact({
        id: 'art-exp-1',
        relativePath: '2026-07/art_exp1.txt',
        kind: 'LOG',
        sizeBytes: 1500,
        fingerprint: 'fp-1',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        expiresAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      const art2 = createRawArtifact({
        id: 'art-exp-2',
        relativePath: '2026-07/art_exp2.txt',
        kind: 'LOG',
        sizeBytes: 2500,
        fingerprint: 'fp-2',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        expiresAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      await repo.save(art1);
      await repo.save(art2);
      fsPort.files.set(art1.relativePath, new Uint8Array(1500));
      fsPort.files.set(art2.relativePath, new Uint8Array(2500));

      // User selects: 4 (cleanup), 'n' (cancel confirmation), 5 (back)
      terminal.enqueueInput('4', 'n', '5');

      const submenu = new ConfigurationSubmenu({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
        rawArtifactService,
      });

      await submenu.run();

      const output = terminal.getRawOutput();
      expect(output).toContain('Se encontraron 2 artifacts vencidos');
      expect(output).toContain('Operación cancelada. No se eliminó ningún artifact.');

      // Verify 0 artifacts were deleted
      expect(repo.artifacts.size).toBe(2);
      expect(fsPort.files.size).toBe(2);
    });

    it('confirms and executes cleanup, reporting sanitized summary', async () => {
      // Seed 1 expired on disk, 1 expired already missing on disk
      const art1 = createRawArtifact({
        id: 'art-exp-1',
        relativePath: '2026-07/art_exp1.txt',
        kind: 'LOG',
        sizeBytes: 1024,
        fingerprint: 'fp-1',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        expiresAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      const art2 = createRawArtifact({
        id: 'art-exp-2',
        relativePath: '2026-07/art_exp2.txt',
        kind: 'LOG',
        sizeBytes: 2048,
        fingerprint: 'fp-2',
        reason: 'ERROR',
        contentType: 'text/plain',
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
        expiresAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      await repo.save(art1);
      await repo.save(art2);
      fsPort.files.set(art1.relativePath, new Uint8Array(1024)); // art2 file omitted on disk

      // User selects: 4 (cleanup), 's' (confirm), 5 (back)
      terminal.enqueueInput('4', 's', '5');

      const submenu = new ConfigurationSubmenu({
        terminal,
        signal: abortController.signal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
        rawArtifactService,
      });

      await submenu.run();

      const output = terminal.getRawOutput();
      expect(output).toContain('Resumen de limpieza:');
      expect(output).toContain('Encontrados:   2');
      expect(output).toContain('Eliminados:    1');
      expect(output).toContain('Ya ausentes:   1');
      expect(output).toContain('Fallidos:      0');

      // Verify metadata was purged for both and file was removed
      expect(repo.artifacts.size).toBe(0);
      expect(fsPort.files.size).toBe(0);
    });
  });

  describe('Startup Cleanup Behavior in CliApplication', () => {
    it('does NOT run cleanup on startup by default (cleanupOnStartup: false)', async () => {
      const cleanupSpy = vi.spyOn(rawArtifactService, 'cleanupExpiredArtifacts');

      const app = createCliApplication({
        terminal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
        rawArtifactService,
        // cleanupOnStartup defaults to false or omitted
      });

      // Exit immediately via option 8
      terminal.enqueueInput('8');
      await app.run();

      expect(cleanupSpy).not.toHaveBeenCalled();
    });

    it('runs cleanup on startup when cleanupOnStartup: true is configured', async () => {
      const cleanupSpy = vi.spyOn(rawArtifactService, 'cleanupExpiredArtifacts');

      const app = createCliApplication({
        terminal,
        sourceRegistry: registry,
        configStore: store,
        textFilePort: textPort,
        rawArtifactService,
        cleanupOnStartup: true,
      });

      // Exit immediately via option 8
      terminal.enqueueInput('8');
      await app.run();

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
  });
});
