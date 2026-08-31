import type { TerminalPort } from '../runtime/terminal.js';
import { sanitizeString } from '../runtime/diagnostics.js';

export interface PromptTextOptions {
  readonly defaultValue?: string | undefined;
  readonly allowEmpty?: boolean | undefined;
  readonly validator?: ((value: string) => string | undefined) | undefined;
}

export interface PromptNumberOptions {
  readonly defaultValue?: number | null | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly integerOnly?: boolean | undefined;
  readonly optional?: boolean | undefined;
  readonly validator?: ((value: number) => string | undefined) | undefined;
}

export interface ChoiceItem<T> {
  readonly label: string;
  readonly value: T;
  readonly description?: string | undefined;
}

export interface MultiChoiceOptions {
  readonly defaultSelectedIndices?: readonly number[] | undefined;
  readonly minSelected?: number | undefined;
}

/**
 * WizardPrompter encapsulates cooperative, sanitized interactive prompting
 * over TerminalPort with immediate validation and AbortSignal cancellation.
 */
export class WizardPrompter {
  private readonly terminal: TerminalPort;
  private readonly signal: AbortSignal;

  constructor(terminal: TerminalPort, signal: AbortSignal) {
    this.terminal = terminal;
    this.signal = signal;
  }

  private checkAborted(): void {
    if (this.signal.aborted) {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
  }

  public async promptText(question: string, options?: PromptTextOptions): Promise<string> {
    while (!this.signal.aborted) {
      this.checkAborted();

      const suffix = options?.defaultValue !== undefined ? ` [${options.defaultValue}]: ` : ': ';
      const input = await this.terminal.prompt(`${question}${suffix}`, { signal: this.signal });
      this.checkAborted();

      const trimmed = input.trim();

      if (!trimmed && options?.defaultValue !== undefined) {
        return options.defaultValue;
      }

      if (!trimmed && !options?.allowEmpty) {
        this.terminal.writeLine(
          '  [!] Este campo no puede estar vacío. Por favor, ingresá un valor.',
        );
        continue;
      }

      if (options?.validator) {
        const validationError = options.validator(trimmed);
        if (validationError) {
          this.terminal.writeLine(`  [!] ${sanitizeString(validationError)}`);
          continue;
        }
      }

      return trimmed;
    }

    this.checkAborted();
    return '';
  }

  public async promptNumber(
    question: string,
    options?: PromptNumberOptions,
  ): Promise<number | null | undefined> {
    while (!this.signal.aborted) {
      this.checkAborted();

      let defaultStr = '';
      if (options?.defaultValue === null) {
        defaultStr = ' [ninguno]';
      } else if (options?.defaultValue !== undefined) {
        defaultStr = ` [${options.defaultValue}]`;
      }

      const promptStr = `${question}${defaultStr}: `;
      const rawInput = await this.terminal.prompt(promptStr, { signal: this.signal });
      this.checkAborted();

      const trimmed = rawInput.trim();

      if (!trimmed) {
        if (options?.defaultValue !== undefined) {
          return options.defaultValue;
        }
        if (options?.optional) {
          return undefined;
        }
        this.terminal.writeLine('  [!] Por favor, ingresá un número.');
        continue;
      }

      if (
        options?.optional &&
        (trimmed.toLowerCase() === 'ninguno' || trimmed.toLowerCase() === 'null')
      ) {
        return null;
      }

      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) {
        this.terminal.writeLine(`  [!] "${sanitizeString(trimmed)}" no es un número válido.`);
        continue;
      }

      if (options?.integerOnly && !Number.isInteger(parsed)) {
        this.terminal.writeLine('  [!] El valor debe ser un número entero.');
        continue;
      }

      if (options?.min !== undefined && parsed < options.min) {
        this.terminal.writeLine(`  [!] El valor no puede ser menor a ${options.min}.`);
        continue;
      }

      if (options?.max !== undefined && parsed > options.max) {
        this.terminal.writeLine(`  [!] El valor no puede ser mayor a ${options.max}.`);
        continue;
      }

      if (options?.validator) {
        const customErr = options.validator(parsed);
        if (customErr) {
          this.terminal.writeLine(`  [!] ${sanitizeString(customErr)}`);
          continue;
        }
      }

      return parsed;
    }

    this.checkAborted();
    return undefined;
  }

  public async promptBoolean(question: string, defaultValue = false): Promise<boolean> {
    while (!this.signal.aborted) {
      this.checkAborted();

      const hint = defaultValue ? 'S/n' : 's/N';
      const rawInput = await this.terminal.prompt(`${question} [${hint}]: `, {
        signal: this.signal,
      });
      this.checkAborted();

      const trimmed = rawInput.trim().toLowerCase();
      if (!trimmed) {
        return defaultValue;
      }

      if (
        trimmed === 's' ||
        trimmed === 'si' ||
        trimmed === 'sí' ||
        trimmed === 'y' ||
        trimmed === 'yes' ||
        trimmed === 'true'
      ) {
        return true;
      }

      if (trimmed === 'n' || trimmed === 'no' || trimmed === 'false') {
        return false;
      }

      this.terminal.writeLine('  [!] Por favor, respondé con "s" (sí) o "n" (no).');
    }

    this.checkAborted();
    return defaultValue;
  }

