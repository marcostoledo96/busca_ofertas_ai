import {
  parseSavedSearchYaml,
  validateSavedSearchConfiguration,
  validateSearchCapabilities,
  serializeSavedSearchYaml,
  type SavedSearchConfigurationV1,
  type SourceConfigurationV1,
  type SearchCategoryV1,
  type ListingConditionV1,
  type PriceCurrencyV1,
  type SourceRegistry,
} from '@busca-ofertas-ai/configuration';
import type { TerminalPort } from '../runtime/terminal.js';
import type { SavedSearchConfigStore } from '../storage/saved-search-store.js';
import { sanitizeString } from '../runtime/diagnostics.js';
import { isConfigurationError } from '@busca-ofertas-ai/configuration';
import { WizardPrompter, type ChoiceItem } from './wizard-prompter.js';
import { formatSearchSummary } from './summary-formatter.js';
import { calculateStructuralDiff, formatStructuralDiff } from './structural-diff.js';

export interface EditSearchWizardOptions {
  readonly terminal: TerminalPort;
  readonly signal: AbortSignal;
  readonly sourceRegistry: SourceRegistry;
  readonly configStore: SavedSearchConfigStore;
}

export class EditSearchWizard {
  private readonly terminal: TerminalPort;
  private readonly signal: AbortSignal;
  private readonly sourceRegistry: SourceRegistry;
  private readonly configStore: SavedSearchConfigStore;
  private readonly prompter: WizardPrompter;

  constructor(options: EditSearchWizardOptions) {
    this.terminal = options.terminal;
    this.signal = options.signal;
    this.sourceRegistry = options.sourceRegistry;
    this.configStore = options.configStore;
    this.prompter = new WizardPrompter(options.terminal, options.signal);
  }

