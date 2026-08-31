import {
  validateSavedSearchConfiguration,
  validateSearchCapabilities,
  serializeSavedSearchYaml,
  type SavedSearchConfigurationV1,
  type SourceConfigurationV1,
  type SearchCategoryV1,
  type ListingConditionV1,
  type PriceCurrencyV1,
  type LocationConfigurationV1,
  type PriceConfigurationV1,
  type ConditionConfigurationV1,
  type ProductConfigurationV1,
  type RulesConfigurationV1,
  type EvaluationConfigurationV1,
  type AiConfigurationV1,
  type RetentionConfigurationV1,
  type ReportConfigurationV1,
  type SourceRegistry,
} from '@busca-ofertas-ai/configuration';
import type { TerminalPort } from '../runtime/terminal.js';
import type { SavedSearchConfigStore } from '../storage/saved-search-store.js';
import { sanitizeString } from '../runtime/diagnostics.js';
import { isConfigurationError } from '@busca-ofertas-ai/configuration';
import {
  WIZARD_DEFAULT_ENABLED,
  WIZARD_DEFAULT_EVALUATION,
  WIZARD_DEFAULT_AI,
  WIZARD_DEFAULT_RETENTION,
  WIZARD_DEFAULT_REPORT,
} from './wizard-defaults.js';
import { WizardPrompter, type ChoiceItem } from './wizard-prompter.js';
import { formatSearchSummary } from './summary-formatter.js';

export interface CreateSearchWizardOptions {
  readonly terminal: TerminalPort;
  readonly signal: AbortSignal;
  readonly sourceRegistry: SourceRegistry;
  readonly configStore: SavedSearchConfigStore;
}

export class CreateSearchWizard {
  private readonly terminal: TerminalPort;
  private readonly signal: AbortSignal;
  private readonly sourceRegistry: SourceRegistry;
  private readonly configStore: SavedSearchConfigStore;
  private readonly prompter: WizardPrompter;

  constructor(options: CreateSearchWizardOptions) {
    this.terminal = options.terminal;
    this.signal = options.signal;
    this.sourceRegistry = options.sourceRegistry;
    this.configStore = options.configStore;
    this.prompter = new WizardPrompter(options.terminal, options.signal);
  }

  public async run(): Promise<void> {
    this.terminal.writeLine('\n============================================================');
    this.terminal.writeLine('               CREAR NUEVA BÚSQUEDA GUARDADA                ');
    this.terminal.writeLine('============================================================');

    // 1. Inspect SourceRegistry
    const allRegisteredSources = this.sourceRegistry.list();
    const enabledSources = allRegisteredSources.filter((s) => s.status === 'ENABLED');
    const disabledSources = allRegisteredSources.filter((s) => s.status === 'DISABLED');

    if (enabledSources.length === 0) {
      this.terminal.writeLine(
        '\n[!] No hay fuentes disponibles o habilitadas en el SourceRegistry.',
      );
      if (disabledSources.length > 0) {
        this.terminal.writeLine('Fuentes registradas pero deshabilitadas:');
        for (const ds of disabledSources) {
          this.terminal.writeLine(`  - [${ds.id}] ${ds.reason ?? 'Deshabilitada'}`);
        }
      }
      this.terminal.writeLine(
        'Acción sugerida: Registrá o habilitá al menos un adaptador de fuente antes de crear búsquedas.\n',
      );
      return;
    }

    // 2. Mode selection
    const modeChoices: Array<ChoiceItem<'simple' | 'advanced' | 'cancel'>> = [
      {
        label: 'Modo Simple',
        value: 'simple',
        description: 'Preguntas esenciales y defaults seguros',
      },
      {
        label: 'Modo Avanzado',
        value: 'advanced',
        description: 'Control total de filtros, reglas, IA y reportes',
      },
      { label: 'Cancelar', value: 'cancel', description: 'Volver al menú principal sin guardar' },
    ];

    const mode = await this.prompter.promptChoice(
      'Seleccioná el modo de creación:',
      modeChoices,
      0,
    );
    if (mode === 'cancel') {
      this.terminal.writeLine('\nOperación cancelada por el usuario.');
      return;
    }

    // 3. Identification
    this.terminal.writeLine('\n--- Identificación ---');
    const id = await this.prompter.promptText(
      'ID de la búsqueda (kebab-case, ej: switch-lite-amba)',
      {
        validator: (val) => {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(val)) {
            return 'El ID debe estar en formato kebab-case en minúsculas (letras minúsculas, números y guiones).';
          }
          return undefined;
        },
      },
    );