  public async promptChoice<T>(
    question: string,
    choices: ReadonlyArray<ChoiceItem<T>>,
    defaultIndex?: number,
  ): Promise<T> {
    if (choices.length === 0) {
      throw new Error('promptChoice called with empty choices array.');
    }

    while (!this.signal.aborted) {
      this.checkAborted();

      this.terminal.writeLine(`\n${question}`);
      for (let i = 0; i < choices.length; i++) {
        const item = choices[i]!;
        const defaultMarker = i === defaultIndex ? ' (default)' : '';
        const desc = item.description ? ` - ${item.description}` : '';
        this.terminal.writeLine(`  ${i + 1}. ${item.label}${desc}${defaultMarker}`);
      }

      const promptLabel =
        defaultIndex !== undefined ? `Selección [${defaultIndex + 1}]: ` : 'Selección (número): ';
      const input = await this.terminal.prompt(promptLabel, { signal: this.signal });
      this.checkAborted();

      const trimmed = input.trim();
      if (!trimmed && defaultIndex !== undefined) {
        return choices[defaultIndex]!.value;
      }

      const num = Number(trimmed);
      if (!Number.isInteger(num) || num < 1 || num > choices.length) {
        this.terminal.writeLine(
          `  [!] Opción inválida. Ingresá un número del 1 al ${choices.length}.`,
        );
        continue;
      }

      return choices[num - 1]!.value;
    }

    this.checkAborted();
    return choices[0]!.value;
  }

  public async promptMultiChoice<T>(
    question: string,
    choices: ReadonlyArray<ChoiceItem<T>>,
    options?: MultiChoiceOptions,
  ): Promise<T[]> {
    if (choices.length === 0) {
      return [];
    }

    const minSelected = options?.minSelected ?? 1;

    while (!this.signal.aborted) {
      this.checkAborted();

      this.terminal.writeLine(`\n${question}`);
      for (let i = 0; i < choices.length; i++) {
        const item = choices[i]!;
        const isDefault = options?.defaultSelectedIndices?.includes(i);
        const defaultMarker = isDefault ? ' [x]' : ' [ ]';
        const desc = item.description ? ` - ${item.description}` : '';
        this.terminal.writeLine(`  ${i + 1}. ${item.label}${desc}${defaultMarker}`);
      }

      let defaultStr = '';
      if (options?.defaultSelectedIndices && options.defaultSelectedIndices.length > 0) {
        const defaultNums = options.defaultSelectedIndices.map((idx) => idx + 1).join(', ');
        defaultStr = ` [${defaultNums}]`;
      }

      const input = await this.terminal.prompt(
        `Ingresá números separados por coma o "todas"${defaultStr}: `,
        { signal: this.signal },
      );
      this.checkAborted();

      const trimmed = input.trim().toLowerCase();

      if (
        !trimmed &&
        options?.defaultSelectedIndices &&
        options.defaultSelectedIndices.length > 0
      ) {
        return options.defaultSelectedIndices.map((idx) => choices[idx]!.value);
      }

      if (trimmed === 'todas' || trimmed === 'all') {
        return choices.map((c) => c.value);
      }

      const parts = trimmed
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        if (minSelected === 0) return [];
        this.terminal.writeLine(`  [!] Debés seleccionar al menos ${minSelected} opción/es.`);
        continue;
      }

      const selectedIndices = new Set<number>();
      let hasError = false;

      for (const part of parts) {
        const num = Number(part);
        if (!Number.isInteger(num) || num < 1 || num > choices.length) {
          this.terminal.writeLine(
            `  [!] "${sanitizeString(part)}" no es un número de opción válido (1 a ${choices.length}).`,
          );
          hasError = true;
          break;
        }
        selectedIndices.add(num - 1);
      }

      if (hasError) {
        continue;
      }

      if (selectedIndices.size < minSelected) {
        this.terminal.writeLine(
          `  [!] Seleccionaste ${selectedIndices.size} opción/es; el mínimo requerido es ${minSelected}.`,
        );
        continue;
      }

      return Array.from(selectedIndices).map((idx) => choices[idx]!.value);
    }

    this.checkAborted();
    return [];
  }

  public async promptStringList(
    title: string,
    options?: { minItems?: number; itemHint?: string; defaultItems?: readonly string[] },
  ): Promise<string[]> {
    const minItems = options?.minItems ?? 0;
    const items: string[] = options?.defaultItems ? [...options.defaultItems] : [];

    this.terminal.writeLine(`\n${title}`);
    if (items.length > 0) {
      this.terminal.writeLine(`Valores actuales: ${items.map((i) => `"${i}"`).join(', ')}`);
      const keepCurrent = await this.promptBoolean(
        '¿Deseás conservar estos valores actuales?',
        true,
      );
      if (keepCurrent) {
        return items;
      }
      items.length = 0;
    }

    this.terminal.writeLine(
      options?.itemHint ?? 'Ingresá cada término. Presioná [Enter] con línea vacía para finalizar:',
    );

    while (!this.signal.aborted) {
      this.checkAborted();

      const countLabel = `  [Elemento ${items.length + 1}]: `;
      const raw = await this.terminal.prompt(countLabel, { signal: this.signal });
      this.checkAborted();

      const trimmed = raw.trim();
      if (!trimmed) {
        if (items.length < minItems) {
          this.terminal.writeLine(`  [!] Se requiere ingresar al menos ${minItems} elemento(s).`);
          continue;
        }
        break;
      }

      items.push(trimmed);
    }

    this.checkAborted();
    return items;
  }
}
