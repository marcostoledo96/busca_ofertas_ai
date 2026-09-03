export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvariantViolationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolationError';
  }
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidIdGenerator implements IdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}
