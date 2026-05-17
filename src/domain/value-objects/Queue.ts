import { VocabularyError } from '../errors.js';

export const QUEUES = [
  'payments_ops',
  'trust_and_safety',
  'customer_support',
  'trading_ops',
  'account_operations',
] as const;

export type Queue = (typeof QUEUES)[number];

export function parseQueue(s: string): Queue {
  if ((QUEUES as readonly string[]).includes(s)) {
    return s as Queue;
  }
  throw new VocabularyError('Queue', s, QUEUES);
}