    const name = await this.prompter.promptText('Nombre descriptivo', {
      defaultValue: id,
      allowEmpty: false,
    });

    const enabled = await this.prompter.promptBoolean(
      '¿Habilitar búsqueda inmediatamente?',
      WIZARD_DEFAULT_ENABLED,
    );

    // 4. Category
    const categoryChoices: Array<ChoiceItem<SearchCategoryV1>> = [
      { label: 'PRODUCT (Artículos y productos físicos)', value: 'PRODUCT' },
      { label: 'REAL_ESTATE (Propiedades e inmuebles)', value: 'REAL_ESTATE' },
      { label: 'VEHICLE (Autos y vehículos)', value: 'VEHICLE' },
    ];
    const category = await this.prompter.promptChoice('Categoría de búsqueda:', categoryChoices, 0);

    // 5. Source selection & capability checks
    this.terminal.writeLine('\n--- Fuentes de datos ---');
    if (disabledSources.length > 0) {
      this.terminal.writeLine(
        'Aviso: Existen fuentes deshabilitadas que no podrán ser seleccionadas:',
      );
      for (const ds of disabledSources) {
        this.terminal.writeLine(`  - ${ds.id}: ${ds.reason}`);
      }
    }

    const sourceChoices = enabledSources.map((s) => ({
      label: `${s.id} (v${s.version})`,
      value: s,
    }));

    const selectedSourceEntries = await this.prompter.promptMultiChoice(
      'Seleccioná una o más fuentes para esta búsqueda:',
      sourceChoices,
      { defaultSelectedIndices: [0], minSelected: 1 },
    );

    const configuredSources: SourceConfigurationV1[] = [];
    let allSelectedSupportGeographic = true;

    for (const sourceEntry of selectedSourceEntries) {
      this.terminal.writeLine(`\nConfigurando fuente: [${sourceEntry.id}]`);
      if (!sourceEntry.capabilities.geographicSearch) {
        allSelectedSupportGeographic = false;
      }

      let queries: string[] = [];
      if (sourceEntry.capabilities.textSearch) {
        queries = await this.prompter.promptStringList(
          `Términos de búsqueda textual (queries) para ${sourceEntry.id}:`,
          {
            minItems: 1,
            itemHint:
              'Ingresá cada término de búsqueda. Presioná [Enter] en una línea vacía para finalizar:',
          },
        );
      } else {
        this.terminal.writeLine(`  (La fuente "${sourceEntry.id}" no utiliza búsqueda textual).`);
      }

      if (sourceEntry.capabilities.authentication) {
        this.terminal.writeLine(
          `  [i] Nota: "${sourceEntry.id}" admite autenticación. Las credenciales se gestionan externamente.`,
        );
      }

      const sourceOptions: Record<string, unknown> = {};
      if (mode === 'advanced' && sourceEntry.capabilities.pagination) {
        const maxPages = await this.prompter.promptNumber(
          'Límite de páginas a consultar (maxPages)',
          {
            defaultValue: 3,
            min: 1,
            max: 100,
            integerOnly: true,
            optional: true,
          },
        );
        if (typeof maxPages === 'number') {
          sourceOptions['maxPages'] = maxPages;
        }
      }

      configuredSources.push({
        id: sourceEntry.id,
        enabled: true,
        queries,
        ...(Object.keys(sourceOptions).length > 0 ? { options: sourceOptions } : {}),
      });
    }

