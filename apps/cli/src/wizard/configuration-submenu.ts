import {
  parseSavedSearchYaml,
  validateSavedSearchConfiguration,
  validateSearchCapabilities,
  serializeSavedSearchYaml,
  exportSavedSearchYaml,
  isConfigurationError,
  type SourceRegistry,
  type SavedSearchConfigurationV1,
} from '@busca-ofertas-ai/configuration';
import type { RawArtifactService } from '@busca-ofertas-ai/core';
import type { TerminalPort } from '../runtime/terminal.js';
import type { SavedSearchConfigStore } from '../storage/saved-search-store.js';
import type { TextFilePort } from '../storage/text-file-port.js';
import { sanitizeString } from '../runtime/diagnostics.js';
import { isCliError } from '../runtime/errors.js';
import { WizardPrompter, type ChoiceItem } from './wizard-prompter.js';
import { formatSearchSummary } from './summary-formatter.js';

export interface ConfigurationSubmenuOptions {
  readonly terminal: TerminalPort;
  readonly signal: AbortSignal;
  readonly sourceRegistry: SourceRegistry;
  readonly configStore: SavedSearchConfigStore;
  readonly textFilePort: TextFilePort;
  readonly rawArtifactService?: RawArtifactService | undefined;
}

export class ConfigurationSubmenu {
  private readonly terminal: TerminalPort;
  private readonly signal: AbortSignal;
  private readonly sourceRegistry: SourceRegistry;
  private readonly configStore: SavedSearchConfigStore;
  private readonly textFilePort: TextFilePort;
  private readonly rawArtifactService?: RawArtifactService | undefined;
  private readonly prompter: WizardPrompter;

  constructor(options: ConfigurationSubmenuOptions) {
    this.terminal = options.terminal;
    this.signal = options.signal;
    this.sourceRegistry = options.sourceRegistry;
    this.configStore = options.configStore;
    this.textFilePort = options.textFilePort;
    this.rawArtifactService = options.rawArtifactService;
    this.prompter = new WizardPrompter(options.terminal, options.signal);
  }

  public async run(): Promise<void> {
    let inSubmenu = true;

    while (inSubmenu && !this.signal.aborted) {
      this.terminal.writeLine('\n============================================================');
      this.terminal.writeLine('                CONFIGURACIÓN DE BÚSQUEDAS                  ');
      this.terminal.writeLine('============================================================');

      const menuChoices: Array<ChoiceItem<string>> = [
        { label: 'Importar búsqueda desde archivo YAML', value: 'import' },
        { label: 'Exportar búsqueda a archivo YAML', value: 'export' },
        { label: 'Eliminar una búsqueda', value: 'delete' },
        ...(this.rawArtifactService
          ? [{ label: 'Limpiar artifacts vencidos', value: 'cleanup-artifacts' }]
          : []),
        { label: 'Volver al menú principal', value: 'back' },
      ];

      const selection = await this.prompter.promptChoice(
        'Seleccioná una opción de configuración:',
        menuChoices,
        0,
      );

      switch (selection) {
        case 'import':
          await this.handleImport();
          break;
        case 'export':
          await this.handleExport();
          break;
        case 'delete':
          await this.handleDelete();
          break;
        case 'cleanup-artifacts':
          await this.handleCleanupArtifacts();
          break;
        case 'back':
          inSubmenu = false;
          break;
      }
    }
  }

