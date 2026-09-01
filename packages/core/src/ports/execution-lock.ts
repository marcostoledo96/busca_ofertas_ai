/**
 * Execution Lock Port — Busca Ofertas AI Core
 *
 * Driver-agnostic concurrency control to prevent concurrent runs on the same storage database.
 */

export interface ExecutionLockHandle {
  readonly holderId: string;
  readonly acquiredAt: Date;
  release(): Promise<void>;
}

export interface ExecutionLockPort {
  acquire(holderId: string, metadata?: Record<string, unknown>): Promise<ExecutionLockHandle>;
  isHeld(): Promise<boolean>;
  getHolder(): Promise<ExecutionLockHandle | null>;
}