    // 6. Location configuration
    let location: LocationConfigurationV1 | undefined = undefined;
    if (allSelectedSupportGeographic) {
      this.terminal.writeLine('\n--- Ubicación geográfica ---');
      const wantsLocation = await this.prompter.promptBoolean(
        '¿Deseás configurar un filtro de ubicación/región?',
        false,
      );
      if (wantsLocation) {
        if (mode === 'simple') {
          const regionName = await this.prompter.promptText(
            'Nombre de la región o zona (ej: AMBA, CABA, Rosario)',
            {
              allowEmpty: false,
            },
          );
          location = {
            mode: 'REGION',
            region: regionName,
          };
        } else {
          const locationModeChoices: Array<ChoiceItem<'REGION' | 'RADIUS' | 'CUSTOM'>> = [
            { label: 'REGION (Búsqueda por zona/región)', value: 'REGION' },
            { label: 'RADIUS (Búsqueda por radio en km)', value: 'RADIUS' },
            { label: 'CUSTOM (Coordenadas y radio específico)', value: 'CUSTOM' },
          ];
          const locMode = await this.prompter.promptChoice(
            'Modo de ubicación:',
            locationModeChoices,
            0,
          );

          if (locMode === 'REGION') {
            const region = await this.prompter.promptText('Región:', { allowEmpty: false });
            const radiusKm = await this.prompter.promptNumber('Radio en km (opcional):', {
              optional: true,
              min: 1,
            });
            location = {
              mode: 'REGION',
              region,
              ...(typeof radiusKm === 'number' ? { radiusKm } : {}),
            };
          } else if (locMode === 'RADIUS') {
            const radiusKm = await this.prompter.promptNumber('Radio en km:', {
              min: 1,
              defaultValue: 50,
            });
            location = {
              mode: 'RADIUS',
              radiusKm: typeof radiusKm === 'number' ? radiusKm : 50,
            };
          } else {
            const lat = await this.prompter.promptNumber('Latitud (-90 a 90):', {
              min: -90,
              max: 90,
            });
            const lon = await this.prompter.promptNumber('Longitud (-180 a 180):', {
              min: -180,
              max: 180,
            });
            const radiusKm = await this.prompter.promptNumber('Radio en km (opcional):', {
              min: 1,
              optional: true,
            });
            location = {
              mode: 'CUSTOM',
              coordinates: {
                latitude: typeof lat === 'number' ? lat : 0,
                longitude: typeof lon === 'number' ? lon : 0,
              },
              ...(typeof radiusKm === 'number' ? { radiusKm } : {}),
            };
          }
        }
      }
    } else {
      this.terminal.writeLine(
        '\n[i] Una o más fuentes seleccionadas no admiten búsqueda geográfica; se omitirá el filtro de ubicación.',
      );
    }

    // 7. Price configuration
    this.terminal.writeLine('\n--- Precios y Moneda ---');
    const currencyChoices: Array<ChoiceItem<PriceCurrencyV1>> = [
      { label: 'ARS (Pesos Argentinos)', value: 'ARS' },
      { label: 'USD (Dólares Estadounidenses)', value: 'USD' },
      { label: 'UNKNOWN (Moneda no restringida)', value: 'UNKNOWN' },
    ];
    const targetCurrency = await this.prompter.promptChoice(
      'Moneda objetivo de evaluación:',
      currencyChoices,
      0,
    );

    const maximumPrice = await this.prompter.promptNumber('Precio máximo aceptado (opcional):', {
      optional: true,
      min: 1,
    });

    let minimumPlausiblePrice: number | null | undefined = undefined;
    let foreignCurrencyPolicy = undefined;