  private async handleImport(): Promise<void> {
    this.terminal.writeLine('\n--- Importar Búsqueda desde YAML ---');
    const sourceFilePath = await this.prompter.promptText('Ruta del archivo YAML a importar');

    let fileContent: string;
    try {
      fileContent = await this.textFilePort.readTextFile(sourceFilePath, { signal: this.signal });
    } catch (readErr) {
      if (isCliError(readErr)) {
        this.terminal.writeLine(`\n[!] [${readErr.code}] ${sanitizeString(readErr.userMessage)}`);
        if (readErr.suggestedAction) {
          this.terminal.writeLine(
            `    Acción sugerida: ${sanitizeString(readErr.suggestedAction)}`,
          );
        }
      } else {
        this.terminal.writeLine(
          `\n[!] Error al leer el archivo: ${sanitizeString(readErr instanceof Error ? readErr.message : String(readErr))}`,
        );
      }
      return;
    }

    let parsedConfig: SavedSearchConfigurationV1;
    try {
      parsedConfig = parseSavedSearchYaml(fileContent);
      validateSavedSearchConfiguration(parsedConfig);
      validateSearchCapabilities(parsedConfig, this.sourceRegistry);
    } catch (parseErr) {
      this.terminal.writeLine('\n[!] Error al validar el archivo YAML importado:');
      if (isConfigurationError(parseErr)) {
        this.terminal.writeLine(
          `    [${parseErr.code}] ${parseErr.path ? `${parseErr.path}: ` : ''}${sanitizeString(parseErr.message)}`,
        );
        if (parseErr.suggestion) {
          this.terminal.writeLine(`    Acción sugerida: ${sanitizeString(parseErr.suggestion)}`);
        }
        for (const issue of parseErr.issues) {
          this.terminal.writeLine(`    - ${issue.path}: ${sanitizeString(issue.message)}`);
        }
      } else {
        this.terminal.writeLine(
          `    ${sanitizeString(parseErr instanceof Error ? parseErr.message : String(parseErr))}`,
        );
      }
      this.terminal.writeLine('Importación abortada. No se guardaron datos.\n');
      return;
    }

    this.terminal.writeLine('\nResumen de la configuración a importar:');
    this.terminal.writeLine(formatSearchSummary(parsedConfig));

    const targetDestination = this.configStore.resolvePath(parsedConfig.id);
    this.terminal.writeLine(`Destino gestionado: ${sanitizeString(targetDestination)}\n`);

    const alreadyExists = await this.configStore.exists(parsedConfig.id);
    let overwrite = false;
    if (alreadyExists) {
      const confirmOverwrite = await this.prompter.promptBoolean(
        `Ya existe una búsqueda con ID "${sanitizeString(parsedConfig.id)}". ¿Deseás sobrescribirla?`,
        false,
      );
      if (!confirmOverwrite) {
        this.terminal.writeLine(
          '\nImportación cancelada por el usuario. El archivo preexistente no fue modificado.',
        );
        return;
      }
      overwrite = true;
    }

    const confirmImport = await this.prompter.promptBoolean(
      '¿Confirmás la importación de esta búsqueda?',
      true,
    );
    if (!confirmImport) {
      this.terminal.writeLine('\nImportación cancelada.');
      return;
    }

    const serialized = serializeSavedSearchYaml(parsedConfig);
    await this.configStore.write(parsedConfig.id, serialized, {
      overwrite,
      signal: this.signal,
    });

    this.terminal.writeLine(
      `\n✓ ¡Búsqueda "${sanitizeString(parsedConfig.id)}" importada y guardada exitosamente!`,
    );
  }

  private async handleExport(): Promise<void> {
    this.terminal.writeLine('\n--- Exportar Búsqueda a YAML ---');
    const searchIds = await this.configStore.list();
    if (searchIds.length === 0) {
      this.terminal.writeLine('\n[!] No hay búsquedas guardadas disponibles para exportar.');
      return;
    }

    const choices = searchIds.map((id) => ({ label: sanitizeString(id), value: id }));
    const selectedId = await this.prompter.promptChoice(
      'Seleccioná la búsqueda a exportar:',
      choices,
      0,
    );

    const rawYaml = await this.configStore.read(selectedId);
    if (!rawYaml) {
      this.terminal.writeLine(`\n[!] No se pudo leer la búsqueda "${sanitizeString(selectedId)}".`);
      return;
    }

    let config: SavedSearchConfigurationV1;
    try {
      config = parseSavedSearchYaml(rawYaml);
    } catch (err) {
      this.terminal.writeLine(
        `\n[!] Error al interpretar la búsqueda: ${sanitizeString(err instanceof Error ? err.message : String(err))}`,
      );
      return;
    }

    const destinationPath = await this.prompter.promptText(
      'Ruta del archivo de destino (ej: /tmp/mi-busqueda.yml)',
    );

    const fileExists = await this.textFilePort.exists(destinationPath);
    let overwrite = false;
    if (fileExists) {
      const confirmOverwrite = await this.prompter.promptBoolean(
        `El archivo de destino "${sanitizeString(destinationPath)}" ya existe. ¿Deseás sobrescribirlo?`,
        false,
      );
      if (!confirmOverwrite) {
        this.terminal.writeLine('\nExportación cancelada por el usuario.');
        return;
      }
      overwrite = true;
    }

    const serializedExport = exportSavedSearchYaml(config);
    try {
      await this.textFilePort.writeTextFile(destinationPath, serializedExport, {
        overwrite,
        signal: this.signal,
      });
      this.terminal.writeLine(
        `\n✓ Búsqueda "${sanitizeString(selectedId)}" exportada exitosamente a "${sanitizeString(destinationPath)}".`,
      );
    } catch (writeErr) {
      if (isCliError(writeErr)) {
        this.terminal.writeLine(`\n[!] [${writeErr.code}] ${sanitizeString(writeErr.userMessage)}`);
      } else {
        this.terminal.writeLine(
          `\n[!] Error al escribir el archivo: ${sanitizeString(writeErr instanceof Error ? writeErr.message : String(writeErr))}`,
        );
      }
    }
  }

