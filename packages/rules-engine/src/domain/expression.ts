import { InvariantViolationError, type RuleExpression } from '@busca-ofertas-ai/core';

export type BooleanExpressionKind = 'RULE' | 'AND' | 'OR' | 'NOT';

export interface RuleReferenceNode {
  readonly kind: 'RULE';
  readonly ruleId: string;
}

export interface AndExpressionNode {
  readonly kind: 'AND';
  readonly expressions: readonly BooleanExpressionNode[];
}

export interface OrExpressionNode {
  readonly kind: 'OR';
  readonly expressions: readonly BooleanExpressionNode[];
}

export interface NotExpressionNode {
  readonly kind: 'NOT';
  readonly expression: BooleanExpressionNode;
}

export type BooleanExpressionNode =
  RuleReferenceNode | AndExpressionNode | OrExpressionNode | NotExpressionNode;

export interface ValidationOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export const DEFAULT_MAX_DEPTH = 5;
export const DEFAULT_MAX_NODES = 50;

/**
 * Validates a boolean expression AST node defensivly.
 * Guards against:
 * - unknown operators / kinds
 * - unknown rule references
 * - invalid arities (AND/OR with <2 items, NOT with arity != 1)
 * - empty nodes
 * - circular runtime references
 * - pathological depth or node count limits
 */
export const validateBooleanExpression = (
  rawNode: unknown,
  availableRuleIds?: ReadonlySet<string>,
  options?: ValidationOptions,
): BooleanExpressionNode => {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;

  let totalNodes = 0;
  const visited = new Set<unknown>();

  const traverse = (node: unknown, currentDepth: number): BooleanExpressionNode => {
    if (currentDepth > maxDepth) {
      throw new InvariantViolationError(
        `Boolean expression exceeds maximum allowed depth of ${maxDepth}`,
      );
    }

    totalNodes += 1;
    if (totalNodes > maxNodes) {
      throw new InvariantViolationError(
        `Boolean expression exceeds maximum allowed node count of ${maxNodes}`,
      );
    }

    if (!node || typeof node !== 'object') {
      throw new InvariantViolationError('Boolean expression node must be a non-null object');
    }

    if (visited.has(node)) {
      throw new InvariantViolationError(
        'Circular reference detected in boolean expression runtime structure',
      );
    }
    visited.add(node);

    const record = node as Record<string, unknown>;
    const kind = record['kind'];

    if (typeof kind !== 'string') {
      throw new InvariantViolationError('Boolean expression node missing string "kind" attribute');
    }

    switch (kind) {
      case 'RULE': {
        const ruleId = record['ruleId'];
        if (typeof ruleId !== 'string' || ruleId.trim().length === 0) {
          throw new InvariantViolationError('RULE node must specify a non-empty string "ruleId"');
        }
        const cleanRuleId = ruleId.trim();
        if (availableRuleIds !== undefined && !availableRuleIds.has(cleanRuleId)) {
          throw new InvariantViolationError(
            `RULE node references unknown ruleId: '${cleanRuleId}'`,
          );
        }
        return {
          kind: 'RULE',
          ruleId: cleanRuleId,
        };
      }

      case 'AND': {
        const rawExpressions = record['expressions'];
        if (!Array.isArray(rawExpressions)) {
          throw new InvariantViolationError('AND node must contain an "expressions" array');
        }
        if (rawExpressions.length < 2) {
          throw new InvariantViolationError(
            `AND node requires at least 2 child expressions, got ${rawExpressions.length}`,
          );
        }
        const validatedExpressions = rawExpressions.map((child) =>
          traverse(child, currentDepth + 1),
        );
        return {
          kind: 'AND',
          expressions: validatedExpressions,
        };
      }

      case 'OR': {
        const rawExpressions = record['expressions'];
        if (!Array.isArray(rawExpressions)) {
          throw new InvariantViolationError('OR node must contain an "expressions" array');
        }
        if (rawExpressions.length < 2) {
          throw new InvariantViolationError(
            `OR node requires at least 2 child expressions, got ${rawExpressions.length}`,
          );
        }
        const validatedExpressions = rawExpressions.map((child) =>
          traverse(child, currentDepth + 1),
        );
        return {
          kind: 'OR',
          expressions: validatedExpressions,
        };
      }

      case 'NOT': {
        const childExpression = record['expression'];
        if (
          !childExpression ||
          typeof childExpression !== 'object' ||
          Array.isArray(childExpression)
        ) {
          throw new InvariantViolationError('NOT node requires a single child "expression" object');
        }
        const validatedChild = traverse(childExpression, currentDepth + 1);
        return {
          kind: 'NOT',
          expression: validatedChild,
        };
      }

      default:
        throw new InvariantViolationError(
          `Unknown boolean expression operator or kind: '${String(kind)}'`,
        );
    }
  };

  return traverse(rawNode, 1);
};

/**
 * Serializes a BooleanExpressionNode into a domain RuleExpression compatible with SavedSearch.
 */
export const booleanExpressionToRuleExpression = (
  id: string,
  node: BooleanExpressionNode,
): RuleExpression => {
  return {
    id,
    type: 'COMPOSITE_BOOLEAN',
    params: {
      ast: node,
    },
  };
};

/**
 * Deserializes a RuleExpression into a BooleanExpressionNode if applicable.
 */
export const ruleExpressionToBooleanExpression = (
  expr: RuleExpression,
  availableRuleIds?: ReadonlySet<string>,
): BooleanExpressionNode => {
  if (expr.type === 'COMPOSITE_BOOLEAN' && expr.params && 'ast' in expr.params) {
    return validateBooleanExpression(expr.params['ast'], availableRuleIds);
  }

  // Single rule projection
  return validateBooleanExpression(
    {
      kind: 'RULE',
      ruleId: expr.id,
    },
    availableRuleIds,
  );
};
