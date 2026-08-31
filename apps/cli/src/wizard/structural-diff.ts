/**
 * Represents a single structural diff change.
 */
export interface DiffChange {
  readonly kind: 'added' | 'removed' | 'modified';
  readonly path: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  return JSON.stringify(value);
}

/**
 * Recursively calculates structural differences between two objects.
 * Produces deterministic, path-sorted changes independent of object key insertion order.
 */
export function calculateStructuralDiff(
  original: unknown,
  updated: unknown,
  basePath = '',
): DiffChange[] {
  const changes: DiffChange[] = [];

  if (original === updated) {
    return changes;
  }

  // Handle undefined / null edge cases
  if (original === undefined && updated !== undefined) {
    changes.push({ kind: 'added', path: basePath, newValue: updated });
    return changes;
  }

  if (original !== undefined && updated === undefined) {
    changes.push({ kind: 'removed', path: basePath, oldValue: original });
    return changes;
  }

  // Handle Arrays
  if (Array.isArray(original) && Array.isArray(updated)) {
    const maxLen = Math.max(original.length, updated.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = basePath ? `${basePath}[${i}]` : `[${i}]`;
      if (i >= original.length) {
        changes.push({ kind: 'added', path: itemPath, newValue: updated[i] });
      } else if (i >= updated.length) {
        changes.push({ kind: 'removed', path: itemPath, oldValue: original[i] });
      } else {
        changes.push(...calculateStructuralDiff(original[i], updated[i], itemPath));
      }
    }
    return changes;
  }

  // Handle Objects
  if (isPlainObject(original) && isPlainObject(updated)) {
    const allKeys = Array.from(new Set([...Object.keys(original), ...Object.keys(updated)])).sort();

    for (const key of allKeys) {
      const itemPath = basePath ? `${basePath}.${key}` : key;
      const origVal = original[key];
      const updateVal = updated[key];

      if (origVal === undefined && updateVal !== undefined) {
        changes.push({ kind: 'added', path: itemPath, newValue: updateVal });
      } else if (origVal !== undefined && updateVal === undefined) {
        changes.push({ kind: 'removed', path: itemPath, oldValue: origVal });
      } else {
        changes.push(...calculateStructuralDiff(origVal, updateVal, itemPath));
      }
    }
    return changes;
  }

  // Handle Primitive / Type mismatch changes
  if (original !== updated) {
    changes.push({
      kind: 'modified',
      path: basePath,
      oldValue: original,
      newValue: updated,
    });
  }

  return changes;
}

/**
 * Formats structural diff changes into human-readable terminal lines.
 */
export function formatStructuralDiff(changes: readonly DiffChange[]): string {
  if (changes.length === 0) {
    return '  (Sin cambios detectados)';
  }

  const lines: string[] = [];
  for (const change of changes) {
    switch (change.kind) {
      case 'modified':
        lines.push(
          `  ~ ${change.path}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`,
        );
        break;
      case 'added':
        lines.push(`  + ${change.path}: ${formatValue(change.newValue)}`);
        break;
      case 'removed':
        lines.push(`  - ${change.path}: ${formatValue(change.oldValue)}`);
        break;
    }
  }

  return lines.join('\n');
}