  private async handleDelete(): Promise<void> {
    this.terminal.writeLine('\n--- Eliminar Búsqueda Guardada ---');
    const searchIds = await this.configStore.list();
    if (searchIds.length === 0) {
      this.terminal.writeLine('\n[!] No hay búsquedas guardadas disponibles para eliminar.');
      return;
    }

    const choices = searchIds.map((id) => ({ label: sanitizeString(id), value: id }));
    const selectedId = await this.prompter.promptChoice(
      'Seleccioná la búsqueda a eliminar:',
      choices,
      0,
    );

    const rawYaml = await this.configStore.read(selectedId);
    let searchName = selectedId;
    if (rawYaml) {
      try {
        const config = parseSavedSearchYaml(rawYaml);
        searchName = config.name;
      } catch {
        // Fallback to id
      }
    }

    const logicalPath = this.configStore.resolvePath(selectedId);
    this.terminal.writeLine('\nDetalles de la configuración a eliminar:');
    this.terminal.writeLine(`  ID:     ${sanitizeString(selectedId)}`);
    this.terminal.writeLine(`  Nombre: ${sanitizeString(searchName)}`);
    this.terminal.writeLine(`  Ruta:   ${sanitizeString(logicalPath)}\n`);

    const confirmDelete = await this.prompter.promptBoolean(
      `¿Estás seguro de que deseás ELIMINAR definitivamente la búsqueda "${sanitizeString(selectedId)}"?`,
      false,
    );

    if (!confirmDelete) {
      this.terminal.writeLine('\nEliminación cancelada. No se modificó ningún archivo.');
      return;
    }

    await this.configStore.remove(selectedId, { signal: this.signal });
    this.terminal.writeLine(`\n✓ Búsqueda "${sanitizeString(selectedId)}" eliminada exitosamente.`);
  }

  private async handleCleanupArtifacts(): Promise<void> {
    if (!this.rawArtifactService) {
      return;
    }

    this.terminal.writeLine('\n--- Limpieza de Artifacts Vencidos ---');
    try {
      const preview = await this.rawArtifactService.inspectExpired();
      if (preview.count === 0) {
        this.terminal.writeLine('No se encontraron artifacts vencidos para limpiar.');
        return;
      }

      const sizeMb = (preview.totalSizeBytes / (1024 * 1024)).toFixed(2);
      this.terminal.writeLine(
        `Se encontraron ${preview.count} artifacts vencidos (${preview.totalSizeBytes} bytes / ~${sizeMb} MB).`,
      );

      const confirmed = await this.prompter.promptBoolean(
        '¿Deseás proceder con la eliminación de los artifacts vencidos?',
        false,
      );

      if (!confirmed) {
        this.terminal.writeLine('\nOperación cancelada. No se eliminó ningún artifact.');
        return;
      }

      const summary = await this.rawArtifactService.cleanupExpiredArtifacts();
      this.terminal.writeLine('\nResumen de limpieza:');
      this.terminal.writeLine(`  - Encontrados:   ${summary.found}`);
      this.terminal.writeLine(`  - Eliminados:    ${summary.deleted}`);
      this.terminal.writeLine(`  - Ya ausentes:   ${summary.alreadyMissing}`);
      this.terminal.writeLine(`  - Fallidos:      ${summary.failed}`);
    } catch (err) {
      this.terminal.writeLine(
        `\n[!] Error durante la limpieza de artifacts: ${sanitizeString(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }
}
