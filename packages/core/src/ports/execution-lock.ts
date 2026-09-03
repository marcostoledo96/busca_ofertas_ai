/**
 * Execution Lock Port — Busca Ofertas AI Core
 *
 * Driver-agnostic concurrency control to prevent concurrent runs on the same storage database.
 */

export interface ExecutionLockInfo {
  readonly holderId: string;
  readonly acquiredAt: Date;
}

export interface ExecutionLockHandle extends ExecutionLockInfo {
  release(): Promise<void>;
}

export interface ExecutionLockPort {
  acquire(holderId: string, metadata?: Record<string, unknown>): Promise<ExecutionLockHandle>;
  isHeld(): Promise<boolean>;
  getHolder(): Promise<ExecutionLockInfo | null>;
}
