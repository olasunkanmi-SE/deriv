import { VocabularyError } from '../errors.js';

export const URGENCY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export function parseUrgencyLevel(s: string): UrgencyLevel {
  if ((URGENCY_LEVELS as readonly string[]).includes(s)) {
    return s as UrgencyLevel;
  }
  throw new VocabularyError('UrgencyLevel', s, URGENCY_LEVELS);
}
