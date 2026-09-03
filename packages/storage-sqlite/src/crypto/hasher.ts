import { createHash } from 'node:crypto';
import type { Hasher } from '@busca-ofertas-ai/core';

export class NodeCryptoHasher implements Hasher {
  hash(data: string): string {
    return createHash('sha256').update(data, 'utf8').digest('hex');
  }
}

export function createNodeCryptoHasher(): Hasher {
  return new NodeCryptoHasher();
}