    if (mode === 'advanced') {
      minimumPlausiblePrice = await this.prompter.promptNumber(
        'Precio mínimo verosímil (filtro de outliers/precios falsos, opcional):',
        {
          optional: true,
          min: 1,
          validator: (val) => {
            if (typeof maximumPrice === 'number' && val > maximumPrice) {
              return `El precio mínimo verosímil (${val}) no puede superar el precio máximo (${maximumPrice}).`;
            }
            return undefined;
          },
        },
      );

      const wantsForeignPolicy = await this.prompter.promptBoolean(
        '¿Configurar política de conversión para moneda extranjera?',
        false,
      );
      if (wantsForeignPolicy) {
        const fcMode = await this.prompter.promptChoice(
          'Modo para moneda extranjera:',
          [
            { label: 'MANUAL_RATE (Pedir cotización manual)', value: 'MANUAL_RATE' as const },
            { label: 'IGNORE (Ignorar conversiones)', value: 'IGNORE' as const },
            { label: 'STRICT (Rechazar si no es targetCurrency)', value: 'STRICT' as const },
          ],
          0,
        );

        const fcUnknown = await this.prompter.promptChoice(
          'Acción ante moneda desconocida:',
          [
            { label: 'REVIEW (Enviar a revisión manual)', value: 'REVIEW' as const },
            { label: 'REJECT (Rechazar publicación)', value: 'REJECT' as const },
          ],
          0,
        );

        foreignCurrencyPolicy = { mode: fcMode, onUnknown: fcUnknown };
      }
    }

    const price: PriceConfigurationV1 = {
      targetCurrency,
      ...(maximumPrice !== undefined ? { maximum: maximumPrice } : {}),
      ...(minimumPlausiblePrice !== undefined ? { minimumPlausible: minimumPlausiblePrice } : {}),
      ...(foreignCurrencyPolicy ? { foreignCurrency: foreignCurrencyPolicy } : {}),
    };

    // 8. Condition configuration
    this.terminal.writeLine('\n--- Condiciones del artículo ---');
    const conditionChoices: Array<ChoiceItem<ListingConditionV1>> = [
      { label: 'NEW (Nuevo)', value: 'NEW' },
      { label: 'LIKE_NEW (Como nuevo)', value: 'LIKE_NEW' },
      { label: 'GOOD (Buen estado)', value: 'GOOD' },
      { label: 'FAIR (Estado regular)', value: 'FAIR' },
      { label: 'FOR_PARTS (Para repuesto/reparar)', value: 'FOR_PARTS' },
      { label: 'UNKNOWN (Condición no especificada)', value: 'UNKNOWN' },
    ];
    const acceptedConditions = await this.prompter.promptMultiChoice(
      'Seleccioná las condiciones aceptadas:',
      conditionChoices,
      { defaultSelectedIndices: [0, 1, 2], minSelected: 1 },
    );
    const condition: ConditionConfigurationV1 = { accepted: acceptedConditions };

    // 9. Product specific filters (only for PRODUCT category)
    let product: ProductConfigurationV1 | undefined = undefined;
    if (category === 'PRODUCT') {
      if (mode === 'simple') {
        product = {
          requireFunctional: true,
          chargerRequired: false,
          boxRequired: false,
          expectedModels: [],
        };
      } else {
        this.terminal.writeLine('\n--- Filtros de producto ---');
        const expectedModels = await this.prompter.promptStringList(
          'Modelos específicos esperados (opcional):',
          {
            itemHint:
              'Ingresá modelo esperado (ej: NINTENDO_SWITCH_LITE) o Enter vacío para omitir:',
          },
        );
        const requireFunctional = await this.prompter.promptBoolean(
          '¿Requerir que sea 100% funcional?',
          true,
        );
        const chargerRequired = await this.prompter.promptBoolean(
          '¿Requiere incluir cargador?',
          false,
        );
        const boxRequired = await this.prompter.promptBoolean(
          '¿Requiere incluir caja original?',
          false,
        );

        product = {
          ...(expectedModels.length > 0 ? { expectedModels } : {}),
          requireFunctional,
          chargerRequired,
          boxRequired,
        };
      }
    }