  public async run(): Promise<void> {
    this.terminal.writeLine('\n============================================================');
    this.terminal.writeLine('                  EDITAR BÚSQUEDA GUARDADA                  ');
    this.terminal.writeLine('============================================================');

    const searchIds = await this.configStore.list();
    if (searchIds.length === 0) {
      this.terminal.writeLine('\n[!] No hay búsquedas guardadas disponibles para editar.');
      this.terminal.writeLine(
        'Acción sugerida: Creá una nueva búsqueda desde la opción 2 del menú principal.\n',
      );
      return;
    }

    const searchChoices = searchIds.map((id) => ({
      label: id,
      value: id,
    }));

    const selectedId = await this.prompter.promptChoice(
      'Seleccioná la búsqueda que deseás editar:',
      searchChoices,
      0,
    );

    const rawYaml = await this.configStore.read(selectedId);
    if (!rawYaml) {
      this.terminal.writeLine(`\n[!] No se pudo leer la configuración de "${selectedId}".`);
      return;
    }

    let originalConfig: SavedSearchConfigurationV1;
    try {
      originalConfig = parseSavedSearchYaml(rawYaml);
    } catch (err) {
      this.terminal.writeLine(
        `\n[!] Error al interpretar la configuración existente de "${selectedId}":`,
      );
      if (isConfigurationError(err)) {
        this.terminal.writeLine(`    ${sanitizeString(err.message)}`);
      } else {
        this.terminal.writeLine(
          `    ${sanitizeString(err instanceof Error ? err.message : String(err))}`,
        );
      }
      return;
    }

    // Deep clone original configuration into an editable mutable draft
    let draft: SavedSearchConfigurationV1 = structuredClone(originalConfig);

    let editing = true;
    while (editing && !this.signal.aborted) {
      this.terminal.writeLine('\n------------------------------------------------------------');
      this.terminal.writeLine(`Editando: [${draft.id}] - ${draft.name}`);
      this.terminal.writeLine('------------------------------------------------------------');

      const menuChoices: Array<ChoiceItem<string>> = [
        { label: 'Información general (Nombre, Estado, Categoría)', value: 'general' },
        { label: 'Fuentes y queries de búsqueda', value: 'sources' },
        { label: 'Ubicación geográfica', value: 'location' },
        { label: 'Precios y monedas', value: 'price' },
        { label: 'Condiciones aceptadas', value: 'condition' },
        ...(draft.category === 'PRODUCT'
          ? [{ label: 'Filtros de producto', value: 'product' }]
          : []),
        { label: 'Reglas deterministas (Include / Exclude)', value: 'rules' },
        { label: 'Evaluación y umbrales (Match / Review)', value: 'evaluation' },
        { label: 'Inteligencia Artificial', value: 'ai' },
        { label: 'Retención y reportes', value: 'retention-report' },
        { label: 'Revisar resumen actual', value: 'summary' },
        { label: 'Guardar cambios y volver', value: 'save' },
        { label: 'Cancelar edición (descartar cambios)', value: 'cancel' },
      ];

      const section = await this.prompter.promptChoice(
        '¿Qué sección deseás modificar?',
        menuChoices,
      );

      switch (section) {
        case 'general': {
          const newName = await this.prompter.promptText('Nombre descriptivo', {
            defaultValue: draft.name,
          });
          const newEnabled = await this.prompter.promptBoolean(
            '¿Habilitar búsqueda?',
            draft.enabled,
          );
          const catChoices: Array<ChoiceItem<SearchCategoryV1>> = [
            { label: 'PRODUCT', value: 'PRODUCT' },
            { label: 'REAL_ESTATE', value: 'REAL_ESTATE' },
            { label: 'VEHICLE', value: 'VEHICLE' },
          ];
          const defaultCatIdx = catChoices.findIndex((c) => c.value === draft.category);
          const newCategory = await this.prompter.promptChoice(
            'Categoría:',
            catChoices,
            defaultCatIdx !== -1 ? defaultCatIdx : 0,
          );

          draft = {
            ...draft,
            name: newName,
            enabled: newEnabled,
            category: newCategory,
          };
          break;
        }

        case 'sources': {
          const updatedSources: SourceConfigurationV1[] = [];
          for (const src of draft.sources) {
            this.terminal.writeLine(`\nConfiguración de fuente: [${src.id}]`);
            const srcEnabled = await this.prompter.promptBoolean(
              `¿Habilitar fuente "${src.id}"?`,
              src.enabled,
            );

            const regEntry = this.sourceRegistry.get(src.id);
            let queries = src.queries ? [...src.queries] : [];
            if (!regEntry || regEntry.capabilities.textSearch) {
              queries = await this.prompter.promptStringList(
                `Queries de búsqueda para ${src.id}:`,
                {
                  minItems: srcEnabled ? 1 : 0,
                  defaultItems: queries,
                },
              );
            }

            // Preserve all custom options and untouched keys
            const currentOptions = src.options ? { ...src.options } : {};
            if (regEntry?.capabilities.pagination) {
              const currentMaxPages =
                typeof currentOptions['maxPages'] === 'number'
                  ? currentOptions['maxPages']
                  : undefined;
              const newMaxPages = await this.prompter.promptNumber(
                'Límite de páginas (maxPages):',
                {
                  defaultValue: currentMaxPages,
                  min: 1,
                  max: 100,
                  integerOnly: true,
                  optional: true,
                },
              );
              if (typeof newMaxPages === 'number') {
                currentOptions['maxPages'] = newMaxPages;
              }
            }

            updatedSources.push({
              ...src,
              enabled: srcEnabled,
              queries,
              options: Object.keys(currentOptions).length > 0 ? currentOptions : undefined,
            });
          }
          draft = { ...draft, sources: updatedSources };
          break;
        }

        case 'location': {
          const hasLocation = Boolean(draft.location);
          const wantsLocation = await this.prompter.promptBoolean(
            '¿Configurar filtro de ubicación geográfica?',
            hasLocation,
          );
          if (!wantsLocation) {
            draft = { ...draft, location: undefined };
          } else {
            const locModeChoices: Array<ChoiceItem<'REGION' | 'RADIUS' | 'CUSTOM'>> = [
              { label: 'REGION', value: 'REGION' },
              { label: 'RADIUS', value: 'RADIUS' },
              { label: 'CUSTOM', value: 'CUSTOM' },
            ];
            const currIdx = locModeChoices.findIndex((c) => c.value === draft.location?.mode);
            const mode = await this.prompter.promptChoice(
              'Modo de ubicación:',
              locModeChoices,
              currIdx !== -1 ? currIdx : 0,
            );

            if (mode === 'REGION') {
              const region = await this.prompter.promptText('Región/Zona:', {
                defaultValue: draft.location?.region ?? 'AMBA',
              });
              const radiusKm = await this.prompter.promptNumber('Radio en km (opcional):', {
                defaultValue: draft.location?.radiusKm,
                optional: true,
                min: 1,
              });
              draft = {
                ...draft,
                location: {
                  mode: 'REGION',
                  region,
                  ...(typeof radiusKm === 'number' ? { radiusKm } : {}),
                },
              };
            } else if (mode === 'RADIUS') {
              const radiusKm = await this.prompter.promptNumber('Radio en km:', {
                defaultValue: draft.location?.radiusKm ?? 50,
                min: 1,
              });
              draft = {
                ...draft,
                location: {
                  mode: 'RADIUS',
                  radiusKm: typeof radiusKm === 'number' ? radiusKm : 50,
                },
              };
            } else {
              const lat = await this.prompter.promptNumber('Latitud (-90 a 90):', {
                defaultValue: draft.location?.coordinates?.latitude ?? 0,
                min: -90,
                max: 90,
              });
              const lon = await this.prompter.promptNumber('Longitud (-180 a 180):', {
                defaultValue: draft.location?.coordinates?.longitude ?? 0,
                min: -180,
                max: 180,
              });
              const radiusKm = await this.prompter.promptNumber('Radio en km (opcional):', {
                defaultValue: draft.location?.radiusKm,
                optional: true,
                min: 1,
              });
              draft = {
                ...draft,
                location: {
                  mode: 'CUSTOM',
                  coordinates: {
                    latitude: typeof lat === 'number' ? lat : 0,
                    longitude: typeof lon === 'number' ? lon : 0,
                  },
                  ...(typeof radiusKm === 'number' ? { radiusKm } : {}),
                },
              };
            }
          }
          break;
        }

        case 'price': {
          const currChoices: Array<ChoiceItem<PriceCurrencyV1>> = [
            { label: 'ARS', value: 'ARS' },
            { label: 'USD', value: 'USD' },
            { label: 'UNKNOWN', value: 'UNKNOWN' },
          ];
          const currIdx = currChoices.findIndex((c) => c.value === draft.price?.targetCurrency);
          const targetCurrency = await this.prompter.promptChoice(
            'Moneda objetivo:',
            currChoices,
            currIdx !== -1 ? currIdx : 0,
          );

          const maximum = await this.prompter.promptNumber('Precio máximo:', {
            defaultValue: draft.price?.maximum,
            optional: true,
            min: 1,
          });

          const minimumPlausible = await this.prompter.promptNumber('Precio mínimo verosímil:', {
            defaultValue: draft.price?.minimumPlausible,
            optional: true,
            min: 1,
          });

          draft = {
            ...draft,
            price: {
              targetCurrency,
              maximum,
              minimumPlausible,
              foreignCurrency: draft.price?.foreignCurrency,
            },
          };
          break;
        }

        case 'condition': {
          const condChoices: Array<ChoiceItem<ListingConditionV1>> = [
            { label: 'NEW', value: 'NEW' },
            { label: 'LIKE_NEW', value: 'LIKE_NEW' },
            { label: 'GOOD', value: 'GOOD' },
            { label: 'FAIR', value: 'FAIR' },
            { label: 'FOR_PARTS', value: 'FOR_PARTS' },
            { label: 'UNKNOWN', value: 'UNKNOWN' },
          ];
          const currentAccepted = draft.condition?.accepted ?? ['NEW', 'LIKE_NEW', 'GOOD'];
          const defaultIndices = condChoices
            .map((c, i) => (currentAccepted.includes(c.value) ? i : -1))
            .filter((i) => i !== -1);

          const accepted = await this.prompter.promptMultiChoice(
            'Condiciones aceptadas:',
            condChoices,
            { defaultSelectedIndices: defaultIndices, minSelected: 1 },
          );
          draft = { ...draft, condition: { accepted } };
          break;
        }

        case 'product': {
          const currentExpected = draft.product?.expectedModels ?? [];
          const expectedModels = await this.prompter.promptStringList('Modelos esperados:', {
            defaultItems: currentExpected,
          });
          const requireFunctional = await this.prompter.promptBoolean(
            '¿Requiere 100% funcional?',
            draft.product?.requireFunctional ?? true,
          );
          const chargerRequired = await this.prompter.promptBoolean(
            '¿Requiere cargador?',
            draft.product?.chargerRequired ?? false,
          );
          const boxRequired = await this.prompter.promptBoolean(
            '¿Requiere caja?',
            draft.product?.boxRequired ?? false,
          );

          draft = {
            ...draft,
            product: {
              ...(expectedModels.length > 0 ? { expectedModels } : {}),
              requireFunctional,
              chargerRequired,
              boxRequired,
            },
          };
          break;
        }

        case 'rules': {
          const profile = await this.prompter.promptText('Perfil de reglas:', {
            defaultValue: draft.rules?.profile ?? draft.id,
          });
          const include = await this.prompter.promptStringList('Términos requeridos (include):', {
            defaultItems: draft.rules?.include ?? [],
          });
          const exclude = await this.prompter.promptStringList('Términos a descartar (exclude):', {
            defaultItems: draft.rules?.exclude ?? [],
          });

          draft = {
            ...draft,
            rules: {
              profile,
              include,
              exclude,
            },
          };
          break;
        }

        case 'evaluation': {
          const matchThreshold = await this.prompter.promptNumber('Match threshold (0-100):', {
            defaultValue: draft.evaluation.matchThreshold,
            min: 0,
            max: 100,
            integerOnly: true,
          });
          const reviewThreshold = await this.prompter.promptNumber('Review threshold (0-100):', {
            defaultValue: draft.evaluation.reviewThreshold,
            min: 0,
            max: 100,
            integerOnly: true,
          });

          draft = {
            ...draft,
            evaluation: {
              ...draft.evaluation,
              matchThreshold:
                typeof matchThreshold === 'number'
                  ? matchThreshold
                  : draft.evaluation.matchThreshold,
              reviewThreshold:
                typeof reviewThreshold === 'number'
                  ? reviewThreshold
                  : draft.evaluation.reviewThreshold,
            },
          };
          break;
        }

        case 'ai': {
          const enabled = await this.prompter.promptBoolean('¿Habilitar IA?', draft.ai.enabled);
          if (enabled) {
            const provider = await this.prompter.promptText('Proveedor IA:', {
              defaultValue: draft.ai.provider ?? 'deepseek',
            });
            const evaluateOnlyReview = await this.prompter.promptBoolean(
              '¿Evaluar solo casos REVIEW?',
              draft.ai.evaluateOnlyReview,
            );
            const requireConfirmation = await this.prompter.promptBoolean(
              '¿Requerir confirmación antes de llamar IA?',
              draft.ai.requireConfirmation,
            );
            const maxEvaluationsPerRun = await this.prompter.promptNumber(
              'Máximo de evaluaciones por run:',
              {
                defaultValue: draft.ai.maxEvaluationsPerRun,
                min: 1,
                integerOnly: true,
              },
            );

            draft = {
              ...draft,
              ai: {
                enabled: true,
                evaluateOnlyReview,
                requireConfirmation,
                maxEvaluationsPerRun:
                  typeof maxEvaluationsPerRun === 'number' ? maxEvaluationsPerRun : 5,
                provider,
              },
            };
          } else {
            draft = {
              ...draft,
              ai: {
                ...draft.ai,
                enabled: false,
                provider: undefined,
              },
            };
          }
          break;
        }

        case 'retention-report': {
          const rawDataDays = await this.prompter.promptNumber(
            'Días de retención de datos crudos:',
            {
              defaultValue: draft.retention.rawDataDays,
              min: 1,
              integerOnly: true,
            },
          );
          const openAutomatically = await this.prompter.promptBoolean(
            '¿Abrir reporte HTML automáticamente?',
            draft.report?.openAutomatically ?? true,
          );

          draft = {
            ...draft,
            retention: {
              ...draft.retention,
              rawDataDays:
                typeof rawDataDays === 'number' ? rawDataDays : draft.retention.rawDataDays,
            },
            report: {
              ...draft.report,
              openAutomatically,
            },
          };
          break;
        }

        case 'summary': {
          this.terminal.writeLine('\n' + formatSearchSummary(draft));
          break;
        }

        case 'cancel': {
          this.terminal.writeLine(
            '\nEdición cancelada por el usuario. No se guardó ningún cambio.',
          );
          editing = false;
          return;
        }

        case 'save': {
          // 1. Two-layer validation
          let validatedDraft: SavedSearchConfigurationV1;
          try {
            validatedDraft = validateSavedSearchConfiguration(draft);
            validateSearchCapabilities(validatedDraft, this.sourceRegistry);
          } catch (valErr) {
            this.terminal.writeLine('\n[!] Error de validación en la configuración editada:');
            if (isConfigurationError(valErr)) {
              this.terminal.writeLine(`    [${valErr.code}] ${sanitizeString(valErr.message)}`);
              if (valErr.suggestion) {
                this.terminal.writeLine(
                  `    Acción sugerida: ${sanitizeString(valErr.suggestion)}`,
                );
              }
              for (const issue of valErr.issues) {
                this.terminal.writeLine(`    - ${issue.path}: ${sanitizeString(issue.message)}`);
              }
            } else {
              this.terminal.writeLine(
                `    ${sanitizeString(valErr instanceof Error ? valErr.message : String(valErr))}`,
              );
            }
            this.terminal.writeLine('Corregí los campos inválidos antes de guardar.\n');
            break;
          }

          // 2. Structural Diff Calculation
          const diffChanges = calculateStructuralDiff(originalConfig, validatedDraft);
          if (diffChanges.length === 0) {
            this.terminal.writeLine(
              '\nNo se detectaron modificaciones respecto a la versión guardada.',
            );
            editing = false;
            return;
          }

          this.terminal.writeLine('\n============================================================');
          this.terminal.writeLine('                    CAMBIOS APLICADOS                       ');
          this.terminal.writeLine('============================================================');
          this.terminal.writeLine(formatStructuralDiff(diffChanges));
          this.terminal.writeLine('============================================================\n');

          const confirmSave = await this.prompter.promptBoolean(
            `¿Confirmás guardar estos cambios en "${validatedDraft.id}"?`,
            false,
          );

          if (!confirmSave) {
            this.terminal.writeLine('\nOperación descartada por el usuario.');
            editing = false;
            return;
          }

          // 3. Serialize and Write Atomically
          const serializedYaml = serializeSavedSearchYaml(validatedDraft);
          await this.configStore.write(validatedDraft.id, serializedYaml, {
            overwrite: true,
            signal: this.signal,
          });

          this.terminal.writeLine(`\n✓ ¡Búsqueda "${validatedDraft.id}" actualizada exitosamente!`);
          editing = false;
          break;
        }
      }
    }
  }
}