    // 10. Rules configuration
    let rules: RulesConfigurationV1 = {
      profile: id,
      include: [],
      exclude: [],
    };
    if (mode === 'advanced') {
      this.terminal.writeLine('\n--- Reglas deterministas ---');
      const profile = await this.prompter.promptText('Identificador de perfil de reglas:', {
        defaultValue: id,
      });
      const includeRules = await this.prompter.promptStringList(
        'Términos requeridos obligatorios (include rules):',
        {
          itemHint: 'Ingresá término requerido o Enter vacío para omitir:',
        },
      );
      const excludeRules = await this.prompter.promptStringList(
        'Términos a descartar automáticamente (exclude rules):',
        {
          itemHint:
            'Ingresá término a excluir (ej: "solo caja", "repuesto") o Enter vacío para omitir:',
        },
      );
      rules = {
        profile,
        ...(includeRules.length > 0 ? { include: includeRules } : { include: [] }),
        ...(excludeRules.length > 0 ? { exclude: excludeRules } : { exclude: [] }),
      };
    }

    // 11. Mandatory blocks: Evaluation, AI, Retention, Report
    let evaluation: EvaluationConfigurationV1 = { ...WIZARD_DEFAULT_EVALUATION };
    let ai: AiConfigurationV1 = { ...WIZARD_DEFAULT_AI };
    let retention: RetentionConfigurationV1 = { ...WIZARD_DEFAULT_RETENTION };
    let report: ReportConfigurationV1 = { ...WIZARD_DEFAULT_REPORT };

    if (mode === 'advanced') {
      this.terminal.writeLine('\n--- Evaluación y Umbrales ---');
      const matchThreshold = await this.prompter.promptNumber(
        'Puntaje mínimo para MATCH (0-100):',
        {
          defaultValue: WIZARD_DEFAULT_EVALUATION.matchThreshold,
          min: 0,
          max: 100,
          integerOnly: true,
        },
      );
      const reviewThreshold = await this.prompter.promptNumber(
        'Puntaje mínimo para REVIEW (0-100):',
        {
          defaultValue: WIZARD_DEFAULT_EVALUATION.reviewThreshold,
          min: 0,
          max: 100,
          integerOnly: true,
          validator: (val) => {
            if (typeof matchThreshold === 'number' && val >= matchThreshold) {
              return `reviewThreshold (${val}) debe ser estrictamente menor que matchThreshold (${matchThreshold}).`;
            }
            return undefined;
          },
        },
      );
      const precisionProfile = await this.prompter.promptChoice(
        'Perfil de precisión:',
        [
          { label: 'MIXED (Balanceado entre precisión y recall)', value: 'MIXED' as const },
          { label: 'STRICT (Prioriza máxima precisión)', value: 'STRICT' as const },
          { label: 'BALANCED (Balance estándar)', value: 'BALANCED' as const },
          { label: 'PERMISSIVE (Alta tolerancia)', value: 'PERMISSIVE' as const },
        ],
        0,
      );

      evaluation = {
        matchThreshold: typeof matchThreshold === 'number' ? matchThreshold : 80,
        reviewThreshold: typeof reviewThreshold === 'number' ? reviewThreshold : 40,
        precisionProfile,
      };

      this.terminal.writeLine('\n--- Inteligencia Artificial ---');
      const aiEnabled = await this.prompter.promptBoolean(
        '¿Habilitar asistencia de IA para publicaciones dudosas?',
        false,
      );
      if (aiEnabled) {
        const provider = await this.prompter.promptText('Proveedor de IA (ej: deepseek, openai):', {
          defaultValue: 'deepseek',
        });
        const evaluateOnlyReview = await this.prompter.promptBoolean(
          '¿Evaluar únicamente casos en estado REVIEW?',
          true,
        );
        const requireConfirmation = await this.prompter.promptBoolean(
          '¿Requerir confirmación antes de consultar IA?',
          true,
        );
        const maxEvals = await this.prompter.promptNumber(
          'Máximo de evaluaciones IA por ejecución:',
          {
            defaultValue: 5,
            min: 1,
            integerOnly: true,
          },
        );

        ai = {
          enabled: true,
          evaluateOnlyReview,
          requireConfirmation,
          maxEvaluationsPerRun: typeof maxEvals === 'number' ? maxEvals : 5,
          provider,
        };
      }

      this.terminal.writeLine('\n--- Retención y Reportes ---');
      const rawDataDays = await this.prompter.promptNumber('Días de retención de datos crudos:', {
        defaultValue: WIZARD_DEFAULT_RETENTION.rawDataDays,
        min: 1,
        integerOnly: true,
      });
      retention = {
        rawArtifacts: WIZARD_DEFAULT_RETENTION.rawArtifacts,
        rawDataDays: typeof rawDataDays === 'number' ? rawDataDays : 30,
      };

      const openAutomatically = await this.prompter.promptBoolean(
        '¿Abrir reporte HTML automáticamente al terminar?',
        true,
      );
      report = {
        openAutomatically,
        includeRejected: WIZARD_DEFAULT_REPORT.includeRejected,
        exports: WIZARD_DEFAULT_REPORT.exports,
      };
    }

    // 12. Assemble candidate
    const candidate: SavedSearchConfigurationV1 = {
      schemaVersion: 1,
      id,
      name,
      enabled,
      category,
      sources: configuredSources,
      ...(location ? { location } : {}),
      price,
      condition,
      ...(product ? { product } : {}),
      rules,
      evaluation,
      ai,
      retention,
      report,
    };

    // 13. Two-layer Validation
    let validatedConfig: SavedSearchConfigurationV1;
    try {
      validatedConfig = validateSavedSearchConfiguration(candidate);
      validateSearchCapabilities(validatedConfig, this.sourceRegistry);
    } catch (valErr) {
      if (isConfigurationError(valErr)) {
        this.terminal.writeLine(
          `\n[!] Error de validación [${valErr.code}]: ${sanitizeString(valErr.message)}`,
        );
        if (valErr.suggestion) {
          this.terminal.writeLine(`Acción sugerida: ${sanitizeString(valErr.suggestion)}`);
        }
        for (const issue of valErr.issues) {
          this.terminal.writeLine(`  - ${issue.path}: ${sanitizeString(issue.message)}`);
        }
      } else {
        this.terminal.writeLine(
          `\n[!] Error de validación: ${sanitizeString(valErr instanceof Error ? valErr.message : String(valErr))}`,
        );
      }
      this.terminal.writeLine('No se guardaron cambios debido a errores de validación.\n');
      return;
    }

    // 14. Display Summary & Destination
    this.terminal.writeLine('\n============================================================');
    this.terminal.writeLine('                  RESUMEN DE LA BÚSQUEDA                    ');
    this.terminal.writeLine('============================================================');
    this.terminal.writeLine(formatSearchSummary(validatedConfig));

    const targetPath = this.configStore.resolvePath(validatedConfig.id);
    this.terminal.writeLine(`Destino de almacenamiento: ${targetPath}\n`);

    // 15. Confirm save
    const confirmSave = await this.prompter.promptBoolean('¿Deseás guardar esta búsqueda?', false);
    if (!confirmSave) {
      this.terminal.writeLine('\nCreación cancelada por el usuario. No se guardaron cambios.');
      return;
    }

    // 16. Overwrite check
    const alreadyExists = await this.configStore.exists(validatedConfig.id);
    let overwrite = false;
    if (alreadyExists) {
      const confirmOverwrite = await this.prompter.promptBoolean(
        `Ya existe un archivo guardado con ID "${validatedConfig.id}". ¿Deseás sobrescribirlo?`,
        false,
      );
      if (!confirmOverwrite) {
        this.terminal.writeLine(
          '\nOperación cancelada. El archivo preexistente no fue modificado.',
        );
        return;
      }
      overwrite = true;
    }

    // 17. Atomic Persistence
    const yamlContent = serializeSavedSearchYaml(validatedConfig);
    await this.configStore.write(validatedConfig.id, yamlContent, {
      overwrite,
      signal: this.signal,
    });

    this.terminal.writeLine(
      `\n✓ ¡Búsqueda "${validatedConfig.id}" creada y guardada exitosamente!`,
    );
  }
}
